import { frameAt, timeAtFrame } from "../../core";

/** Timeline snapping (pure). Results always land on the frame grid through the core frame math; with
 * snapping on (Shift suspends it) the nearest candidate within the pixel threshold wins, ties broken by
 * kind priority. Times here are presentation milliseconds. */
export type SnapKind = "playhead" | "keyframe" | "marker" | "clip" | "beat" | "frame";
export type SnapCandidate = { timeMs: number; kind: Exclude<SnapKind, "frame"> };
export const SNAP_PRIORITY: Record<SnapCandidate["kind"], number> = { playhead: 0, keyframe: 1, marker: 2, clip: 3, beat: 4 };
export const SNAP_THRESHOLD_PX = 8;
export function quantize(timeMs: number, fps: number): number {
  return timeAtFrame(frameAt(Math.max(0, timeMs), fps), fps);
}
export function snapTime(timeMs: number, options: { fps: number; pxPerMs: number; candidates: readonly SnapCandidate[]; enabled: boolean; thresholdPx?: number }): { timeMs: number; kind: SnapKind } {
  const threshold = (options.thresholdPx ?? SNAP_THRESHOLD_PX) / Math.max(1e-9, options.pxPerMs);
  if (options.enabled) {
    let best: SnapCandidate | undefined, bestDistance = Infinity;
    for (const candidate of options.candidates) {
      const distance = Math.abs(candidate.timeMs - timeMs);
      if (distance > threshold) continue;
      if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) <= 1e-9 && best && SNAP_PRIORITY[candidate.kind] < SNAP_PRIORITY[best.kind])) { best = candidate; bestDistance = distance; }
    }
    if (best) return { timeMs: quantize(best.timeMs, options.fps), kind: best.kind };
  }
  return { timeMs: quantize(timeMs, options.fps), kind: "frame" };
}
