import ts from "typescript";
import { VELORA_PACKAGE } from "../core/branding";
import { parseCssColor } from "../core/color";
import { SCENE_RECIPE_DIRECTORY } from "../core/recipes";
import type { EditOp } from "../core/edit";
import type { SourceNode, SourceOutline, SourceRequest } from "../core/source";
import { fault } from "./errors";

/** SOURCE OF TRUTH: outlineSource, wrapElement.
 * WHAT: inspect local JSX and produce narrow text splices for source edits.
 * WHY: preserve the host's formatting and scope imports without evaluating host code.
 * WHERE: source-edit validates file ownership, then previews the proposed recipe and source.
 */
type Jsx = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;
type Entry = { jsx: Jsx; info: SourceNode; props?: ts.JsxAttributes };
type Splice = { start: number; end: number; text: string };
type SourceChange = { text: string; ops: EditOp[] };
type SourceContext = ReturnType<typeof inspect>;
const sharedHostFile = (file: string) => !file.startsWith(`${SCENE_RECIPE_DIRECTORY}/`);
const isJsx = (node: ts.Node): node is Jsx => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
function refuse(message: string): never { throw fault("ERR_SOURCE_REFUSED", message); }
const directive = (statement: ts.Statement, value: string) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === value;

function literal(init: ts.JsxAttributeValue | undefined): string | number | boolean | undefined {
  if (!init) return true;
  if (ts.isStringLiteral(init)) return init.text;
  if (!ts.isJsxExpression(init) || !init.expression) return;
  const expression = init.expression;
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expression.operand)) return -Number(expression.operand.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) return expression.kind === ts.SyntaxKind.TrueKeyword;
}

function componentOf(node: ts.Node, outer = false): { name: string; body: ts.ConciseBody } | undefined {
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (!ts.isFunctionLike(parent)) continue;
    if (!(ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) || !parent.body) {
      if (outer) continue;
      return;
    }
    const holder = parent.parent;
    const name = parent.name?.text ?? (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name) ? holder.name.text : undefined);
    if (name && /^[A-Z]/.test(name)) return { name, body: parent.body };
    if (ts.isExportAssignment(holder) || (ts.isFunctionDeclaration(parent) && parent.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)))
      return { name: name ?? "default", body: parent.body };
    if (!outer) return;
  }
}

