import { z } from "zod";
import {
  TransformSchema,
  CameraSchema,
  FocusSchema,
  type SceneIssue,
} from "./scene";
import { EasingSchema, applyEasing, type Easing } from "./easing";
import { NoiseSchema, sampleNoise } from "./noise";
import { parseCssColor, mixColors, formatCssColor, colorDifference, type CssColor } from "./color";

/** SOURCE OF TRUTH: MotionSchema, evaluateMotion, motionDuration, motionTime, cinematicProgress, cinematicTimeAtProgress, sampleFrameTime, loopSeam, monotoneTangents, explicit scene time.
 * WHAT: typed motion tracks (surface, camera, focus, channel, style), target/property validation and
 * deterministic interpolation: eased or auto-bezier segments, C1-smooth paths, OKLab color segments,
 * plus seeded noise texture. One compiled evaluator caches the parse per immutable motion object.
 * WHY: all callers must evaluate the same frame without clocks or mutable playback state, fast enough
 * for interactive drafts with hundreds of tracks.
 * WHERE: core/motion.ts owns motion; core/easing owns curves; core/color owns color math; core/scene.ts
 * validates merged scene values; React/runtime adapters resolve registered surfaces, visual leaves,
 * style variables and channel consumers.
 */
const finite = z.number().finite();
// Domain bounds derive from the scene owner. Motion adds only animation policy.
// Visual properties apply to a Surface's content leaf (never a spatial group), so they
// cannot flatten 3D: opacity, an artistic blur composed with depth of field, true masks and a grade.
const SurfaceMotionSchema = TransformSchema.extend({
  opacity: finite.min(0).max(1),
  blur: finite.min(0).max(64),
  clipTop: finite.min(0).max(100),
  clipRight: finite.min(0).max(100),
  clipBottom: finite.min(0).max(100),
  clipLeft: finite.min(0).max(100),
  clipRadius: finite.min(0).max(150),
  brightness: finite.min(0).max(4),
  contrast: finite.min(0).max(4),
  saturate: finite.min(0).max(4),
  hueRotate: finite.min(-360).max(360),
  grayscale: finite.min(0).max(1),
});
export const SURFACE_VISUAL_PROPERTIES = Object.freeze(["opacity", "blur", "clipTop", "clipRight", "clipBottom", "clipLeft", "clipRadius",
  "brightness", "contrast", "saturate", "hueRotate", "grayscale"] as const);
