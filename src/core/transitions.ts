import { z } from "zod";
import { MotionTrackSchema, type MotionTrack } from "./motion";
import { createCascadeTracks } from "./choreography";

/** SOURCE OF TRUTH: TransitionTypeSchema, transition builders.
 * WHAT: the transition catalog plus pure builders compiling transitions to motion tracks.
 * WHY: agents apply consistent entrances without hand-rolling keyframes.
 * WHERE: compositions declare segment entrances; builders emit tracks to paste
 * into scene recipe motion; validate checks declarations.
 * Entering-side model (butt-join timeline, totals unchanged): every transition
 * describes what the incoming scene does over the first durationMs of its
 * segment. True A/B crossfade compositing is out of scope: dissolve means the
 * entering leaves fade in. Wipe and iris are true masks: clip tracks on the
 * entering visual leaves (inset and circle clip-paths). No new render path.
 */
export const TransitionTypeSchema = z.enum([
  "cut", "dissolve", "slide-push", "wipe-mask", "iris-mask", "depth-dolly", "focus-pull", "cascade-handoff",
]);
export type TransitionType = z.output<typeof TransitionTypeSchema>;
export const SegmentTransitionSchema = z.strictObject({
  type: TransitionTypeSchema,
  durationMs: z.number().finite().positive().max(30_000),
});
export type SegmentTransition = z.output<typeof SegmentTransitionSchema>;
export const TRANSITION_CATALOG: { type: TransitionType; description: string; needsLeaves: boolean }[] = [
  { type: "cut", description: "Hard cut. No tracks, no overlap.", needsLeaves: false },
  { type: "dissolve", description: "Entering leaves fade from transparent over durationMs.", needsLeaves: true },
  { type: "slide-push", description: "Entering leaves travel along x from distance to rest.", needsLeaves: true },
  { type: "wipe-mask", description: "True left-to-right wipe: entering leaves reveal through an inset clip mask.", needsLeaves: true },
  { type: "iris-mask", description: "True iris: entering leaves open from the center through a circular clip mask.", needsLeaves: true },
  { type: "depth-dolly", description: "Camera dollies along z from depth to rest across the boundary.", needsLeaves: false },
  { type: "focus-pull", description: "Focus distance racks from focusFrom to focusTo across the boundary.", needsLeaves: false },
  { type: "cascade-handoff", description: "Staggered depth+opacity entrances across the entering leaves.", needsLeaves: true },
];
export function describeTransition(type: TransitionType): { type: TransitionType; description: string; needsLeaves: boolean } {
  const entry = TRANSITION_CATALOG.find((item) => item.type === type);
  if (!entry) throw new Error(`Unknown transition type: ${type}.`);
  return entry;
}
function track(track: unknown): MotionTrack {
  const parsed = MotionTrackSchema.safeParse(track);
  if (!parsed.success) throw new Error(`Transition builder produced an invalid track: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}
export type TransitionWarning = { code: string; path: string; message: string };
// Compile an entering-side transition over durationMs. surfaceIds may be empty
// for camera/focus transitions. Output always validates as motion tracks.
export function buildTransition(
  type: TransitionType,
  input: { surfaceIds: string[]; durationMs: number; distance?: number; depth?: number; focusFrom?: number; focusTo?: number },
): { tracks: MotionTrack[]; warnings: TransitionWarning[] } {
  const { surfaceIds, durationMs } = input;
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Transition duration must be positive.");
  if (new Set(surfaceIds).size !== surfaceIds.length) throw new Error("Transition Surface IDs must be unique.");
  const warnings: TransitionWarning[] = [];
  const distance = input.distance ?? 480;
  const depth = input.depth ?? 400;
  const tracks: MotionTrack[] = [];
  const fade = (id: string) => track({ target: { kind: "surface", id }, property: "opacity", keyframes: [
    { timeMs: 0, value: 0 }, { timeMs: durationMs, value: 1 },
  ] });
  switch (type) {
    case "cut":
      return { tracks, warnings };
    case "dissolve":
      for (const id of surfaceIds) tracks.push(fade(id));
      return { tracks, warnings };
    case "slide-push":
      for (const id of surfaceIds)
        tracks.push(track({ target: { kind: "surface", id }, property: "x", keyframes: [
          { timeMs: 0, value: distance }, { timeMs: durationMs, value: 0 },
        ] }));
      return { tracks, warnings };
    case "wipe-mask":
      // The right inset closes from 100% to 0%, revealing each leaf left to right.
      for (const id of surfaceIds)
        tracks.push(track({ target: { kind: "surface", id }, property: "clipRight", keyframes: [
          { timeMs: 0, value: 100 }, { timeMs: durationMs, value: 0 },
        ] }));
      return { tracks, warnings };
    case "iris-mask":
      // A circle of 75% of the leaf's normalized diagonal clears its corners.
      for (const id of surfaceIds)
        tracks.push(track({ target: { kind: "surface", id }, property: "clipRadius", keyframes: [
          { timeMs: 0, value: 0 }, { timeMs: durationMs, value: 75 },
        ] }));
      return { tracks, warnings };
    case "depth-dolly":
      tracks.push(track({ target: { kind: "camera" }, property: "z", keyframes: [
        { timeMs: 0, value: depth }, { timeMs: durationMs, value: 0 },
      ] }));
      return { tracks, warnings };
    case "focus-pull": {
      const from = input.focusFrom ?? 2000, to = input.focusTo ?? 1400;
      tracks.push(track({ target: { kind: "focus" }, property: "distance", keyframes: [
        { timeMs: 0, value: from }, { timeMs: durationMs, value: to },
      ] }));
      return { tracks, warnings };
    }
    case "cascade-handoff": {
      const staggerMs = surfaceIds.length > 1 ? Math.min(180, durationMs / surfaceIds.length / 2) : 0;
      const entranceMs = Math.max(1, Math.min(1800, durationMs - staggerMs * (surfaceIds.length - 1)));
      tracks.push(...createCascadeTracks({ items: surfaceIds.map((id) => ({ id })), staggerMs, entranceMs }));
      surfaceIds.forEach((id, index) => {
        const at = index * staggerMs;
        tracks.push(track({ target: { kind: "surface", id }, property: "opacity", keyframes: [
          { timeMs: 0, value: 0 }, ...(at > 0 ? [{ timeMs: at, value: 0 }] : []),
          { timeMs: Math.min(durationMs, at + entranceMs), value: 1 },
        ] }));
      });
      return { tracks, warnings };
    }
  }
}