function inspect(file: string, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX);
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) refuse(`Fix the JSX syntax first. ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ")}`);
  const references = new Set<string>();
  const defaultExports = new Map<string, string>();
  let defaultComponent: string | undefined;
  const localBindings = new Map<string, string[]>();
  const imports = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) defaultComponent = statement.name?.text ?? "default";
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) defaultComponent = ts.isIdentifier(statement.expression) ? statement.expression.text : "default";
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      references.add(specifier);
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        const entry = statement.exportClause.elements.find(item => !item.isTypeOnly && item.name.text === "default");
        if (entry) defaultExports.set(specifier, entry.propertyName?.text ?? "default");
      }
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
        const clause = statement.importClause, named = clause?.namedBindings;
        localBindings.set(specifier, [...(localBindings.get(specifier) ?? []), ...(clause?.name ? [clause.name.text] : []),
          ...(named && ts.isNamedImports(named) ? named.elements.filter(entry => !entry.isTypeOnly).map(entry => entry.name.text) : []),
          ...(named && ts.isNamespaceImport(named) ? [`${named.name.text}.`] : [])]);
      }
    }
    if (!ts.isImportDeclaration(statement) || specifier !== VELORA_PACKAGE.name || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) if (!item.isTypeOnly) imports.set(item.propertyName?.text ?? item.name.text, item.name.text);
  }
  const at = (position: number) => {
    const { line, character } = source.getLineAndCharacterOfPosition(position);
    return { line: line + 1, column: character + 1 };
  };
  const nodes: Entry[] = [];
  const names = new Set<string>();
  const animatables: SourceOutline["animatables"] = [];
  const counters = new Map<string, number>();
  const localName = (name: string) => imports.get(name) ?? ([...namespaces][0] ? `${[...namespaces][0]}.${name}` : undefined);
  const scan = (jsx: ts.Node, parent?: Entry, flags = { insideMap: false, insideConditional: false, insideProp: false }) => {
    if (ts.isIdentifier(jsx)) names.add(jsx.text);
    if (ts.isCallExpression(jsx) && jsx.expression.getText(source) === localName("useAnimatable") && jsx.arguments[0] && ts.isStringLiteral(jsx.arguments[0])) {
      const spec = jsx.arguments[1];
      const props = spec && ts.isObjectLiteralExpression(spec) ? spec.properties.flatMap(prop => prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? [prop.name.text] : []) : [];
      animatables.push({ id: jsx.arguments[0].text, props, at: at(jsx.getStart(source)) });
    }
    const conditional = ts.isConditionalExpression(jsx) || ts.isIfStatement(jsx) || ts.isSwitchStatement(jsx)
      || ts.isBinaryExpression(jsx) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(jsx.operatorToken.kind);
    const map = ts.isCallExpression(jsx) && ((ts.isPropertyAccessExpression(jsx.expression) && ["map", "flatMap"].includes(jsx.expression.name.text))
      || (ts.isElementAccessExpression(jsx.expression) && ts.isStringLiteral(jsx.expression.argumentExpression) && ["map", "flatMap"].includes(jsx.expression.argumentExpression.text)));
    const next = { insideMap: flags.insideMap || map, insideConditional: flags.insideConditional || conditional, insideProp: flags.insideProp || ts.isJsxAttribute(jsx) };
    let entry = parent;
    if (isJsx(jsx)) {
      const opening = ts.isJsxElement(jsx) ? jsx.openingElement : ts.isJsxSelfClosingElement(jsx) ? jsx : undefined;
      const tag = opening?.tagName.getText(source) ?? "Fragment";
      const scope = parent?.info.path ?? `${file}#${componentOf(jsx, true)?.name ?? "module"}`;
      const index = counters.get(scope) ?? 0;
      counters.set(scope, index + 1);
      const literals: [string, string | number | boolean][] = [];
      for (const prop of opening?.attributes.properties ?? []) if (ts.isJsxAttribute(prop)) {
        const value = literal(prop.initializer);
        if (value !== undefined) literals.push([prop.name.getText(source), value]);
      }
      const values = Object.fromEntries(literals);
      const isSurface = tag === localName("Surface");
      const surfaceId = isSurface && typeof values.id === "string" ? values.id : undefined;
      const owner = parent?.info.isSurface ? parent.info.surfaceId : parent?.info.owner;
      const children = ts.isJsxSelfClosingElement(jsx) ? [] : jsx.children;
      const preview = children.map(child => ts.isJsxText(child) ? child.text : ts.isJsxExpression(child) && child.expression && ts.isStringLiteralLike(child.expression) ? child.expression.text : "").join(" ").replace(/\s+/g, " ").trim().slice(0, 40);
      entry = { jsx, props: opening?.attributes, info: {
        path: `${scope}.${index}:${tag}`, ...(parent ? { parent: parent.info.path } : {}), tag, literals: values,
        attributes: Object.fromEntries(literals.filter(([name]) => ["key", "id", "className"].includes(name) || name.startsWith("data-"))),
        text: preview, start: at(jsx.getStart(source)), end: at(jsx.end), isSurface, ...(surfaceId ? { surfaceId } : {}), ...(owner ? { owner } : {}),
        ...next, hasSpread: opening?.attributes.properties.some(ts.isJsxSpreadAttribute) ?? false,
      } };
      nodes.push(entry);
    }
    ts.forEachChild(jsx, child => scan(child, entry, next));
  };
  scan(source);
  return { source, nodes, names, outline: { file, nodes: nodes.map(entry => entry.info), animatables } satisfies SourceOutline,
    references: [...references], localBindings, defaultExports, defaultComponent,
    server: source.statements.some(statement => directive(statement, "use server")), client: source.statements.some(statement => directive(statement, "use client")), localName,
    newline: text.includes("\r\n") ? "\r\n" : "\n", quote: /^\s*(?:import\s[^\r\n]*?\sfrom\s|["']use client["'];?\s*import\s[^\r\n]*?\sfrom\s)'/m.test(text) ? "'" : '"',
  };
}

export function outlineSource(file: string, text: string): SourceOutline { return inspect(file, text).outline; }
export function sourceReferences(file: string, text: string, exportedComponent?: string) {
  const context = inspect(file, text);
  const scope = exportedComponent && exportedComponent !== "default" ? exportedComponent : context.defaultComponent;
  return context.references.map(specifier => {
    const names = context.localBindings.get(specifier) ?? [];
    const uses = context.nodes.filter(({ jsx }) => !scope || componentOf(jsx, true)?.name === scope).map(entry => entry.info)
      .filter(node => names.some(name => name.endsWith(".") ? node.tag.startsWith(name) : node.tag === name));
    const owners = [...new Set(uses.flatMap(use => use.owner ? [use.owner] : []))];
    return { specifier, reexportsDefault: context.defaultExports.get(specifier), owner: owners.length === 1 ? owners[0] : undefined,
      repeated: owners.length > 1 || new Set(uses.map(use => use.tag)).size < uses.length || uses.some(use => use.insideMap || use.insideConditional || use.insideProp) };
  });
}

/** Stable line anchors keep distant imports and JSX splices in separate diff hunks. */
export function sourceDiff(before: string, after: string): string {
  if (before === after) return "";
  const lines = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const a = lines(before), b = lines(after);
  const positions = (list: string[]) => {
    const index = new Map<string, number>();
    for (const [position, line] of list.entries()) index.set(line, index.has(line) ? -1 : position);
    return index;
  };
  const left = positions(a), right = positions(b);
  const anchors = [...left].flatMap(([line, from]) => {
    const to = right.get(line) ?? -1;
    return from >= 0 && to >= 0 ? [{ from, to }] : [];
  });
  // Find a monotonic subsequence in the second file. Source splices do not reorder lines.
  const tails: number[] = [], prev: number[] = [];
  for (const [index, anchor] of anchors.entries()) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const middle = (lo + hi) >>> 1; if (anchors[tails[middle]].to < anchor.to) lo = middle + 1; else hi = middle; }
    prev[index] = lo ? tails[lo - 1] : -1;
    tails[lo] = index;
  }
  const ordered = [{ from: a.length, to: b.length }];
  for (let index = tails.at(-1) ?? -1; index >= 0; index = prev[index]) ordered.push(anchors[index]);
  ordered.reverse();
  const changes: { from: number; to: number; endA: number; endB: number }[] = [];
  let from = 0, to = 0;
  for (const anchor of ordered) {
    let endA = anchor.from, endB = anchor.to;
    while (from < endA && to < endB && a[from] === b[to]) { from++; to++; }
    while (from < endA && to < endB && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    if (from < endA || to < endB) changes.push({ from, to, endA, endB });
    from = anchor.from + 1; to = anchor.to + 1;
  }
  const context = 3;
  const hunks: typeof changes[] = [];
  for (const change of changes) {
    const hunk = hunks.at(-1);
    if (hunk && change.from <= hunk.at(-1)!.endA + context * 2) hunk.push(change); else hunks.push([change]);
  }
  const range = (start: number, count: number) => `${count ? start + 1 : start},${count}`;
  return hunks.map(hunk => {
    const first = hunk[0], last = hunk.at(-1)!;
    const leading = Math.min(context, first.from, first.to), trailing = Math.min(context, a.length - last.endA, b.length - last.endB);
    const startA = first.from - leading, startB = first.to - leading;
    const output = [`@@ -${range(startA, last.endA + trailing - startA)} +${range(startB, last.endB + trailing - startB)} @@`];
    let cursor = startA;
    for (const change of hunk) {
      for (let index = cursor; index < change.from; index++) output.push(` ${a[index]}`);
      for (let index = change.from; index < change.endA; index++) output.push(`-${a[index]}`);
      for (let index = change.to; index < change.endB; index++) output.push(`+${b[index]}`);
      cursor = change.endA;
    }
    output.push(...a.slice(cursor, cursor + trailing).map(line => ` ${line}`));
    return output.join("\n");
  }).join("\n");
}