export type SurfaceVisualProperty = (typeof SURFACE_VISUAL_PROPERTIES)[number];
// Perspective is animatable so a lens change (dolly zoom) shares the one motion clock.
const CameraMotionSchema = CameraSchema.pick({
  x: true,
  y: true,
  z: true,
  perspective: true,
  rotateX: true,
  rotateY: true,
  rotateZ: true,
});
const FocusMotionSchema = FocusSchema;
// Channels are named numbers that components read with useChannel (cursor paths, counters,
// typewriters, scroll offsets), so component state follows the same eased timeline.
const ChannelMotionSchema = z.strictObject({ value: finite });
// "auto" (per-keyframe auto-bezier) is a keyframe interpolation, not a curve: EasingSchema stays unchanged.
export const KeyframeEasingSchema = z.union([EasingSchema, z.literal("auto")]);
export type KeyframeEasing = z.output<typeof KeyframeEasingSchema>;
export const MotionKeyframeSchema = z.strictObject({
  timeMs: finite.nonnegative(),
  value: finite,
  // Easing applies to the outgoing segment; cinematic has zero endpoint velocity and acceleration.
  // "auto" evaluates the segment as a monotone cubic Hermite through its neighbors (continuous velocity).
  easing: KeyframeEasingSchema.default("cinematic"),
});
export const CSS_VARIABLE_PATTERN = /^--[a-zA-Z][a-zA-Z0-9-]{0,63}$/;
export const STYLE_UNITS = Object.freeze(["px", "%", "deg", "em", "rem", "vw", "vh", ""] as const);
const CssColorValueSchema = z.string().max(128).superRefine((value, ctx) => {
  const parsed = parseCssColor(value);
  if (!parsed.ok) ctx.addIssue({ code: "custom", message: parsed.message });
});
export const ColorKeyframeSchema = z.strictObject({
  timeMs: finite.nonnegative(),
  value: CssColorValueSchema,
  easing: KeyframeEasingSchema.default("cinematic"),
});
const keyframes = z.array(MotionKeyframeSchema).min(1);
const colorKeyframes = z.array(ColorKeyframeSchema).min(1);
// Optional per-track behavior. Omitted fields keep the original per-segment evaluation exactly.
const trackOptions = {
  // smooth: one C1 curve through every keyframe (no stop at waypoints); per-keyframe easing is ignored.
  interpolation: z.enum(["segments", "smooth"]).optional(),
  // smooth only: remaps time across the whole track so a rail accelerates and settles once.
  ease: EasingSchema.optional(),
  // Seeded handheld/float texture added to the value (position, rotation and channel tracks).
  noise: NoiseSchema.optional(),
};
const styleTarget = z.strictObject({ kind: z.literal("style"), id: z.string().min(1) });
const styleProperty = z.string().regex(CSS_VARIABLE_PATTERN, "Use a CSS custom property name such as --accent (letters, digits and hyphens).");
const channelTarget = z.strictObject({ kind: z.literal("channel"), id: z.string().min(1).max(128) });
const noiseTargets: Record<string, readonly string[]> = {
  surface: ["x", "y", "z", "rotateX", "rotateY", "rotateZ"],
  camera: ["x", "y", "z", "rotateX", "rotateY", "rotateZ"],
  channel: ["value"],
};
// Hoisted once: per-keyframe value validation must not construct schemas on every parse.
const propertyValues: Record<string, z.ZodType | undefined> = {
  surface: SurfaceMotionSchema.partial(),
  camera: CameraMotionSchema.partial(),
  focus: FocusMotionSchema.partial(),
  channel: ChannelMotionSchema.partial(),
};
export const MotionTrackSchema = z
  .union([
    z.strictObject({
      target: z.strictObject({
        kind: z.literal("surface"),
        id: z.string().min(1),
      }),
      property: SurfaceMotionSchema.keyof(),
      keyframes,
      ...trackOptions,
    }),
    z.strictObject({
      target: z.strictObject({ kind: z.literal("camera") }),
      property: CameraMotionSchema.keyof(),
      keyframes,
      ...trackOptions,
    }),
    z.strictObject({
      target: z.strictObject({ kind: z.literal("focus") }),
      property: FocusMotionSchema.keyof(),
      keyframes,
      ...trackOptions,
    }),
    z.strictObject({
      target: channelTarget,
      property: z.literal("value"),
      keyframes,
      ...trackOptions,
    }),
    // Color channels (animatable color props): segments in OKLab, no unit, noise or smooth path.
    z.strictObject({
      target: channelTarget,
      property: z.literal("value"),
      keyframes: colorKeyframes,
      ...trackOptions,
    }),
    // Style tracks write CSS custom properties on a Surface's outer element; descendants read var(--name).
    z.strictObject({
      target: styleTarget,
      property: styleProperty,
      keyframes,
      unit: z.enum(STYLE_UNITS).optional(),
      ...trackOptions,
    }),
    z.strictObject({
      target: styleTarget,
      property: styleProperty,
      keyframes: colorKeyframes,
      ...trackOptions,
    }),
  ])
  .superRefine((track, ctx) => {
    const color = track.keyframes.some(frame => typeof frame.value === "string");
    const values = propertyValues[track.target.kind];
    for (const [index, frame] of track.keyframes.entries()) {
      if (!color && values) {
        const value = values.safeParse({ [track.property]: frame.value });
        if (!value.success) {
          for (const issue of value.error.issues)
            ctx.addIssue({
              code: "custom",
              path: ["keyframes", index, "value"],
              message: issue.message,
            });
        }
      }
      if (color && frame.easing === "auto")
        ctx.addIssue({ code: "custom", path: ["keyframes", index, "easing"], message: "Auto easing applies to numeric keyframes; color segments take a curve such as cinematic." });
      if (index > 0 && frame.timeMs <= track.keyframes[index - 1].timeMs)
        ctx.addIssue({
          code: "custom",
          path: ["keyframes", index, "timeMs"],
          message: "Keyframe times must be strictly increasing and distinct.",
        });
    }
    if (color && track.interpolation === "smooth")
      ctx.addIssue({ code: "custom", path: ["interpolation"], message: "Color tracks evaluate as segments; smooth interpolation applies to numeric tracks." });
    if (track.ease !== undefined && track.interpolation !== "smooth")
      ctx.addIssue({ code: "custom", path: ["ease"], message: "Track ease applies only to interpolation \"smooth\"; use keyframe easing for segments." });
    if (track.noise && (color || !noiseTargets[track.target.kind]?.includes(track.property)))
      ctx.addIssue({ code: "custom", path: ["noise"], message: color ? "Noise texture applies to numeric tracks, not colors." : `Noise texture applies to position, rotation and channel tracks, not ${track.target.kind} ${track.property}.` });
  });
