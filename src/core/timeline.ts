import { z } from "zod";
import { ExportFrameRateSchema } from "./export";
import type { Composition } from "./composition";

/** SOURCE OF TRUTH: TimelineSchema, frame clock, segment resolution.
 * WHAT: multi-scene timelines built from compositions plus the integer-exact frame clock.
 * WHY: preview scrubbing, frame capture and video encoding must agree on what frame N means.
 * WHERE: export frame/video rendering and the preview session resolve segments through these helpers.
 * Frame math is integer-exact and documented once here: frame = round(timeMs * fps / 1000),
 * timeMs = frame * 1000 / fps. Gaps between segments render black void (explicit, not an
 * error); overlaps are rejected. No wall-clock, no unseeded randomness, no layout reads.
 */
export const TimelineSegmentSchema = z.strictObject({
  id: z.string().min(1).max(128),
  recipe: z.string().min(1).max(128),
  startMs: z.number().finite().nonnegative(),
  durationMs: z.number().finite().positive(),
  // Optional trim into the scene's own authored timeline (presentation ms).
  inMs: z.number().finite().nonnegative().optional(),
});
export type TimelineSegment = z.output<typeof TimelineSegmentSchema>;
export const TimelineSchema = z.strictObject({
  version: z.literal(1),
  fps: ExportFrameRateSchema,
  durationMs: z.number().finite().nonnegative(),
  segments: z.array(TimelineSegmentSchema).min(1),
});
export type Timeline = z.output<typeof TimelineSchema>;
export type TimelineIssue = { code: string; path: string; message: string };

// Canonical frame sampler: every renderer (preview scrub, frame capture,
// video encoding) converts through these two functions and no other math.
export function frameAt(timeMs: number, fps: number): number {
  if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error("Frame time must be finite and nonnegative.");
  if (!Number.isInteger(fps) || fps <= 0) throw new Error("Frame rate must be a positive integer.");
  return Math.round((timeMs * fps) / 1000);
}
export function timeAtFrame(frame: number, fps: number): number {
  if (!Number.isInteger(frame) || frame < 0) throw new Error("Frame index must be a nonnegative integer.");
  if (!Number.isInteger(fps) || fps <= 0) throw new Error("Frame rate must be a positive integer.");
  return (frame * 1000) / fps;
}
export function timelineDuration(segments: readonly { startMs: number; durationMs: number }[]): number {
  return segments.reduce((total, segment) => Math.max(total, segment.startMs + segment.durationMs), 0);
}
// The segment owning global time t: startMs <= t < startMs + durationMs.
// Returns undefined at/after the end so callers fail closed on out-of-range frames.
export function segmentAt(timeline: Pick<Timeline, "segments">, timeMs: number): TimelineSegment | undefined {
  return timeline.segments.find((segment) => timeMs >= segment.startMs && timeMs < segment.startMs + segment.durationMs);
}
// Scene-local presentation time for a global time inside the segment.
export function localTime(segment: Pick<TimelineSegment, "startMs"> & { inMs?: number }, timeMs: number): number {
  return timeMs - segment.startMs + (segment.inMs ?? 0);
}
// Segment boundary jumps for CLI-driven agents: nearest boundary strictly
// after (next) or strictly before-or-at-segment-start (previous) global time.
export function nextBoundary(timeline: Pick<Timeline, "segments" | "durationMs">, timeMs: number): number | undefined {
  const edges = timeline.segments.map((segment) => segment.startMs + segment.durationMs).filter((edge) => edge > timeMs).sort((a, b) => a - b);
  const end = edges[0];
  return end !== undefined && end <= timeline.durationMs ? end : undefined;
}
export function prevBoundary(timeline: Pick<Timeline, "segments">, timeMs: number): number | undefined {
  const starts = timeline.segments.map((segment) => segment.startMs).filter((start) => start < timeMs).sort((a, b) => b - a);
  return starts[0];
}
// Overlaps are rejected (ERR_TIMELINE_OVERLAP); gaps are explicit black void.
export function validateTimeline(timeline: unknown): { valid: boolean; issues: TimelineIssue[] } {
  const parsed = TimelineSchema.safeParse(timeline);
  if (!parsed.success)
    return { valid: false, issues: parsed.error.issues.map((issue) => ({ code: "ERR_TIMELINE_INVALID", path: `timeline.${issue.path.join(".")}`, message: issue.message })) };
  const issues: TimelineIssue[] = [];
  const ordered = [...parsed.data.segments].sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const prevEnd = prev.startMs + prev.durationMs;
    if (ordered[i].startMs < prevEnd)
      issues.push({ code: "ERR_TIMELINE_OVERLAP", path: `timeline.segments.${parsed.data.segments.indexOf(ordered[i])}`, message: `Segment "${ordered[i].id}" starts at ${ordered[i].startMs}ms but "${prev.id}" runs until ${prevEnd}ms. Butt-join segments or trim them; overlaps are rejected.` });
  }
  const span = timelineDuration(parsed.data.segments);
  if (span > parsed.data.durationMs)
    issues.push({ code: "ERR_TIMELINE_OVERLAP", path: "timeline.durationMs", message: `Segments span ${span}ms but the timeline declares ${parsed.data.durationMs}ms.` });
  return { valid: issues.length === 0, issues };
}
// Build a timeline from a validated composition: one segment per scene entry,
// global duration derived from the span. Transition metadata (Phase 05) rides
// on segments without changing timing here.
export function timelineFromComposition(composition: Pick<Composition, "fps" | "scenes">): Timeline {
  const segments = composition.scenes.map((scene) => ({ id: scene.id, recipe: scene.recipe, startMs: scene.startMs, durationMs: scene.durationMs }));
  return TimelineSchema.parse({ version: 1 as const, fps: composition.fps, durationMs: timelineDuration(segments), segments });
}
