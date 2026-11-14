/** SOURCE OF TRUTH: parseJsonDocument, formatJsonDocument.
 * WHAT: JSON.parse for hand-edited project files (tolerating a leading UTF-8 byte-order mark), and a
 * formatting-preserving writer that applies a new value to the original text: untouched subtrees are
 * copied verbatim, changed containers keep their detected style (indent, inline or multi-line, spacing,
 * line endings), existing keys keep their order and new keys follow canonical schema order.
 * WHY: Windows editors write a BOM that JSON.parse rejects; and editor or agent edits must produce
 * minimal, reviewable diffs instead of reformatting author files (including large snapshot data URLs).
 * WHERE: project discovery and export commands parse recipes, manifests and compositions through it;
 * velora edit and the edit bridge write recipes through formatJsonDocument.
 */
export function parseJsonDocument(text: string): unknown {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

type JsonNode =
  | { kind: "object"; start: number; end: number; canonical: string; members: { key: string; keyStart: number; keyEnd: number; value: JsonNode }[] }
  | { kind: "array"; start: number; end: number; canonical: string; elements: JsonNode[] }
  | { kind: "value"; start: number; end: number; canonical: string };
/** Key-order-insensitive identity, so reordering alone never counts as a change. */
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function parseTree(text: string, offset: number): { node: JsonNode; end: number } {
  let i = offset;
  const space = () => { while (i < text.length && /[\s]/.test(text[i])) i++; };
  const string = (): string => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): JsonNode => {
    space();
    const start = i, c = text[i];
    if (c === "{") {
      i++;
      const members: Extract<JsonNode, { kind: "object" }>["members"] = [];
      space();
      if (text[i] === "}") { i++; return { kind: "object", start, end: i, canonical: "{}", members }; }
      for (;;) {
        space();
        const keyStart = i, key = string(), keyEnd = i;
        space();
        if (text[i] !== ":") throw new SyntaxError(`Expected ':' at ${i}`);
        i++;
        const member = value();
        members.push({ key, keyStart, keyEnd, value: member });
        space();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; break; }
        throw new SyntaxError(`Expected ',' or '}' at ${i}`);
      }
      const sorted = [...members].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return { kind: "object", start, end: i, members, canonical: `{${sorted.map(m => `${JSON.stringify(m.key)}:${m.value.canonical}`).join(",")}}` };
    }
    if (c === "[") {
      i++;
      const elements: JsonNode[] = [];
      space();
      if (text[i] === "]") { i++; return { kind: "array", start, end: i, canonical: "[]", elements }; }
      for (;;) {
        elements.push(value());
        space();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; break; }
        throw new SyntaxError(`Expected ',' or ']' at ${i}`);
      }
      return { kind: "array", start, end: i, elements, canonical: `[${elements.map(e => e.canonical).join(",")}]` };
    }
    if (c === '"') { const parsed = string(); return { kind: "value", start, end: i, canonical: JSON.stringify(parsed) }; }
    const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!match) throw new SyntaxError(`Unexpected token at ${i}`);
    i += match[0].length;
    return { kind: "value", start, end: i, canonical: JSON.stringify(JSON.parse(match[0])) };
  };
  const node = value();
  return { node, end: i };
}

// Canonical schema order for keys a writer adds (recipes and compositions); unknown keys append.
const KEY_ORDER = ["$schema", "version", "id", "title", "description", "template", "definition", "editor", "snapshot",
  "scene", "motion", "look", "width", "height", "camera", "focus", "nodes", "constraints", "parentId", "transform",
  "durationMs", "speed", "loop", "tracks", "clips", "links", "label", "startMs", "inMs", "ease", "mode", "members", "stagger", "source",
  "target", "kind", "property", "keyframes", "interpolation", "unit", "noise", "rove", "orient", "timeMs", "value", "easing",
  "inTangent", "outTangent", "to", "from", "scale", "offset", "delayMs", "subject", "anchor", "point", "surface", "weight", "up",
  "labels", "colors", "locked", "markers", "atMs"];
