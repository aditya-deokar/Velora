/** Rotate gizmo math (Phase 06.3): rotateZ follows the cursor angle around the projected center; the
 * rotateX / rotateY rings turn with vertical / horizontal drag (0.5° per px). Shift snaps to 15°. Pure. */
export type Point = { x: number; y: number };
export type RingAxis = "rotateX" | "rotateY" | "rotateZ";
const DEG = 180 / Math.PI;
export function ringDelta(axis: RingAxis, center: Point, from: Point, to: Point): number {
  if (axis === "rotateZ") {
    let delta = (Math.atan2(to.y - center.y, to.x - center.x) - Math.atan2(from.y - center.y, from.x - center.x)) * DEG;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
  }
  return axis === "rotateX" ? -(to.y - from.y) * 0.5 : (to.x - from.x) * 0.5;
}
/** The new angle; Shift snaps the result (not the delta) to multiples of 15°. */
export function rotateTo(start: number, delta: number, shift = false): number {
  const value = start + delta;
  return shift ? Math.round(value / 15) * 15 : Math.round(value * 1000) / 1000;
}
/** Accumulate a rotateZ drag across the ±180° seam (cursor turning more than half a circle). */
export function unwrap(previous: number, next: number): number {
  let value = next;
  while (value - previous > 180) value -= 360;
  while (value - previous < -180) value += 360;
  return value;
}
