import { z } from "zod";
import { ExportFrameRateSchema } from "./export";
import type { Composition } from "./composition";
import { SegmentTransitionSchema, isOverlapTransition, type SegmentTransition } from "./transitions";
import { EasingSchema, applyEasing } from "./easing";

/** SOURCE OF TRUTH: TimelineSchema, frame clock, segment resolution, layersAt.
 * WHAT: multi-scene timelines built from compositions plus the integer-exact frame clock.
 * WHY: preview scrubbing, frame capture and video encoding must agree on what frame N means.
 * WHERE: export frame/video rendering and the preview session resolve segments through these helpers.
 * Frame math is integer-exact and documented once here: frame = round(timeMs * fps / 1000),
 * timeMs = frame * 1000 / fps. Gaps between segments render black void (explicit, not an
 * error); overlaps are rejected except the exact window of a declared overlap transition, where both
 * segments render at their own local times and layersAt reports the blend progress.
 * No wall-clock, no unseeded randomness, no layout reads.
 */
export const TimelineSegmentSchema = z.strictObject({
  id: z.string().min(1).max(128),
  recipe: z.string().min(1).max(128),
  startMs: z.number().finite().nonnegative(),
  durationMs: z.number().finite().positive(),
  // Optional trim into the scene's own authored timeline (presentation ms).
  inMs: z.number().finite().nonnegative().optional(),
  // The transition into this segment; overlap types begin durationMs before the previous segment ends.
  transition: SegmentTransitionSchema.optional(),
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
    const prev = ordered[i - 1], segment = ordered[i];
    const prevEnd = prev.startMs + prev.durationMs;
    const path = `timeline.segments.${parsed.data.segments.indexOf(segment)}`;
    if (segment.startMs >= prevEnd) continue;
    const transition = segment.transition;
    // The only legal overlap: an overlap transition whose window is exactly the overlap, shorter than both shots.
    if (transition && isOverlapTransition(transition.type)) {
      const overlap = prevEnd - segment.startMs;
      if (Math.abs(overlap - transition.durationMs) > 0.5)
        issues.push({ code: "ERR_TIMELINE_OVERLAP", path, message: `Segment "${segment.id}" overlaps "${prev.id}" by ${round(overlap)}ms but its ${transition.type} lasts ${transition.durationMs}ms. Start it at ${round(prevEnd - transition.durationMs)}ms.` });
      else if (transition.durationMs >= Math.min(prev.durationMs, segment.durationMs))
        issues.push({ code: "ERR_TIMELINE_OVERLAP", path, message: `The ${transition.type} (${transition.durationMs}ms) must be shorter than both "${prev.id}" and "${segment.id}".` });
      else if (i >= 2 && ordered[i - 2].startMs + ordered[i - 2].durationMs > segment.startMs)
        issues.push({ code: "ERR_TIMELINE_OVERLAP", path, message: `Segment "${segment.id}" would overlap three segments at once; leave room between transitions.` });
      continue;
    }
    issues.push({ code: "ERR_TIMELINE_OVERLAP", path, message: `Segment "${segment.id}" starts at ${segment.startMs}ms but "${prev.id}" runs until ${prevEnd}ms. Butt-join segments, trim them, or declare an overlap transition (${"crossfade, dip-to-black, wipe, whip, …"}) lasting exactly the overlap.` });
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
  const segments = composition.scenes.map((scene) => ({ id: scene.id, recipe: scene.recipe, startMs: scene.startMs, durationMs: scene.durationMs, ...(scene.transition ? { transition: scene.transition } : {}) }));
  return TimelineSchema.parse({ version: 1 as const, fps: composition.fps, durationMs: timelineDuration(segments), segments });
}

const round = (value: number) => Math.round(value * 100) / 100;
export type FrameLayers = {
  /** V1 segments visible at this time (one, two inside an overlap window, none in a gap), in timeline order. */
  segments: { segment: TimelineSegment; localMs: number }[];
  /** Present inside an overlap window: blend from segments[0] (A) to segments[1] (B) at eased progress. */
  blend?: { transition: SegmentTransition; progress: number };
};
/** Which V1 segments make up global time t, and how they blend. */
export function layersAt(timeline: Pick<Timeline, "segments" | "durationMs">, timeMs: number): FrameLayers {
  const ordered = [...timeline.segments].sort((a, b) => a.startMs - b.startMs);
  const active = ordered.filter(segment => timeMs >= segment.startMs && timeMs < segment.startMs + segment.durationMs);
  const segments = active.map(segment => ({ segment, localMs: localTime(segment, timeMs) }));
  if (active.length === 2 && active[1].transition && isOverlapTransition(active[1].transition.type)) {
    const transition = active[1].transition;
    const raw = Math.max(0, Math.min(1, (timeMs - active[1].startMs) / transition.durationMs));
    const progress = transition.ease ? applyEasing(EasingSchema.parse(transition.ease), raw) : raw;
    return { segments, blend: { transition, progress } };
  }
  return { segments: segments.slice(-1) };
}