export const MotionSchema = z
  .strictObject({
    durationMs: finite.nonnegative(),
    speed: finite.min(0.05).max(4).default(0.5),
    // Preview playback wraps for seamless loops; exports still render exactly one duration.
    loop: z.boolean().optional(),
    tracks: z.array(MotionTrackSchema),
  })
  .superRefine((motion, ctx) => {
    if (!Number.isFinite(motion.durationMs / motion.speed))
      ctx.addIssue({code:"custom",path:["durationMs"],message:"Presentation duration must remain finite at the chosen speed."});
    const seen = new Set<string>();
    for (const [index, track] of motion.tracks.entries()) {
      const key = JSON.stringify([
        track.target.kind,
        track.target.kind === "surface" || track.target.kind === "channel" || track.target.kind === "style" ? track.target.id : null,
        track.property,
      ]);
      if (seen.has(key))
        ctx.addIssue({
          code: "custom",
          path: ["tracks", index],
          message: "Duplicate target/property track.",
        });
      seen.add(key);
      for (const [frameIndex, frame] of track.keyframes.entries()) {
        if (frame.timeMs > motion.durationMs)
          ctx.addIssue({
            code: "custom",
            path: ["tracks", index, "keyframes", frameIndex, "timeMs"],
            message: "Keyframe time exceeds scene duration.",
          });
      }
    }
  });
export type MotionInput = z.input<typeof MotionSchema>;
export type MotionDefinition = z.output<typeof MotionSchema>;
export type MotionTrack = z.output<typeof MotionTrackSchema>;
type NumericFrame = z.output<typeof MotionKeyframeSchema>;
type ColorFrame = z.output<typeof ColorKeyframeSchema>;
export type MotionState = {
  surfaces: Record<string, Partial<z.output<typeof SurfaceMotionSchema>>>;
  camera: Partial<z.output<typeof CameraMotionSchema>>;
  focus: Partial<z.output<typeof FocusMotionSchema>>;
  channels: Record<string, number>;
  /** CSS custom properties per surface id, present only when the motion has style tracks. */
  styles?: Record<string, Record<string, string>>;
  /** Color channel values (canonical rgb()), present only when the motion has color channel tracks. */
  colorChannels?: Record<string, string>;
  issues: SceneIssue[];
};

function blend(start: number, end: number, weight: number): number {
  // Same-sign deltas preserve positive subnormals; convex weights avoid overflow
  // when opposite finite extremes make (end - start) infinite.
  if ((start >= 0 && end >= 0) || (start <= 0 && end <= 0)) return start + (end - start) * weight;
  return (1 - weight) * start + weight * end;
}
/** Monotone cubic Hermite tangents (Fritsch-Carlson) for a whole track: continuous velocity through
 * every waypoint and no overshoot between keyframes. Smooth tracks and "auto" segments share it. */
