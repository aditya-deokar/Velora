import { z } from "zod";
import { MotionTrackSchema, type MotionTrack } from "./motion";
import { createCascadeTracks } from "./choreography";
import { applyEasing, EasingSchema, type EasingInput } from "./easing";

/** SOURCE OF TRUTH: TextStyleSchema, kinetic preset builders, textAnimatorAt.
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
  if (preset === "mask-reveal") {
    // True mask: each line reveals left to right as its right inset closes.
    for (const id of surfaceIds)
      tracks.push(track({ target: { kind: "surface", id }, property: "clipRight", keyframes: [
        { timeMs: 0, value: 100 }, { timeMs: durationMs, value: 0 },
      ] }));
    return { tracks, warnings };
  }
  // fade-slide: gentle rise + fade.
  const axis = "y";
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

/** After Effects-style text animator range selector (07.7). start/end/offset are percentages of the
 * units (0–100); `shape` weights each unit by its position in the selected range; `ease` remaps weights. */
export const SELECTOR_SHAPES = Object.freeze(["square", "ramp-up", "ramp-down", "triangle", "round", "smooth"] as const);
export type SelectorShape = (typeof SELECTOR_SHAPES)[number];
export type RangeSelector = { start: number; end: number; offset?: number; shape?: SelectorShape; ease?: EasingInput; wrap?: boolean };
/** Amounts at full selection: opacity/scale are values the unit reaches; x, y, z, rotate, blur and
 * tracking (em) are offsets; color is mixed in by the weight. */
export type TextAnimatorAmounts = { opacity?: number; x?: number; y?: number; z?: number; rotate?: number; scale?: number; blur?: number; tracking?: number; color?: string };
export type TextUnitState = { weight: number; opacity: number; x: number; y: number; z: number; rotate: number; scale: number; blur: number; tracking: number; color?: string; colorMix: number };
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Weight of one unit [a, b] (percent) for a selector range [s, e] and shape. */
function shapeWeight(shape: SelectorShape, a: number, b: number, s: number, e: number): number {
  if (e <= s) return 0;
  if (shape === "square") return b > a ? clamp01((Math.min(b, e) - Math.max(a, s)) / (b - a)) : 0;
  const c = (a + b) / 2;
  if (c < s || c > e) return shape === "ramp-up" && c > e ? 1 : shape === "ramp-down" && c < s ? 1 : 0;
  const t = (c - s) / (e - s);
  switch (shape) {
    case "ramp-up": return t;
    case "ramp-down": return 1 - t;
    case "triangle": return 1 - Math.abs(2 * t - 1);
    case "round": return Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
    case "smooth": return (1 - Math.cos(2 * Math.PI * t)) / 2;
  }
  return 0;
}
/** Per-unit animator state for `count` units (chars, words or lines). Pure: kit TextAnimator renders it. */
export function textAnimatorAt(count: number, selector: RangeSelector, amounts: TextAnimatorAmounts): TextUnitState[] {
  const n = Math.max(0, Math.floor(count));
  const shape = selector.shape ?? "square";
  const offset = selector.wrap ? (selector.offset ?? 0) % 100 : selector.offset ?? 0;
  const s = Math.min(selector.start, selector.end) + offset, e = Math.max(selector.start, selector.end) + offset;
  const ease = selector.ease === undefined ? undefined : EasingSchema.parse(selector.ease);
  return Array.from({ length: n }, (_, index) => {
    const a = (index / n) * 100, b = ((index + 1) / n) * 100;
    let raw = shapeWeight(shape, a, b, s, e);
    // Wrap: a range pushed past either end continues from the other end.
    if (selector.wrap) raw = Math.max(raw, shapeWeight(shape, a + 100, b + 100, s, e), shapeWeight(shape, a - 100, b - 100, s, e));
    const weight = ease !== undefined && raw > 0 && raw < 1 ? clamp01(applyEasing(ease, raw)) : raw;
    const blend = (to: number | undefined, rest: number) => (to === undefined ? rest : rest + (to - rest) * weight);
    return {
      weight,
      opacity: blend(amounts.opacity, 1), scale: blend(amounts.scale, 1),
      x: blend(amounts.x, 0), y: blend(amounts.y, 0), z: blend(amounts.z, 0), rotate: blend(amounts.rotate, 0), blur: blend(amounts.blur, 0), tracking: blend(amounts.tracking, 0),
      ...(amounts.color ? { color: amounts.color } : {}), colorMix: amounts.color ? weight : 0,
    };
  });
}
