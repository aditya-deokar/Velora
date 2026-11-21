import type { DepthEvidence } from "../../core/depth";

const sources = new Set<{ scope: Element; read: () => DepthEvidence; revert: () => void }>();
export function registerDepthEvidence(scope: Element, read: () => DepthEvidence, revert: () => void) {
  const source = { scope, read, revert };
  sources.add(source);
  return () => { sources.delete(source); };
}
export function captureDepth(viewport: Element | null) {
  if (!viewport) return [];
  return [...sources].filter(source => viewport.contains(source.scope)).map(source => source.read())
    .filter(entry => entry.layers.length > 0)
    .sort((a, b) => a.surface.localeCompare(b.surface) || a.hash.localeCompare(b.hash));
}
export function revertCaptureDepth(viewport: Element | null) {
  if (viewport) for (const source of sources) if (viewport.contains(source.scope)) source.revert();
}