export function monotoneTangents(frames: readonly { timeMs: number; value: number }[]): number[] {
  const last = frames.length - 1;
  if (last < 1) return frames.map(() => 0);
  const slopes = frames.slice(0, last).map((frame, i) => (frames[i + 1].value - frame.value) / (frames[i + 1].timeMs - frame.timeMs));
  const tangents = frames.map((_, i) => i === 0 ? slopes[0] : i === last ? slopes[last - 1]
    : slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
  for (let i = 0; i < last; i++) {
    if (slopes[i] === 0) { tangents[i] = 0; tangents[i + 1] = 0; continue; }
    const a = tangents[i] / slopes[i], b = tangents[i + 1] / slopes[i], length = a * a + b * b;
    if (length > 9) {
      const scale = 3 / Math.sqrt(length);
      tangents[i] = scale * a * slopes[i];
      tangents[i + 1] = scale * b * slopes[i];
    }
  }
  return tangents;
}
function hermite(start: NumericFrame, end: NumericFrame, m0: number, m1: number, time: number): number {
  const h = end.timeMs - start.timeMs, s = (time - start.timeMs) / h;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * start.value + (s3 - 2 * s2 + s) * h * m0
    + (-2 * s3 + 3 * s2) * end.value + (s3 - s2) * h * m1;
}
function interpolate(frames: readonly NumericFrame[], timeMs: number, tangents: readonly number[] | undefined): number {
  if (timeMs <= frames[0].timeMs) return frames[0].value;
  for (let index = 1; index < frames.length; index++) {
    const end = frames[index];
    if (timeMs > end.timeMs) continue;
    if (timeMs === end.timeMs) return end.value;
    const start = frames[index - 1];
    if (start.easing === "auto") return hermite(start, end, tangents![index - 1], tangents![index], timeMs);
    return blend(start.value, end.value, applyEasing(start.easing, (timeMs - start.timeMs) / (end.timeMs - start.timeMs)));
  }
  return frames[frames.length - 1].value;
}
function smoothInterpolate(frames: readonly NumericFrame[], timeMs: number, ease: Easing | undefined, tangents: readonly number[]): number {
  const last = frames.length - 1;
  if (last === 0 || timeMs <= frames[0].timeMs) return frames[0].value;
  if (timeMs >= frames[last].timeMs) return frames[last].value;
  const first = frames[0].timeMs, span = frames[last].timeMs - first;
  const time = ease === undefined ? timeMs : first + applyEasing(ease, (timeMs - first) / span) * span;
  let segment = 0;
  while (segment < last - 1 && time > frames[segment + 1].timeMs) segment++;
  return hermite(frames[segment], frames[segment + 1], tangents[segment], tangents[segment + 1], time);
}
// Locale-independent numeric CSS values: four decimals at most, never -0.
function cssNumber(value: number): string {
  const rounded = Number(value.toFixed(4));
  return String(rounded === 0 ? 0 : rounded);
}

/** SOURCE OF TRUTH: the compiled evaluator (one path; the cache only skips repeated parsing).
 * Motion inputs are treated as immutable: callers that change a motion pass a new object. A cheap
 * structural fingerprint (duration, track and keyframe counts) recompiles a mutated cached object. */
type CompiledTrack = { track: MotionTrack; color: boolean; value: (time: number) => number | string };
type Compiled = { parsed?: MotionDefinition; issues: SceneIssue[]; tracks: CompiledTrack[]; fingerprint: string };
const compiledMotion = new WeakMap<object, Compiled>();
/** Duration plus track and keyframe counts of a raw motion input (for mutation diagnostics). */
export function motionFingerprint(input: unknown): string {
  if (typeof input !== "object" || input === null) return String(input);
  const raw = input as { durationMs?: unknown; speed?: unknown; tracks?: unknown };
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  let frames = 0;
  for (const track of tracks) {
    const list = (track as { keyframes?: unknown } | null)?.keyframes;
    frames += Array.isArray(list) ? list.length : 0;
  }
  return `${String(raw.durationMs)}|${String(raw.speed)}|${tracks.length}|${frames}`;
}
function compileTrack(track: MotionTrack): CompiledTrack {
  if (track.keyframes.some(frame => typeof frame.value === "string")) {
    const frames = track.keyframes as ColorFrame[];
    const colors = frames.map(frame => (parseCssColor(frame.value) as { ok: true; color: CssColor }).color);
    const printed = colors.map(formatCssColor);
    return { track, color: true, value: time => {
      if (time <= frames[0].timeMs) return printed[0];
      for (let index = 1; index < frames.length; index++) {
        const end = frames[index];
        if (time > end.timeMs) continue;
        if (time === end.timeMs) return printed[index];
        const start = frames[index - 1];
        return mixColors(colors[index - 1], colors[index], applyEasing(start.easing as Easing, (time - start.timeMs) / (end.timeMs - start.timeMs)));
      }
      return printed[frames.length - 1];
    } };
  }
  const frames = track.keyframes as NumericFrame[];
  const smooth = track.interpolation === "smooth";
  const tangents = smooth || frames.some(frame => frame.easing === "auto") ? monotoneTangents(frames) : undefined;
  const base = smooth ? (time: number) => smoothInterpolate(frames, time, track.ease, tangents!) : (time: number) => interpolate(frames, time, tangents);
  const noise = track.noise;
  return { track, color: false, value: noise ? time => base(time) + noise.amplitude * sampleNoise(noise, time) : base };
}
function compile(input: unknown, fingerprint: string): Compiled {
  const parsed = MotionSchema.safeParse(input);
  if (!parsed.success)
    return { issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })), tracks: [], fingerprint };
  return { parsed: parsed.data, issues: [], tracks: parsed.data.tracks.map(compileTrack), fingerprint };
}
function compiled(input: unknown): Compiled {
  const fingerprint = motionFingerprint(input);
  if (typeof input !== "object" || input === null) return compile(input, fingerprint);
  const hit = compiledMotion.get(input);
  if (hit && hit.fingerprint === fingerprint) return hit;
  const next = compile(input, fingerprint);
  compiledMotion.set(input, next);
  return next;
}
// Own data properties support arbitrary IDs without reading/writing Object.prototype.
function own<T>(record: Record<string, T>, key: string, value: T) {
  Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true });
}

