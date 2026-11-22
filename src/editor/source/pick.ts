import type { SourceDocument, SourceNode } from "../../core";

export type SourceHint = {
  tag: string; text: string; surface?: string; id?: string; className?: string;
  element?: Element;
  anchorEdit?: boolean;
  location?: { file: string; line: number; column: number },
};

/** Code Inspector emits file:line:column with an optional tag suffix. A Windows drive prefix is part of the file. */
export function parseInspectorLocation(value: string | null | undefined): SourceHint["location"] {
  const match = /^(.*\.(?:tsx|jsx)):(\d+):(\d+)(?::[^:\r\n]+)?$/i.exec(value ?? "");
  if (!match || Number(match[2]) < 1 || !Number.isSafeInteger(Number(match[2])) || !Number.isSafeInteger(Number(match[3]))) return;
  return { file: match[1], line: Number(match[2]), column: Number(match[3]) };
}

export function pickSourceElement(x: number, y: number): SourceHint | undefined {
  const hit = document.elementsFromPoint(x, y).find(element => !element.closest("[data-velora-preview-chrome]")
    && element.closest("[data-velora-scene]") && !element.matches("[data-velora-content],[data-velora-stage],[data-velora-scene]"));
  if (!hit) return;
  const inspector = hit.closest("[data-insp-path]");
  return {
    element: hit,
    tag: hit.localName, text: (hit.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
    surface: hit.closest("[data-velora-id]")?.getAttribute("data-velora-id") ?? undefined,
    id: hit.id || undefined, className: hit.getAttribute("class") ?? undefined,
    location: inspector?.closest("[data-velora-scene]") ? parseInspectorLocation(inspector.getAttribute("data-insp-path")) : undefined,
  };
}

export function sourceCandidates(documents: SourceDocument[], hint?: SourceHint): { node: SourceNode; score: number }[] {
  if (!hint) return [];
  const all = documents.flatMap(doc => doc.nodes);
  const lookup = new Map(all.map(node => [node.path, node]));
  const inSurface = (node: SourceNode) => {
    if (!hint.surface) return false;
    for (let current: SourceNode | undefined = node; current; current = current.parent ? lookup.get(current.parent) : undefined)
      if (current.surfaceId === hint.surface || current.owner === hint.surface) return true;
    return false;
  };
  return all.map(node => ({ node, score: (node.tag.toLowerCase() === hint.tag ? 4 : 0) + (hint.text && node.text === hint.text ? 8 : 0)
    + (hint.id && node.attributes.id === hint.id ? 16 : 0) + (hint.className && node.attributes.className === hint.className ? 3 : 0) + (inSurface(node) ? 6 : 0) }))
    .filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score);
}

export function mappedSourceNode(files: SourceDocument[], hint: SourceHint): SourceNode | undefined {
  const location = hint.location;
  if (!location) return;
  const candidates = files.flatMap(file => file.nodes).filter(node => node.start.line === location.line && Math.abs(node.start.column - location.column) <= 1);
  return candidates.sort((a, b) => Math.abs(a.start.column - location.column) - Math.abs(b.start.column - location.column))[0];
}

export function codeLink(absolute: string, at: { line: number; column: number }) {
  const path = absolute.replaceAll("\\", "/");
  const encoded = path.split("/").map(part => /^[a-zA-Z]:$/.test(part) ? part : encodeURIComponent(part)).join("/");
  return `vscode://file${encoded.startsWith("/") ? "" : "/"}${encoded}:${at.line}:${at.column}`;
}
