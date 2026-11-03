import { z } from "zod";
import { MotionTrackSchema, type MotionTrack } from "./motion";
import { createCascadeTracks } from "./choreography";
import { EasingSchema } from "./easing";
import { SFX_PRESET_NAMES } from "./sound";

/** SOURCE OF TRUTH: TransitionTypeSchema, transition builders, OVERLAP_TRANSITIONS, transitionMode.
 * WHAT: the transition catalog plus pure builders compiling transitions to motion tracks.
 * WHY: agents apply consistent entrances without hand-rolling keyframes.
 * WHERE: compositions declare segment entrances; builders emit tracks to paste
 * into scene recipe motion; validate checks declarations.
 * Entering-side model (butt-join timeline, totals unchanged): every transition
 * describes what the incoming scene does over the first durationMs of its
 * segment. True A/B crossfade compositing is out of scope: dissolve means the
 * entering leaves fade in. Wipe and iris are true masks: clip tracks on the
 * entering visual leaves (inset and circle clip-paths). No new render path.
 * Overlap model (true A/B): the incoming segment starts durationMs before the outgoing one ends; both
 * render at their own local times and export/compositor blends the two finished frames.
 */
export const ENTERING_TRANSITIONS = ["cut", "dissolve", "slide-push", "wipe-mask", "iris-mask", "depth-dolly", "focus-pull", "cascade-handoff"] as const;
export const OVERLAP_TRANSITIONS = ["crossfade", "dip-to-black", "dip-to-white", "wipe", "iris", "push", "zoom", "whip", "light-leak"] as const;
export const TransitionTypeSchema = z.enum([...ENTERING_TRANSITIONS, ...OVERLAP_TRANSITIONS]);
export type TransitionType = z.output<typeof TransitionTypeSchema>;
export type OverlapTransitionType = (typeof OVERLAP_TRANSITIONS)[number];
export const isOverlapTransition = (type: string): type is OverlapTransitionType => (OVERLAP_TRANSITIONS as readonly string[]).includes(type);
export const SegmentTransitionSchema = z.strictObject({
  type: TransitionTypeSchema,
  durationMs: z.number().finite().positive().max(30_000),
  // Overlap types blend A and B (the segment starts durationMs before the previous one ends); entering
  // types animate inside the incoming scene. Omitted, the mode follows the type.
  mode: z.enum(["entering", "overlap"]).optional(),
  ease: EasingSchema.optional(),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
  // Seeded light leaks and whips replay identically.
  seed: z.number().int().nonnegative().max(4_294_967_295).optional(),
  // Sound design on the cut: a procedural preset placed at the transition's midpoint.
  sfx: z.union([z.enum(SFX_PRESET_NAMES), z.strictObject({ preset: z.enum(SFX_PRESET_NAMES), gainDb: z.number().finite().min(-40).max(6).default(-6) })]).optional(),
}).superRefine((transition, ctx) => {
  const overlap = isOverlapTransition(transition.type);
  if (transition.mode !== undefined && (transition.mode === "overlap") !== overlap)
    ctx.addIssue({ code: "custom", path: ["mode"], message: overlap
      ? `${transition.type} blends two segments: use mode "overlap" (or omit mode).`
      : `${transition.type} is an entering transition: use mode "entering" (or omit mode). Overlap types: ${OVERLAP_TRANSITIONS.join(", ")}.` });
});
export function transitionMode(transition: { type: string }): "entering" | "overlap" {
  return isOverlapTransition(transition.type) ? "overlap" : "entering";
}
export type SegmentTransition = z.output<typeof SegmentTransitionSchema>;
export const TRANSITION_CATALOG: { type: TransitionType; description: string; needsLeaves: boolean; mode: "entering" | "overlap" }[] = ([
  { type: "cut", description: "Hard cut. No tracks, no overlap.", needsLeaves: false },
  { type: "dissolve", description: "Entering leaves fade from transparent over durationMs.", needsLeaves: true },
  { type: "slide-push", description: "Entering leaves travel along x from distance to rest.", needsLeaves: true },
  { type: "wipe-mask", description: "True left-to-right wipe: entering leaves reveal through an inset clip mask.", needsLeaves: true },
  { type: "iris-mask", description: "True iris: entering leaves open from the center through a circular clip mask.", needsLeaves: true },
  { type: "depth-dolly", description: "Camera dollies along z from depth to rest across the boundary.", needsLeaves: false },
  { type: "focus-pull", description: "Focus distance racks from focusFrom to focusTo across the boundary.", needsLeaves: false },
  { type: "cascade-handoff", description: "Staggered depth+opacity entrances across the entering leaves.", needsLeaves: true },
  { type: "crossfade", description: "Overlap: A and B mix in linear light.", needsLeaves: false },
  { type: "dip-to-black", description: "Overlap: A fades to black over the first half, black fades to B over the second.", needsLeaves: false },
  { type: "dip-to-white", description: "Overlap: A fades to white, then white to B.", needsLeaves: false },
  { type: "wipe", description: "Overlap: a feathered edge travels across (direction left|right|up|down) revealing B.", needsLeaves: false },
  { type: "iris", description: "Overlap: B opens from the center through a feathered circle.", needsLeaves: false },
  { type: "push", description: "Overlap: B pushes A out of frame along the direction.", needsLeaves: false },
  { type: "zoom", description: "Overlap: A scales up and dissolves into B.", needsLeaves: false },
  { type: "whip", description: "Overlap: both frames smear along the direction (blur ramp + shift) and swap at the peak; pairs with motion blur.", needsLeaves: false },
  { type: "light-leak", description: "Overlap: a seeded warm additive glow over a crossfade.", needsLeaves: false },
] as Omit<(typeof TRANSITION_CATALOG)[number], "mode">[]).map(entry => ({ ...entry, mode: transitionMode(entry) }));
export function describeTransition(type: TransitionType): { type: TransitionType; description: string; needsLeaves: boolean; mode: "entering" | "overlap" } {
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
  // Overlap transitions need no tracks: the renderer blends the two finished frames.
  if (isOverlapTransition(type)) return { tracks: [], warnings: [{ code: "INFO_TRANSITION_OVERLAP", path: "transition", message: `${type} is blended at render time: start the incoming segment ${durationMs}ms before the outgoing one ends.` }] };
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
