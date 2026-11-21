import { intersectPlane, screenRay, type CameraDefinition, type EditOp, type Matrix } from "../../core";
import type { SceneSnapshot } from "../../react";
import type { Doc } from "../store";
import { findTrack, snapToFrame } from "../model";
import { toPresentation } from "../properties";
import { toStage, toView } from "./CameraTool";
import { sceneAt, type Frame } from "./scene";

/** Focus tool math (Phase 06.7): clicking a surface point sets focus.distance to its camera-axis depth
 * for the real camera (also from the director view); Shift+click follows the surface; the rack helper
 * writes two focus keyframes that land sharp on two layers. Pure. */
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
  const depthAt = (id: string, authoredMs: number) => {
    const evaluation = sceneAt(doc, snapshot, toPresentation(doc, authoredMs));
    const node = evaluation.nodes.find(entry => entry.id === id);
    return node && evaluation.camera ? Math.round((evaluation.camera.perspective - node.world[11]) * 100) / 100 : undefined;
  };
  const a = depthAt(from, start), b = depthAt(to, end);
  if (a === undefined || b === undefined || a <= 0 || b <= 0) return null;
  const track = { target: { kind: "focus" as const }, property: "distance" };
  const existing = findTrack(doc, track);
  const ops: EditOp[] = existing
    ? [{ op: "key.set", track, atMs: start, value: a, easing: "cinematic" } as EditOp, { op: "key.set", track, atMs: end, value: b } as EditOp]
    : [{ op: "track.add", track, keyframes: [{ timeMs: start, value: a, easing: "cinematic" }, { timeMs: end, value: b }] } as EditOp];
  return { ops, distances: [a, b] };
}