const rank = (key: string) => { const index = KEY_ORDER.indexOf(key); return index < 0 ? KEY_ORDER.length : index; };
function orderKeys(existing: string[], next: string[]): string[] {
  const kept = existing.filter(key => next.includes(key));
  const result = [...kept];
  // Keys the new value positions explicitly (followed by a kept key) go after their preceding neighbor,
  // so a restored object returns to its original order. Trailing additions use canonical order.
  const lastKept = Math.max(-1, ...kept.map(key => next.indexOf(key)));
  for (const [index, key] of next.entries()) {
    if (existing.includes(key) || index > lastKept) continue;
    const before = next.slice(0, index).reverse().find(other => result.includes(other));
    result.splice(before === undefined ? 0 : result.indexOf(before) + 1, 0, key);
  }
  const trailing = next.filter((key, index) => !existing.includes(key) && index > lastKept).sort((a, b) => rank(a) - rank(b));
  for (const key of trailing) {
    // Before the first kept key that comes later in canonical order; otherwise at the end.
    const at = result.findIndex(other => rank(other) > rank(key) && kept.includes(other));
    if (at < 0 || rank(key) === KEY_ORDER.length) result.push(key); else result.splice(at, 0, key);
  }
  return result;
}
// A layout template: a node plus the text it came from (the original or a reference version).
type Template = { node: JsonNode; text: string };
type Style = { unit: string; nl: string; shapes: Map<string, Template> };
// Shape signature: an object's sorted key set, or an array's first element shape.
function signature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length ? signature(value[0]) : ""}]`;
  if (isObject(value)) return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().join(",")}}`;
  return typeof value;
}
function nodeSignature(node: JsonNode): string {
  if (node.kind === "array") return `[${node.elements.length ? nodeSignature(node.elements[0]) : ""}]`;
  if (node.kind === "object") return `{${node.members.map(m => m.key).sort().join(",")}}`;
  return "value";
}
/** The first container of each shape in the original text: layout templates for values without text. */
function shapesOf(root: JsonNode, text: string, shapes = new Map<string, Template>()): Map<string, Template> {
  const visit = (node: JsonNode) => {
    if (node.kind === "value") return;
    const key = nodeSignature(node);
    if (!shapes.has(key) && (node.kind === "object" ? node.members.length : node.elements.length)) shapes.set(key, { node, text });
    if (node.kind === "object") node.members.forEach(member => visit(member.value)); else node.elements.forEach(visit);
  };
  visit(root);
  return shapes;
}
function lineIndent(text: string, position: number): string {
  let start = position;
  while (start > 0 && text[start - 1] !== "\n") start--;
  return /^[ \t]*/.exec(text.slice(start, position))![0];
}
const multiline = (text: string, node: JsonNode) => /\n/.test(text.slice(node.start, node.end));
// Inline spacing of an existing single-line container ("{ "a": 1 }" vs "{"a":1}").
function inlineSpacing(text: string, node: JsonNode) {
  const body = text.slice(node.start, node.end);
  return { pad: /^[{[] /.test(body), comma: /, /.test(body) || !/,/.test(body), colon: !/":(?! )/.test(body) };
}
/** Emit a value that has no original text. A template (a same-shaped node from the document or a
 * reference version, else a sibling) supplies the layout recursively: inline or multi-line per level,
 * spacing, and child templates by key or position. */
type Spacing = ReturnType<typeof inlineSpacing>;
function fresh(value: unknown, indent: string, style: Style, hint?: Template, inlineWithin?: Spacing): string {
  // Inside an inline container everything stays on the line: like an inline template of the same
  // shape when there is one, otherwise with that container's spacing.
  const candidate = (value && typeof value === "object" ? style.shapes.get(signature(value)) : undefined) ?? hint;
  const inlineTemplate = candidate && candidate.node.kind !== "value" && !multiline(candidate.text, candidate.node)
    && ((candidate.node.kind === "array") === Array.isArray(value)) && ((candidate.node.kind === "object") === isObject(value));
  if (inlineWithin && !inlineTemplate) {
    const pad = inlineWithin.pad ? " " : "", comma = inlineWithin.comma ? ", " : ",", colon = inlineWithin.colon ? ": " : ":";
    if (Array.isArray(value)) return value.length ? `[${pad}${value.map(v => fresh(v, indent, style, undefined, inlineWithin)).join(comma)}${pad}]` : "[]";
    if (isObject(value)) {
      const keys = Object.keys(value).filter(k => value[k] !== undefined);
      return keys.length ? `{${pad}${keys.map(k => `${JSON.stringify(k)}${colon}${fresh(value[k], indent, style, undefined, inlineWithin)}`).join(comma)}${pad}}` : "{}";
    }
    return JSON.stringify(value);
  }
  const template = (value && typeof value === "object" ? style.shapes.get(signature(value)) : undefined) ?? hint;
  const node = template?.node, source = template?.text ?? "";
  const usable = node && ((node.kind === "array" && Array.isArray(value)) || (node.kind === "object" && isObject(value))) ? node : undefined;
  const childOf = (key: string | number): Template | undefined => {
    if (!usable) return undefined;
    const child = usable.kind === "object" ? usable.members.find(member => member.key === key)?.value ?? usable.members.find(member => member.value.kind !== "value")?.value
      : usable.kind === "array" ? usable.elements[0] : undefined;
    return child ? { node: child, text: source } : undefined;
  };
  if (usable && !multiline(source, usable)) {
    const spacing = inlineSpacing(source, usable);
    const pad = spacing.pad ? " " : "", comma = spacing.comma ? ", " : ",", colon = spacing.colon ? ": " : ":";
    if (Array.isArray(value)) return value.length ? `[${pad}${value.map((v, i) => fresh(v, indent, style, childOf(i))).join(comma)}${pad}]` : "[]";
    const record = value as Record<string, unknown>;
    // A fresh object keeps its own key order (writers build new objects in canonical order).
    const keys = Object.keys(record).filter(k => record[k] !== undefined);
    return keys.length ? `{${pad}${keys.map(k => `${JSON.stringify(k)}${colon}${fresh(record[k], indent, style, childOf(k))}`).join(comma)}${pad}}` : "{}";
  }
  const inner = indent + style.unit;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[${style.nl}${value.map((v, i) => inner + fresh(v, inner, style, childOf(i))).join("," + style.nl)}${style.nl}${indent}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value).filter(k => value[k] !== undefined);
    if (!keys.length) return "{}";
    return `{${style.nl}${keys.map(k => `${inner}${JSON.stringify(k)}: ${fresh(value[k], inner, style, childOf(k))}`).join("," + style.nl)}${style.nl}${indent}}`;
  }
  return JSON.stringify(value);
}
function emit(text: string, node: JsonNode | undefined, value: unknown, indent: string, style: Style, sibling?: JsonNode, inlineWithin?: Spacing): string {
  if (node && node.canonical === canonical(value)) return text.slice(node.start, node.end);
  // An empty original container carries no layout: emit the value fresh, styled like a sibling.
  const empty = node && ((node.kind === "array" && !node.elements.length) || (node.kind === "object" && !node.members.length));
  if (!node || empty || node.kind === "value" || (node.kind === "object") !== isObject(value) || (node.kind === "array") !== Array.isArray(value))
    { const hint = empty || !node || node.kind === "value" ? sibling : node; return fresh(value, indent, style, hint ? { node: hint, text } : undefined, inlineWithin); }
  const lines = multiline(text, node);
  const inline = lines ? undefined : inlineSpacing(text, node);
  if (node.kind === "object") {
    const record = value as Record<string, unknown>;
    const keys = orderKeys(node.members.map(m => m.key), Object.keys(record).filter(k => record[k] !== undefined));
    if (!keys.length) return "{}";
    const memberIndent = lines && node.members.length ? lineIndent(text, node.members[0].keyStart) : indent + style.unit;
    const closeIndent = lines ? lineIndent(text, node.end - 1) : indent;
    const parts = keys.map(key => {
      const member = node.members.find(m => m.key === key);
      const keyText = member ? text.slice(member.keyStart, member.keyEnd) : JSON.stringify(key);
      const colon = member ? text.slice(member.keyEnd, member.value.start) : inline && !inline.colon ? ":" : ": ";
      const sample = member ? undefined : node.members.find(m => m.value.kind !== "value")?.value;
      return `${keyText}${colon}${emit(text, member?.value, record[key], lines ? memberIndent : indent, style, sample, inline)}`;
    });
    if (!lines) {
      const pad = inline!.pad ? " " : "", comma = inline!.comma ? ", " : ",";
      return `{${pad}${parts.join(comma)}${pad}}`;
    }
    return `{${style.nl}${parts.map(part => memberIndent + part).join("," + style.nl)}${style.nl}${closeIndent}}`;
  }
  const list = value as unknown[];
  if (!list.length) return "[]";
  const elements = node.elements;
  // Align unchanged elements (longest common subsequence) so insertions copy their neighbors verbatim.
  const next = list.map(canonical), n = elements.length, m = list.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let a = n - 1; a >= 0; a--) for (let b = m - 1; b >= 0; b--)
    table[a][b] = elements[a].canonical === next[b] ? table[a + 1][b + 1] + 1 : Math.max(table[a + 1][b], table[a][b + 1]);
  const matched: (JsonNode | undefined)[] = new Array(m).fill(undefined);
  for (let a = 0, b = 0; a < n && b < m;) {
    if (elements[a].canonical === next[b]) { matched[b] = elements[a]; a++; b++; }
    else if (table[a + 1][b] >= table[a][b + 1]) a++; else b++;
  }
  // Unmatched positions reuse the original element at the same index when the shape is compatible.
  const used = new Set(matched.filter(Boolean));
  const source = matched.map((node, index) => node ?? (elements[index] && !used.has(elements[index]) ? elements[index] : undefined));
  const elementIndent = lines ? lineIndent(text, elements[0].start) : indent + style.unit;
  const closeIndent = lines ? lineIndent(text, node.end - 1) : indent;
  const sample = elements.find(e => e.kind !== "value") ?? elements[0];
  const parts = list.map((item, index) => emit(text, source[index], item, lines ? elementIndent : indent, style, sample, inline));
  if (!lines) {
    const pad = inline!.pad ? " " : "", comma = inline!.comma ? ", " : ",";
    return `[${pad}${parts.join(comma)}${pad}]`;
  }
  return `[${style.nl}${parts.map(part => elementIndent + part).join("," + style.nl)}${style.nl}${closeIndent}]`;
}
function referenceShapes(shapes: Map<string, Template>, reference: string | undefined): Map<string, Template> {
  if (!reference) return shapes;
  const text = reference.charCodeAt(0) === 0xfeff ? reference.slice(1) : reference;
  try { return shapesOf(parseTree(text, 0).node, text, shapes); } catch { return shapes; }
}
/** Apply nextValue to originalText with minimal changes. No-op guarantee: formatting the parsed value of
 * a document returns the document byte for byte (BOM, line endings and trailing newline included). */
export type FormatOptions = {
  /** Another version of the same document (for example the text before an edit) whose layout is used for
   * values whose shape no longer appears in the original (undo after removing every node of a shape). */
  reference?: string;
};
export function formatJsonDocument(originalText: string, nextValue: unknown, options: FormatOptions = {}): string {
  const bom = originalText.charCodeAt(0) === 0xfeff ? "﻿" : "";
  const text = bom ? originalText.slice(1) : originalText;
  const { node, end } = parseTree(text, 0);
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const unit = /\n([ \t]+)\S/.exec(text)?.[1] ?? "  ";
  const leading = text.slice(0, node.start), trailing = text.slice(end);
  return bom + leading + emit(text, node, nextValue, lineIndent(text, node.start), { unit: unit.startsWith("\t") ? "\t" : unit, nl, shapes: referenceShapes(shapesOf(node, text), options.reference) }) + trailing;
}
