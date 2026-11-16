/** Graph-editor handles ↔ cubicBezier easing (exact, pure). For segment k→k+1 with easing
 * cubicBezier [x1, y1, x2, y2] on keyframe k: the out-handle of k sits at (t_k + x1·Δt, v_k + y1·Δv) and the
 * in-handle of k+1 at (t_k + x2·Δt, v_k + y2·Δv). x clamps to [0, 1] and y to [−5, 5] (the schema range). */
export type Point = { t: number; v: number };
export type Segment = { t0: number; v0: number; t1: number; v1: number };
export type Bezier = [number, number, number, number];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
export function handlesOf(segment: Segment, bezier: Bezier): { out: Point; in: Point } {
  const dt = segment.t1 - segment.t0, dv = segment.v1 - segment.v0;
  return { out: { t: segment.t0 + bezier[0] * dt, v: segment.v0 + bezier[1] * dv }, in: { t: segment.t0 + bezier[2] * dt, v: segment.v0 + bezier[3] * dv } };
}
/** Bezier from handle positions; a flat segment (Δv = 0) keeps the previous y values (edit it in speed mode). */
export function bezierOf(segment: Segment, out: Point, into: Point, previous: Bezier = [0.333, 0, 0.667, 1]): Bezier {
  const dt = segment.t1 - segment.t0, dv = segment.v1 - segment.v0;
  const x = (point: Point) => clamp(dt > 0 ? (point.t - segment.t0) / dt : 0, 0, 1);
  const y = (point: Point, fallback: number) => Math.abs(dv) < 1e-12 ? fallback : clamp((point.v - segment.v0) / dv, -5, 5);
  return [x(out), y(out, previous[1]), x(into), y(into, previous[3])];
}
/** Velocity (value per ms) at the end of a segment (s = 1) and at its start (s = 0). */
export function endSlope(segment: Segment, bezier: Bezier): number {
  const dt = segment.t1 - segment.t0;
  return (1 - bezier[2]) === 0 ? Infinity : ((segment.v1 - segment.v0) * (1 - bezier[3])) / ((1 - bezier[2]) * dt);
}
export function startSlope(segment: Segment, bezier: Bezier): number {
  const dt = segment.t1 - segment.t0;
  return bezier[0] === 0 ? Infinity : ((segment.v1 - segment.v0) * bezier[1]) / (bezier[0] * dt);
}
/** Continuous mode at the shared keyframe: set the in-handle of `before` and the out-handle of `after` so
 * both segments leave and arrive with the same velocity (`slope`, default the mean of the current two). */
export function makeContinuous(before: { segment: Segment; bezier: Bezier }, after: { segment: Segment; bezier: Bezier }, slope?: number): { before: Bezier; after: Bezier } {
  const finite = [endSlope(before.segment, before.bezier), startSlope(after.segment, after.bezier)].filter(Number.isFinite);
  const m = slope ?? (finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0);
  const dt1 = before.segment.t1 - before.segment.t0, dv1 = before.segment.v1 - before.segment.v0;
  const dt2 = after.segment.t1 - after.segment.t0, dv2 = after.segment.v1 - after.segment.v0;
  const x2 = Math.min(before.bezier[2], 1 - 1e-6), x1 = Math.max(after.bezier[0], 1e-6);
  // In-handle of `before`: v = v1 - m·(1 - x2)·Δt1 → y2 = (v − v0)/Δv1. Out-handle of `after`: v = v1 + m·x1·Δt2.
  const y2 = Math.abs(dv1) < 1e-12 ? before.bezier[3] : clamp(1 - (m * (1 - x2) * dt1) / dv1, -5, 5);
  const y1 = Math.abs(dv2) < 1e-12 ? after.bezier[1] : clamp((m * x1 * dt2) / dv2, -5, 5);
  return { before: [before.bezier[0], before.bezier[1], x2, y2], after: [x1, y1, after.bezier[2], after.bezier[3]] };
}
/** Spring diagnostics over a segment of `durationMs`: overshoot (fraction above 1) and settle time
 * (last time the eased progress is outside ±0.1% of 1), sampled with the canonical easing. */
export function springStats(sample: (progress: number) => number, durationMs: number, samples = 600): { overshoot: number; settleMs: number } {
  let peak = 0, settle = 0;
  for (let i = 0; i <= samples; i++) {
    const p = i / samples, y = sample(p);
    peak = Math.max(peak, y);
    if (Math.abs(y - 1) > 0.001) settle = p;
  }
  return { overshoot: Math.max(0, peak - 1), settleMs: settle * durationMs };
}