function find(context: SourceContext, path: string): Entry {
  return context.nodes.find(entry => entry.info.path === path) ?? refuse("This JSX path is stale or outside the selected file. Refresh the outline and select it again.");
}

function symbol(context: SourceContext, name: "Surface" | "useAnimatable", splices: Splice[]): string {
  const existing = context.localName(name);
  if (existing) return existing;
  const base = name === "Surface" ? "VeloraSurface" : "useVeloraAnimatable";
  let alias = context.names.has(name) ? base : name;
  for (let n = 2; context.names.has(alias); n++) alias = base + n;
  const imports = context.source.statements.filter(statement => ts.isImportDeclaration(statement) || (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)));
  const end = imports.at(-1)?.end;
  const tail = end === undefined ? "" : context.source.text.slice(end);
  const trailing = /^[\t ]*(?:\/\/[^\r\n]*)?(?=\r?\n|$)/.exec(tail)?.[0].length ?? 0;
  const bom = context.source.text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const point = end === undefined ? bom : end + trailing;
  const { newline, quote } = context;
  const line = `import { ${name}${alias === name ? "" : ` as ${alias}`} } from ${quote}${VELORA_PACKAGE.name}${quote};`;
  splices.push({ start: point, end: point, text: end === undefined ? line + newline : newline + line });
  return alias;
}

