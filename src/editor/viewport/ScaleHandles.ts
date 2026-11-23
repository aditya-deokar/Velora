import type { Transform } from "../../core";
import { linearOf, round } from "./MovePlane";

/** Scale gizmo math (Phase 06.3): corner handles scale uniformly about the opposite corner (position
 * compensates so that corner stays put), Alt scales about the pivot; side handles write scaleX/scaleY
 * (01.2) about the pivot. Pure. */
export type Point = { x: number; y: number };
/** Drag factor projected on the anchor→handle direction (never negative or zero). */
export function dragFactor(anchor: Point, from: Point, to: Point): number {
  const ax = from.x - anchor.x, ay = from.y - anchor.y;
  const length = ax * ax + ay * ay;
  if (length < 1e-9) return 1;
  return Math.max(0.01, ((to.x - anchor.x) * ax + (to.y - anchor.y) * ay) / length);
}
const pivotOffset = (t: Transform, width: number, height: number): [number, number] =>
  [(((t.originX ?? 50) - 50) / 100) * width, (((t.originY ?? 50) - 50) / 100) * height];
/** Uniform scale by `factor`, keeping the local point `fixed` (centered Surface coordinates) in place
 * unless `aboutPivot`. Returns the properties to write. */
export function scaleUniform(start: Transform, width: number, height: number, factor: number, fixed: Point, aboutPivot: boolean, shift = false): Record<string, number> {
  const scale = shift ? Math.max(0.05, Math.round(start.scale * factor * 20) / 20) : round(start.scale * factor);
  const f = scale / start.scale;
  if (aboutPivot) return { scale };
  // Local point q maps to pos + offset + o + M(q - o); scaling M by f moves it by (f - 1)·M(q - o).
  const [ox, oy] = pivotOffset(start, width, height);
  const m = linearOf(start);
  const qx = fixed.x - ox, qy = fixed.y - oy;
  const dx = (1 - f) * (m[0] * qx + m[1] * qy), dy = (1 - f) * (m[4] * qx + m[5] * qy), dz = (1 - f) * (m[8] * qx + m[9] * qy);
  return { scale, x: round(start.x + dx), y: round(start.y + dy), ...(Math.abs(dz) > 1e-9 ? { z: round(start.z + dz) } : {}) };
}
/** One axis (scaleX or scaleY) about the pivot. */
export function scaleAxis(start: Transform, axis: "scaleX" | "scaleY", factor: number, shift = false): Record<string, number> {
  const value = (start[axis] ?? 1) * factor;
  return { [axis]: shift ? Math.max(0.05, Math.round(value * 20) / 20) : round(Math.max(0.01, value)) };
}
