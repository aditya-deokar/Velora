import { z } from "zod";
import { MotionTrackSchema, type MotionTrack } from "./motion";
import { createCascadeTracks } from "./choreography";

/** SOURCE OF TRUTH: TextStyleSchema, kinetic preset builders.
 * WHAT: text styling contracts plus pure builders that compile kinetic presets to motion tracks.
 * WHY: agents animate titles without hand-rolling keyframes or splitting the whole DOM.
 * WHERE: scene authors paste builder output into recipe motion; KineticText renders matching markup.
 * Every animated text region must live in a Surface leaf or content (the
 * focus/coverage invariant); builders never invent surfaces. Velora never
 * restyles host UI silently: styles apply only to explicitly authored text.
 */
export const MAX_KINETIC_SURFACES = 12;
export const KineticPresetSchema = z.enum(["fade-slide", "word-cascade", "mask-reveal", "typewriter-timed"]);
export type KineticPreset = z.output<typeof KineticPresetSchema>;
export const TextStyleSchema = z.strictObject({
  family: z.string().min(1).max(128),
  size: z.number().finite().positive().max(1000),
  weight: z.union([z.number().int().min(100).max(900), z.enum(["normal", "bold", "lighter", "bolder"])]).default("normal"),
  tracking: z.number().finite().min(-50).max(200).default(0),
  leading: z.number().finite().positive().max(5).default(1.2),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb color.").default("#ffffff"),
  align: z.enum(["left", "center", "right"]).default("center"),
  kinetic: KineticPresetSchema.optional(),
});
export type TextStyle = z.output<typeof TextStyleSchema>;
export type KineticWarning = { code: string; path: string; message: string };
function track(track: unknown): MotionTrack {
  const parsed = MotionTrackSchema.safeParse(track);
  if (!parsed.success) throw new Error(`Kinetic builder produced an invalid track: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}
// Compile a preset for explicit Surface IDs over durationMs. Returns valid
// motion tracks plus budget warnings; callers paste tracks into recipe motion.
export function buildKineticTracks(
  preset: KineticPreset,
  input: { surfaceIds: string[]; durationMs: number; distance?: number },
): { tracks: MotionTrack[]; warnings: KineticWarning[] } {
  const { surfaceIds, durationMs } = input;
  const distance = input.distance ?? 120;
  if (!surfaceIds.length) throw new Error("Kinetic presets need at least one Surface ID.");
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Kinetic duration must be positive.");
  const warnings: KineticWarning[] = [];
  if (surfaceIds.length > MAX_KINETIC_SURFACES)
    warnings.push({ code: "kinetic-budget", path: "surfaceIds", message: `${surfaceIds.length} animated text surfaces exceed the ${MAX_KINETIC_SURFACES} budget and may exhaust the live-DOM filter budget. Split across scenes or bake to an asset.` });
  if (new Set(surfaceIds).size !== surfaceIds.length) throw new Error("Kinetic Surface IDs must be unique.");
  const tracks: MotionTrack[] = [];
  if (preset === "word-cascade") {
    // Fit the staircase inside durationMs deterministically: stagger from the
    // per-word slot, entrance from the remaining span. Last word ends exactly
    // at durationMs, so output always validates against the scene duration.
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
  if (preset === "typewriter-timed") {
    if (surfaceIds.length === 1)
      warnings.push({ code: "kinetic-single", path: "surfaceIds", message: "One surface cannot step: split words into one Surface per word for typewriter timing." });
    surfaceIds.forEach((id, index) => {
      const at = Math.min(durationMs, (index / surfaceIds.length) * durationMs);
      tracks.push(track({ target: { kind: "surface", id }, property: "opacity", keyframes: [
        { timeMs: 0, value: 0, easing: "linear" as const }, ...(at > 0 ? [{ timeMs: at, value: 0, easing: "linear" as const }] : []),
        { timeMs: Math.min(durationMs, at + 1), value: 1, easing: "linear" as const },
      ] }));
    });
    return { tracks, warnings };
  }
  // fade-slide: gentle rise + fade. mask-reveal: horizontal wipe approximated
  // with travel + fade (true clipping masks belong to host CSS, not tracks).
  const axis = preset === "mask-reveal" ? "x" : "y";
  for (const id of surfaceIds) {
    tracks.push(track({ target: { kind: "surface", id }, property: "opacity", keyframes: [
      { timeMs: 0, value: 0 }, { timeMs: durationMs, value: 1 },
    ] }));
    tracks.push(track({ target: { kind: "surface", id }, property: axis, keyframes: [
      { timeMs: 0, value: distance }, { timeMs: durationMs, value: 0 },
    ] }));
  }
  return { tracks, warnings };
}