function splice(context: SourceContext, edits: Splice[]): string {
  let text = context.source.text;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}

function checkLocation(entry: Entry) {
  if (entry.info.insideMap || entry.info.insideConditional) refuse("This element is rendered by a map or conditional. Ask an agent to author an explicit keyed layer for its render cases.");
  if (entry.info.insideProp) refuse("This element is passed as a JSX prop. Review the receiving component before introducing a spatial layer there.");
}

export function wrapElement(context: SourceContext, entry: Entry, id: string, content: boolean): SourceChange {
  checkLocation(entry);
  if (entry.info.isSurface || context.nodes.some(other => other.info.surfaceId === id)) refuse("This is already a Surface or the requested layer ID is already in the file.");
  if (ts.isJsxFragment(entry.jsx) || entry.info.tag === "Fragment" || entry.info.tag.endsWith(".Fragment")) refuse("Select an element inside the fragment to promote.");
  if (entry.info.hasSpread && !entry.props?.properties.some(ts.isJsxAttribute)) refuse("This element receives only spread props. Make its layer identity explicit first.");
  const parent = entry.jsx.parent;
  if (ts.isJsxElement(parent) && context.nodes.some(other => other.jsx === parent && other.info.isSurface)
    && parent.children.filter(child => !ts.isJsxText(child) || child.text.trim()).length === 1) refuse("The element already has its own Surface wrapper.");
  const start = entry.jsx.getStart(context.source), end = entry.jsx.end;
  const children = context.nodes.filter(other => other.info.isSurface && other.info.owner === entry.info.owner && other.jsx.getStart(context.source) > start && other.jsx.end < end);
  if (children.some(child => !child.info.surfaceId) || (content && children.length)) refuse("This subtree contains spatial layers. Use a regular Surface wrapper with literal child IDs.");
  const edits: Splice[] = [];
  const tag = symbol(context, "Surface", edits);
  const inner = context.source.text.slice(start, end);
  const passthrough = sharedHostFile(context.outline.file) ? " passthrough" : "";
  edits.push({ start, end, text: content ? `<${tag} id="${id}"${passthrough} content={${inner}} />` : `<${tag} id="${id}"${passthrough}>${inner}</${tag}>` });
  return { text: splice(context, edits), ops: [
    { op: "node.ensure", id, ...(entry.info.owner ? { parentId: entry.info.owner } : {}) },
    ...children.map(child => ({ op: "node.parent", id: child.info.surfaceId!, parentId: id } as const)),
  ] };
}

function group(context: SourceContext, entries: Entry[], id: string): SourceChange {
  for (const entry of entries) checkLocation(entry);
  if (context.nodes.some(other => other.info.surfaceId === id)) refuse("The group ID already belongs to a Surface.");
  if (entries.some(entry => !entry.info.surfaceId) || new Set(entries).size !== entries.length) refuse("Choose distinct Surface siblings with literal IDs. Promote ordinary elements first.");
  const parent = entries[0].jsx.parent;
  if (!(ts.isJsxElement(parent) || ts.isJsxFragment(parent)) || !entries.every(entry => entry.jsx.parent === parent)) refuse("Spatial grouping requires contiguous JSX siblings in the same file.");
  const children = parent.children.filter(child => (ts.isJsxText(child) ? !!child.text.trim() : !ts.isJsxExpression(child) || !!child.expression));
  const indices = entries.map(entry => children.indexOf(entry.jsx)).sort((a, b) => a - b);
  if (indices[0] < 0 || indices.at(-1)! - indices[0] + 1 !== entries.length) refuse("The selected Surfaces have other JSX between them. Choose contiguous siblings or ask an agent to review the layout.");
  const start = children[indices[0]].getStart(context.source), end = children[indices.at(-1)!].end;
  const edits: Splice[] = [];
  const tag = symbol(context, "Surface", edits);
  const passthrough = sharedHostFile(context.outline.file) ? " passthrough" : "";
  edits.push({ start, end, text: `<${tag} id="${id}"${passthrough}>${context.source.text.slice(start, end)}</${tag}>` });
  const owner = entries[0].info.owner;
  return { text: splice(context, edits), ops: [{ op: "node.ensure", id, ...(owner ? { parentId: owner } : {}) }, ...entries.map(entry => ({ op: "node.parent", id: entry.info.surfaceId!, parentId: id } as const))] };
}

