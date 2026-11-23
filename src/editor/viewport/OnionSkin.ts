import { surfaceQuad, type CameraDefinition, type ProjectedPoint } from "../../core";
import type { SceneSnapshot } from "../../react";
import type { Doc } from "../store";
import { sceneAt, type Frame } from "./scene";

/** Onion skin (Phase 06.4): ghost outlines of the selected layers at ±N frames, as projected quads from
 * the evaluator (never a second render of host DOM). Pure. */
export type Ghost = { id: string; offset: number; quad: ProjectedPoint[] };
export function onionSkin(doc: Doc, snapshot: SceneSnapshot, ids: readonly string[], camera: CameraDefinition, frame: Frame,
  timeMs: number, fps: number, options: { frames?: number; step?: number; durationMs?: number } = {}): Ghost[] {
  const count = options.frames ?? 3, step = options.step ?? 2, duration = options.durationMs ?? Infinity;
  const out: Ghost[] = [];
  for (let k = -count; k <= count; k++) {
    if (k === 0) continue;
    const at = timeMs + (k * step * 1000) / fps;
    if (at < 0 || at > duration) continue;
    const evaluation = sceneAt(doc, snapshot, at, camera);
    for (const id of ids) {
      const node = evaluation.nodes.find(entry => entry.id === id);
      if (!node || !(node.width > 0)) continue;
      const quad = surfaceQuad(node, camera, frame);
      if (quad.every(Boolean)) out.push({ id, offset: k, quad: quad as ProjectedPoint[] });
    }
  }
  return out;
}
