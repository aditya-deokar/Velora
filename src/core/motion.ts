import { z } from "zod";
import {
  TransformSchema,
  CameraSchema,
  FocusSchema,
  type SceneIssue,
} from "./scene";
import { EasingSchema, applyEasing, type Easing } from "./easing";
import { NoiseSchema, sampleNoise } from "./noise";

/** SOURCE OF TRUTH: MotionSchema, evaluateMotion, motionDuration, motionTime, cinematicProgress, cinematicTimeAtProgress, sampleFrameTime, loopSeam, explicit scene time.
 * WHAT: typed motion tracks (surface, camera, focus, channel), target/property validation and
 * deterministic interpolation: eased segments or C1-smooth paths, plus seeded noise texture.
 * WHY: all callers must evaluate the same frame without clocks or mutable playback state.
 * WHERE: core/motion.ts owns motion; core/easing owns curves; core/scene.ts validates merged scene
 * values; React/runtime adapters resolve registered surfaces, visual leaves and channel consumers.
 */
const finite = z.number().finite();
// Domain bounds derive from the scene owner. Motion adds only animation policy.
// Visual properties apply to a Surface's content leaf (never a spatial group), so they
// cannot flatten 3D: opacity, an artistic blur composed with depth of field, and true masks.
const SurfaceMotionSchema = TransformSchema.extend({
  opacity: finite.min(0).max(1),
  blur: finite.min(0).max(64),
  clipTop: finite.min(0).max(100),
  clipRight: finite.min(0).max(100),
  clipBottom: finite.min(0).max(100),
  clipLeft: finite.min(0).max(100),
  clipRadius: finite.min(0).max(150),
});
export const SURFACE_VISUAL_PROPERTIES = Object.freeze(["opacity", "blur", "clipTop", "clipRight", "clipBottom", "clipLeft", "clipRadius"] as const);
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
export const MotionKeyframeSchema = z.strictObject({
  timeMs: finite.nonnegative(),
  value: finite,
  // Easing applies to the outgoing segment; cinematic has zero endpoint velocity and acceleration.
  easing: EasingSchema.default("cinematic"),
});
const keyframes = z.array(MotionKeyframeSchema).min(1);
// Optional per-track behavior. Omitted fields keep the original per-segment evaluation exactly.
const trackOptions = {
  // smooth: one C1 curve through every keyframe (no stop at waypoints); per-keyframe easing is ignored.
  interpolation: z.enum(["segments", "smooth"]).optional(),
  // smooth only: remaps time across the whole track so a rail accelerates and settles once.
  ease: EasingSchema.optional(),
  // Seeded handheld/float texture added to the value (position, rotation and channel tracks).
  noise: NoiseSchema.optional(),
};
const noiseTargets: Record<string, readonly string[]> = {
  surface: ["x", "y", "z", "rotateX", "rotateY", "rotateZ"],
  camera: ["x", "y", "z", "rotateX", "rotateY", "rotateZ"],
  channel: ["value"],
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
      target: z.strictObject({ kind: z.literal("channel"), id: z.string().min(1).max(128) }),
      property: z.literal("value"),
      keyframes,
      ...trackOptions,
    }),
  ])
  .superRefine((track, ctx) => {
    const properties =
      track.target.kind === "surface"
        ? SurfaceMotionSchema
        : track.target.kind === "camera"
          ? CameraMotionSchema
          : track.target.kind === "focus"
            ? FocusMotionSchema
            : ChannelMotionSchema;
    for (const [index, frame] of track.keyframes.entries()) {
      const value = properties
        .partial()
        .safeParse({ [track.property]: frame.value });
      if (!value.success) {
        for (const issue of value.error.issues)
          ctx.addIssue({
            code: "custom",
            path: ["keyframes", index, "value"],
            message: issue.message,
          });
      }
      if (index > 0 && frame.timeMs <= track.keyframes[index - 1].timeMs)
        ctx.addIssue({
          code: "custom",
          path: ["keyframes", index, "timeMs"],
          message: "Keyframe times must be strictly increasing and distinct.",
        });
    }
    if (track.ease !== undefined && track.interpolation !== "smooth")
      ctx.addIssue({ code: "custom", path: ["ease"], message: "Track ease applies only to interpolation \"smooth\"; use keyframe easing for segments." });
    if (track.noise && !noiseTargets[track.target.kind]?.includes(track.property))
      ctx.addIssue({ code: "custom", path: ["noise"], message: `Noise texture applies to position, rotation and channel tracks, not ${track.target.kind} ${track.property}.` });
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
        track.target.kind === "surface" || track.target.kind === "channel" ? track.target.id : null,
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
export type MotionState = {
  surfaces: Record<string, Partial<z.output<typeof SurfaceMotionSchema>>>;
  camera: Partial<z.output<typeof CameraMotionSchema>>;
  focus: Partial<z.output<typeof FocusMotionSchema>>;
  channels: Record<string, number>;
  issues: SceneIssue[];
};

function blend(start: number, end: number, weight: number): number {
  // Same-sign deltas preserve positive subnormals; convex weights avoid overflow
  // when opposite finite extremes make (end - start) infinite.
  if ((start >= 0 && end >= 0) || (start <= 0 && end <= 0)) return start + (end - start) * weight;
  return (1 - weight) * start + weight * end;
}
function interpolate(frames: MotionTrack["keyframes"], timeMs: number): number {
  if (timeMs <= frames[0].timeMs) return frames[0].value;
  for (let index = 1; index < frames.length; index++) {
    const end = frames[index];
    if (timeMs > end.timeMs) continue;
    if (timeMs === end.timeMs) return end.value;
    const start = frames[index - 1];
    return blend(start.value, end.value, applyEasing(start.easing, (timeMs - start.timeMs) / (end.timeMs - start.timeMs)));
  }
  return frames[frames.length - 1].value;
}
// Monotone cubic Hermite (Fritsch-Carlson): continuous velocity through every waypoint and
// no overshoot between keyframes, so a multi-point camera rail never stops at a waypoint.
function smoothInterpolate(frames: MotionTrack["keyframes"], timeMs: number, ease: Easing | undefined): number {
  const last = frames.length - 1;
  if (last === 0 || timeMs <= frames[0].timeMs) return frames[0].value;
  if (timeMs >= frames[last].timeMs) return frames[last].value;
  const first = frames[0].timeMs, span = frames[last].timeMs - first;
  const time = ease === undefined ? timeMs : first + applyEasing(ease, (timeMs - first) / span) * span;
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
  let segment = 0;
  while (segment < last - 1 && time > frames[segment + 1].timeMs) segment++;
  const start = frames[segment], end = frames[segment + 1];
  const h = end.timeMs - start.timeMs, s = (time - start.timeMs) / h;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * start.value + (s3 - 2 * s2 + s) * h * tangents[segment]
    + (-2 * s3 + 3 * s2) * end.value + (s3 - s2) * h * tangents[segment + 1];
}
function trackValue(track: MotionTrack, timeMs: number): number {
  const value = track.interpolation === "smooth"
    ? smoothInterpolate(track.keyframes, timeMs, track.ease)
    : interpolate(track.keyframes, timeMs);
  return track.noise ? value + track.noise.amplitude * sampleNoise(track.noise, timeMs) : value;
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
  const parsed = MotionSchema.safeParse(input);
  if (!parsed.success)
    result.issues.push(
      ...parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  if (!Number.isFinite(timeMs))
    result.issues.push({
      path: "timeMs",
      message: "Scene time must be a finite number.",
    });
  if (!parsed.success || result.issues.length) return result;
  const time = Math.min(parsed.data.durationMs, Math.max(0, timeMs) * parsed.data.speed);
  for (const track of parsed.data.tracks) {
    const value = trackValue(track, time);
    if (track.target.kind === "surface") {
      const id = track.target.id;
      // Own data properties support arbitrary IDs without reading/writing Object.prototype.
      const prior = Object.hasOwn(result.surfaces, id)
        ? result.surfaces[id]
        : {};
      Object.defineProperty(result.surfaces, id, {
        value: { ...prior, [track.property]: value },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else if (track.target.kind === "camera") {
      result.camera = { ...result.camera, [track.property]: value };
    } else if (track.target.kind === "focus") {
      result.focus = { ...result.focus, [track.property]: value };
    } else {
      Object.defineProperty(result.channels, track.target.id, { value, enumerable: true, configurable: true, writable: true });
    }
  }
  return result;
}
/** Largest per-track difference between the first and last authored instant: 0 means a seamless loop. */
export function loopSeam(input: unknown): number {
  const parsed = MotionSchema.safeParse(input);
  if (!parsed.success) return Number.NaN;
  return parsed.data.tracks.reduce((seam, track) =>
    Math.max(seam, Math.abs(trackValue(track, parsed.data.durationMs) - trackValue(track, 0))), 0);
}

// Shared timeline conversion: callers supply elapsed presentation milliseconds.
// Opt-in host animations use motionTime through useSceneTime, so charts and spatial
// transforms stay synchronized. Exports sample the same elapsed clock as preview.
export function motionDuration(input: unknown): number {
  const parsed = MotionSchema.safeParse(input);
  return parsed.success ? parsed.data.durationMs / parsed.data.speed : 0;
}
export function motionTime(input: unknown, elapsedMs: number): number {
  const parsed = MotionSchema.safeParse(input);
  return parsed.success && Number.isFinite(elapsedMs)
    ? Math.min(parsed.data.durationMs, Math.max(0, elapsedMs) * parsed.data.speed) : 0;
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