/** Invalid input yields diagnostics and no overrides; finite time clamps to the scene.
 * Tracks hold their endpoints outside their own keyframe interval. Rotations interpolate
 * numerically in degrees (so authored multi-turn rotations retain their intent).
 */
export function evaluateMotion(input: unknown, timeMs: number): MotionState {
  const result: MotionState = {
    surfaces: {},
    camera: {},
    focus: {},
    channels: {},
    issues: [],
  };
  const motion = compiled(input);
  result.issues.push(...motion.issues.map(issue => ({ ...issue })));
  if (!Number.isFinite(timeMs))
    result.issues.push({
      path: "timeMs",
      message: "Scene time must be a finite number.",
    });
  if (!motion.parsed || result.issues.length) return result;
  const time = Math.min(motion.parsed.durationMs, Math.max(0, timeMs) * motion.parsed.speed);
  for (const { track, color, value: evaluate } of motion.tracks) {
    const value = evaluate(time);
    if (track.target.kind === "surface") {
      const id = track.target.id;
      const prior = Object.hasOwn(result.surfaces, id)
        ? result.surfaces[id]
        : {};
      own(result.surfaces, id, { ...prior, [track.property]: value as number });
    } else if (track.target.kind === "camera") {
      result.camera = { ...result.camera, [track.property]: value };
    } else if (track.target.kind === "focus") {
      result.focus = { ...result.focus, [track.property]: value };
    } else if (track.target.kind === "style") {
      const styles = (result.styles ??= {});
      const id = track.target.id;
      const prior = Object.hasOwn(styles, id) ? styles[id] : {};
      const css = color ? value as string : cssNumber(value as number) + ("unit" in track ? track.unit ?? "" : "");
      own(styles, id, { ...prior, [track.property]: css });
    } else if (color) {
      own((result.colorChannels ??= {}), track.target.id, value as string);
    } else {
      own(result.channels, track.target.id, value as number);
    }
  }
  return result;
}
/** Largest per-track difference between the first and last authored instant: 0 means a seamless loop.
 * Color tracks measure the largest sRGB channel (or alpha) difference in 0..255 units. */
export function loopSeam(input: unknown): number {
  const motion = compiled(input);
  if (!motion.parsed) return Number.NaN;
  const end = motion.parsed.durationMs;
  return motion.tracks.reduce((seam, { color, value }) =>
    Math.max(seam, color ? colorDifference(value(end) as string, value(0) as string) : Math.abs((value(end) as number) - (value(0) as number))), 0);
}

// Shared timeline conversion: callers supply elapsed presentation milliseconds.
// Opt-in host animations use motionTime through useSceneTime, so charts and spatial
// transforms stay synchronized. Exports sample the same elapsed clock as preview.
export function motionDuration(input: unknown): number {
  const parsed = compiled(input).parsed;
  return parsed ? parsed.durationMs / parsed.speed : 0;
}
export function motionTime(input: unknown, elapsedMs: number): number {
  const parsed = compiled(input).parsed;
  return parsed && Number.isFinite(elapsedMs)
    ? Math.min(parsed.durationMs, Math.max(0, elapsedMs) * parsed.speed) : 0;
}
export function cinematicProgress(progress: number): number {
  return applyEasing("cinematic", Math.max(0, Math.min(1, progress)));
}
// Inverse of the same monotonic easing law, for timing entrances along a camera rail.
export function cinematicTimeAtProgress(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let low = 0, high = 1;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (cinematicProgress(middle) < progress) low = middle; else high = middle;
  }
  return (low + high) / 2;
}

/** Quantize presentation time only when a preview cadence is explicitly chosen.
 * Export still samples its own exact frame times; speed and easing do not change.
 * Canonical frame indexing lives in core/timeline (frameAt/timeAtFrame, round-based);
 * this floored sampler stays for display-cadence preview only. Do not use it for renders.
 */
export function sampleFrameTime(elapsedMs:number, fps:number | "native" = "native"):number {
  if(!Number.isFinite(elapsedMs)||elapsedMs<0) throw new Error("Frame time must be finite and nonnegative.");
  if(fps==="native") return elapsedMs;
  if(!Number.isFinite(fps)||fps<=0||fps>240)throw new Error("Frame rate must be between 0 and 240.");
  return Math.floor(elapsedMs*fps/1000)*1000/fps;
}
