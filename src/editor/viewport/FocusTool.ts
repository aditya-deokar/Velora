import { focalLengthForPerspective, intersectPlane, LENS_PRESETS, screenRay, type CameraDefinition, type EditOp, type Matrix, type RackTarget } from "../../core";
import type { SceneSnapshot } from "../../react";
import type { Doc } from "../store";
import { snapToFrame } from "../model";
import { toPresentation } from "../properties";
import { toStage, toView } from "./CameraTool";
import { sceneAt, type Frame } from "./scene";

/** Focus tool math (Phase 06.7): clicking a surface point sets focus.distance to its camera-axis depth
 * for the real camera (also from the director view); Shift+click follows the surface; the rack helper
 * authors a rack and its lens breathing together. Pure. */
const apply = (m: Matrix, [x, y, z]: readonly number[]) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
export type SurfaceHit = { u: number; v: number; depth: number; anchor: [number, number] };
/** Where the cursor meets a Surface (display space) and the real camera's depth of that point. */
export function focusHit(display: CameraDefinition, real: CameraDefinition, frame: Frame, node: { world: Matrix; width: number; height: number }, point: { x: number; y: number }): SurfaceHit | null {
  const hit = intersectPlane(screenRay(display, frame, point), node.world);
  if (!hit) return null;
  const viewPoint = apply(node.world, [hit.u, hit.v, 0]);
  const stage = toStage(display, viewPoint);
  const depth = real.perspective - toView(real, stage)[2];
  const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
  return { u: hit.u, v: hit.v, depth: Math.round(depth * 100) / 100, anchor: [clamp(hit.u / node.width + 0.5), clamp(hit.v / node.height + 0.5)] };
}
export function followOps(doc: Doc, surface: string, anchor: [number, number]): EditOp[] {
  const constraints: { kind: string }[] = doc?.definition?.scene?.constraints ?? [];
  const index = constraints.findIndex(entry => entry.kind === "focusFollow");
  return [{ op: "constraint.set", ...(index >= 0 ? { index } : {}), constraint: { kind: "focusFollow", target: { surface, anchor } } } as EditOp];
}
/** Rack focus between two layers over [startMs, endMs] (authored time): the focus distance at each end
 * equals that layer's center depth for the evaluated camera at that time, with a cinematic ease. */
export function rackOps(doc: Doc, snapshot: SceneSnapshot, from: string, to: string, startMs: number, endMs: number, fps: number): { ops: EditOp[]; distances: [number, number] } | null {
  const start = snapToFrame(startMs, fps), end = snapToFrame(endMs, fps);
  if (!(end > start)) return null;
  const depthAt = (id: string, authoredMs: number): { depth: number; target: RackTarget } | undefined => {
    const layer = /^depth:(\d+):(\d+)$/.exec(id);
    if (layer) {
      const surface = snapshot.depth?.[Number(layer[1])], index = Number(layer[2]);
      const match = surface?.layers[index]?.match, sample = surface?.focus?.[index];
      if (surface && match && sample) return { depth: sample.depth, target: { surface: surface.surface, layer: "anchor" in match ? match.anchor : match.selector } };
      return;
    }
    const evaluation = sceneAt(doc, snapshot, toPresentation(doc, authoredMs));
    const node = evaluation.nodes.find(entry => entry.id === id);
    return node && evaluation.camera ? { depth: evaluation.camera.perspective - node.world[11], target: { surface: id, anchor: [0.5, 0.5] } } : undefined;
  };
  const a = depthAt(from, start), b = depthAt(to, end);
  if (!a || !b || a.depth <= 0 || b.depth <= 0) return null;
  const mm = focalLengthForPerspective(snapshot.camera?.perspective ?? 1400, doc?.definition?.height ?? 980);
  const preset = Object.values(LENS_PRESETS).find(lens => Math.abs(lens.mm - mm) < 0.001);
  return { distances: [a.depth, b.depth], ops: [{ op: "rack.add", from: a.target, to: b.target, atMs: start, durationMs: end - start,
    depths: { from: a.depth, to: b.depth }, ...(preset ? { breathing: { amount: preset.breathing, direction: "in" } } : {}) }] };
}
