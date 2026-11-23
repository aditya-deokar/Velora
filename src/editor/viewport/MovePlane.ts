import { intersectPlane, matrixFor, multiply, projectWorld, screenRay, TransformSchema, type CameraDefinition, type EditOp, type Matrix, type Transform } from "../../core";
import { intentToOps, type IntentContext } from "../intents";
import type { Doc } from "../store";
import type { Frame } from "./scene";

/** Move gizmo math (Phase 06.3): a drag moves the layer in its parent's plane at its own depth, so the
 * grabbed point follows the cursor exactly under perspective (screenRay + intersectPlane). Pure. */
export type Point = { x: number; y: number };
const apply = (m: Matrix, [x, y, z]: readonly number[]) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
/** The parent-local plane the layer slides in: the parent frame translated to the layer's own z. */
export const movePlane = (parent: Matrix, z: number): Matrix => multiply(parent, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, z, 0, 0, 0, 1]);
export type MoveInput = {
  camera: CameraDefinition; frame: Frame; parent: Matrix; start: Transform;
  from: Point; to: Point;
  axis?: "x" | "y"; shift?: boolean;
  /** Projected layer center at drag start and guide lines (frame px) to snap it to. */
  center?: Point; guides?: { x: number[]; y: number[] }; threshold?: number;
};
/** New x/y for a move drag, or null when the plane is edge-on or behind the camera. */
export function moveTo(input: MoveInput): { x: number; y: number; snapped?: { x?: number; y?: number } } | null {
  const plane = movePlane(input.parent, input.start.z);
  const a = intersectPlane(screenRay(input.camera, input.frame, input.from), plane);
  const b = intersectPlane(screenRay(input.camera, input.frame, input.to), plane);
  if (!a || !b) return null;
  let du = input.axis === "y" ? 0 : b.u - a.u, dv = input.axis === "x" ? 0 : b.v - a.v;
  const snapped: { x?: number; y?: number } = {};
  if (input.center && input.guides && !input.shift) {
    // Snap the moved center to a guide in projected space, then solve that screen point back to the plane.
    const origin = intersectPlane(screenRay(input.camera, input.frame, input.center), plane);
    const moved = origin && projectWorld(input.camera, input.frame, apply(plane, [origin.u + du, origin.v + dv, 0]), "view");
    const threshold = input.threshold ?? 8;
    if (origin && moved) {
      const gx = input.guides.x.find(line => Math.abs(line - moved.x) <= threshold), gy = input.guides.y.find(line => Math.abs(line - moved.y) <= threshold);
      if (gx !== undefined || gy !== undefined) {
        const hit = intersectPlane(screenRay(input.camera, input.frame, { x: gx ?? moved.x, y: gy ?? moved.y }), plane);
        if (hit) {
          if (gx !== undefined && input.axis !== "y") { du = hit.u - origin.u; snapped.x = gx; }
          if (gy !== undefined && input.axis !== "x") { dv = hit.v - origin.v; snapped.y = gy; }
        }
      }
    }
  }
  let x = input.start.x + du, y = input.start.y + dv;
  if (input.shift) { x = Math.round(x / 10) * 10; y = Math.round(y / 10) * 10; }
  return { x: round(x), y: round(y), ...(snapped.x !== undefined || snapped.y !== undefined ? { snapped } : {}) };
}
/** Depth push: drag down brings the layer toward the camera, scaled so one pixel is about one pixel. */
export function pushTo(start: Transform, depth: number, perspective: number, dy: number, shift = false): number {
  const z = start.z + (dy * depth) / perspective;
  return round(shift ? Math.round(z / 10) * 10 : z);
}
/** Guide lines in frame px: center, rule of thirds and the title/action safe edges. */
export function guideLines(frame: Frame): { x: number[]; y: number[] } {
  const xs = [0.5, 1 / 3, 2 / 3, 0.05, 0.95, 0.1, 0.9].map(f => f * frame.width), ys = [0.5, 1 / 3, 2 / 3, 0.05, 0.95, 0.1, 0.9].map(f => f * frame.height);
  return { x: xs, y: ys };
}
export const round = (value: number) => Math.round(value * 1000) / 1000;
/** Value changes on one target through intentToOps (auto-key and static semantics identical to the
 * inspector). Unchanged properties produce no op. */
export function setOps(doc: Doc, target: { kind: "surface"; id: string } | { kind: "camera" } | { kind: "focus" }, values: Record<string, number>,
  before: Record<string, number | undefined>, context: IntentContext): EditOp[] {
  return Object.entries(values).flatMap(([property, value]) => {
    const previous = before[property];
    if (previous !== undefined && Math.abs(previous - value) < 1e-9) return [];
    return intentToOps({ kind: "set", track: { target, property } as never, value }, doc, context);
  });
}
/** The linear part of a layer's local transform (rotation, scale, skew), for compensation math. */
export function linearOf(t: Transform): Matrix {
  return matrixFor(TransformSchema.parse({ ...t, x: 0, y: 0, z: 0 }));
}