function expose(context: SourceContext, entry: Entry, request: Extract<SourceRequest, { kind: "expose" }>): SourceChange {
  const { prop, id, options } = request;
  const component = componentOf(entry.jsx);
  if (!component || !ts.isBlock(component.body)) return refuse("Expose a prop inside a function component with a block body so the hook can run unconditionally.");
  if (!entry.info.owner || entry.info.isSurface || ["key", "ref"].includes(prop)) return refuse("Choose a literal prop on an element inside a Surface. Layer identity, React keys, and refs cannot be exposed.");
  if (context.outline.animatables.some(item => item.id === id)) return refuse("Use a new animatable ID. An existing hook already declares this ID.");
  const attributes = entry.props?.properties ?? [];
  const index = attributes.findIndex(attr => ts.isJsxAttribute(attr) && attr.name.getText(context.source) === prop);
  const attr = attributes[index];
  if (!attr || !ts.isJsxAttribute(attr) || attributes.slice(index + 1).some(entry => ts.isJsxSpreadAttribute(entry) || entry.name.getText(context.source) === prop))
    return refuse("Choose a single explicit prop with no later spread that could override it.");
  const value = literal(attr.initializer);
  if (value === undefined) return refuse("The prop must be a literal number, boolean, color or enum value.");
  const color = typeof value === "string" && parseCssColor(value).ok;
  const type = options ? "enum" : color ? "color" : typeof value;
  if (options && (typeof value !== "string" || !options.includes(value) || new Set(options).size !== options.length)) return refuse("The enum needs distinct options including the current string value.");
  if (type === "string") return refuse("Provide two or more enum options for this string prop.");
  const edits: Splice[] = [];
  const hook = symbol(context, "useAnimatable", edits);
  const base = `velora${prop[0].toUpperCase()}${prop.slice(1)}`;
  let name = base;
  for (let n = 2; context.names.has(name); n++) name = base + n;
  const first = component.body.statements[0];
  const directives = component.body.statements.filter(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression));
  if (directives.some(statement => directive(statement, "use server"))) return refuse("Server functions cannot use an animatable React hook.");
  const point = directives.at(-1)?.end ?? component.body.getStart(context.source) + 1;
  const indentation = first ? /(?:^|\n)([\t ]*)[^\n]*$/.exec(context.source.text.slice(0, first.getStart(context.source)))?.[1] ?? "" : "";
  const indent = indentation || "  ";
  const fallback = sharedHostFile(context.outline.file) ? ', outsideScene: "defaults"' : "";
  const declaration = `const ${name} = ${hook}(${JSON.stringify(id)}, { ${prop}: { type: "${type}", default: ${JSON.stringify(value)}${options ? `, options: ${JSON.stringify(options)}` : ""} } }, { owner: ${JSON.stringify(entry.info.owner)}${fallback} });`;
  const rest = context.source.text.slice(point);
  edits.push({ start: point, end: point, text: context.newline + indent + declaration + (/^\s*[\r\n]/.test(rest) ? "" : context.newline + indent) });
  const initializer = attr.initializer;
  edits.push({ start: initializer?.getStart(context.source) ?? attr.end, end: initializer?.end ?? attr.end, text: `${initializer ? "" : "="}{${name}.${prop}}` });
  return { text: splice(context, edits), ops: [] };
}

export function transformSource(request: SourceRequest, text: string, needsClient: boolean, externalOwner?: string): SourceChange {
  if (/^(?:<{7}|={7}|>{7}|\|{7})(?:\s|$)/m.test(text)) return refuse("Resolve the file's merge markers before editing it.");
  const context = inspect(request.file, text);
  if (context.server || (needsClient && !context.client)) return refuse('Choose a client component. This file is server-only or lacks an explicit "use client" boundary in a Next App Router project.');
  if (externalOwner) for (const entry of context.nodes) entry.info.owner ??= externalOwner;
  const entry = find(context, request.node);
  if (request.kind === "wrap") return wrapElement(context, entry, request.id, !!request.content);
  if (request.kind === "group") {
    if (!request.nodes.includes(request.node)) return refuse("The primary node must be among the selected siblings.");
    return group(context, request.nodes.map(path => find(context, path)), request.id);
  }
  return expose(context, entry, request);
}
