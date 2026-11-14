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
import { createRng } from "./random";
import { compilePath, orientAngles, type CompiledPath } from "./paths";

/** SOURCE OF TRUTH: MotionSchema, evaluateMotion, motionDuration, motionTime, cinematicProgress, cinematicTimeAtProgress, sampleFrameTime, loopSeam, monotoneTangents, explicit scene time.
 * WHAT: typed motion tracks (surface, camera, focus, channel, style), target/property validation and
 * deterministic interpolation: eased or auto-bezier segments, C1-smooth paths, OKLab color segments,
 * spatial position paths (arc-length timed), clips (groups in time: speed, trim, loop, ease, additive
 * mode, staggers) and declarative links, plus seeded noise texture. One compiled evaluator caches the parse per immutable motion object.
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
const VectorSchema = z.tuple([finite, finite, finite]);
// Spatial path keyframes: easing maps segment time to distance along the curve. Handles are offsets
// (out from this keyframe, in toward it); omitted handles use automatic Catmull-Rom tangents.
export const PathKeyframeSchema = z.strictObject({
  timeMs: finite.nonnegative(),
  value: VectorSchema,
  easing: KeyframeEasingSchema.default("cinematic"),
  inTangent: VectorSchema.optional(),
  outTangent: VectorSchema.optional(),
});
const pathKeyframes = z.array(PathKeyframeSchema).min(1);
const pathOptions = {
  // Constant speed across the whole path; interior keyframe times then only shape the curve.
  rove: z.boolean().optional(),
  // Derive rotateY (and rotateX for yaw-pitch) from the path tangent.
  orient: z.strictObject({ axis: z.enum(["yaw", "yaw-pitch"]), offsetDeg: finite.min(-360).max(360).optional() }).optional(),
};
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
    // Spatial position paths for surfaces and the camera (x, y, z together).
    z.strictObject({
      target: z.strictObject({ kind: z.literal("surface"), id: z.string().min(1) }),
      property: z.literal("position"),
      keyframes: pathKeyframes,
      ...pathOptions,
      ...trackOptions,
    }),
    z.strictObject({
      target: z.strictObject({ kind: z.literal("camera") }),
      property: z.literal("position"),
      keyframes: pathKeyframes,
      ...pathOptions,
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
    const path = track.property === "position";
    const values = path ? undefined : propertyValues[track.target.kind];
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
    if (path && (track.interpolation !== undefined || track.ease !== undefined || track.noise !== undefined))
      ctx.addIssue({ code: "custom", path: ["interpolation"], message: "Position path tracks take keyframe easing and optional rove; smooth interpolation, track ease and noise do not apply." });
    if (color && track.interpolation === "smooth")
      ctx.addIssue({ code: "custom", path: ["interpolation"], message: "Color tracks evaluate as segments; smooth interpolation applies to numeric tracks." });
    if (track.ease !== undefined && track.interpolation !== "smooth")
      ctx.addIssue({ code: "custom", path: ["ease"], message: "Track ease applies only to interpolation \"smooth\"; use keyframe easing for segments." });
    if (!path && track.noise && (color || !noiseTargets[track.target.kind]?.includes(track.property)))
      ctx.addIssue({ code: "custom", path: ["noise"], message: color ? "Noise texture applies to numeric tracks, not colors." : `Noise texture applies to position, rotation and channel tracks, not ${track.target.kind} ${track.property}.` });
  });
/** A track key without keyframes: the same (target, property) uniqueness key tracks use. */
export const TrackRefSchema = z.union([
  z.strictObject({ target: z.strictObject({ kind: z.literal("surface"), id: z.string().min(1) }), property: SurfaceMotionSchema.keyof() }),
  z.strictObject({ target: z.strictObject({ kind: z.literal("camera") }), property: CameraMotionSchema.keyof() }),
  z.strictObject({ target: z.strictObject({ kind: z.literal("focus") }), property: FocusMotionSchema.keyof() }),
  z.strictObject({ target: channelTarget, property: z.literal("value") }),
  z.strictObject({ target: styleTarget, property: styleProperty }),
]);
export type TrackRef = z.output<typeof TrackRefSchema>;
export const STAGGER_ORDERS = Object.freeze(["forward", "reverse", "center-out", "edges-in"] as const);
export const MEMBER_PLACEHOLDER = "$member";
const clipId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/, "Use a clip id of letters, digits, _ and - (up to 64).");
export type MotionClipInput = {
  id: string; label?: string; startMs: number; speed?: number; inMs?: number; durationMs?: number;
  loop?: false | number; ease?: z.input<typeof EasingSchema>; mode?: "replace" | "add";
  tracks?: z.input<typeof MotionTrackSchema>[]; clips?: MotionClipInput[];
  members?: string[]; stagger?: { eachMs: number; order?: (typeof STAGGER_ORDERS)[number] | { random: number }; ease?: z.input<typeof EasingSchema> };
  source?: { behavior: string; version: number; params?: Record<string, unknown> };
};
/** Clips group animation in time: the group moves, retimes, eases and loops as one unit. */
export const MotionClipSchema: z.ZodType<MotionClipOutput, MotionClipInput> = z.lazy(() => z.strictObject({
  id: clipId,
  label: z.string().max(80).optional(),
  // Where clip-local 0 lands on the parent timeline.
  startMs: finite.nonnegative(),
  speed: finite.min(0.05).max(4).optional(),
  // Optional trim of clip-local time.
  inMs: finite.nonnegative().optional(),
  durationMs: finite.positive().optional(),
  // false or a play count.
  loop: z.union([z.literal(false), z.number().int().min(1).max(10_000)]).optional(),
  // Time remap across the clip span (group easing), applied per loop.
  ease: EasingSchema.optional(),
  mode: z.enum(["replace", "add"]).optional(),
  tracks: z.array(MotionTrackSchema).optional(),
  clips: z.array(MotionClipSchema).max(64).optional(),
  // Stagger: tracks targeting {kind:"surface", id:"$member"} repeat for each member, offset in time.
  members: z.array(z.string().min(1)).min(1).max(256).optional(),
  stagger: z.strictObject({
    eachMs: finite.nonnegative(),
    order: z.union([z.enum(STAGGER_ORDERS), z.strictObject({ random: z.number().int().nonnegative().max(4_294_967_295) })]).optional(),
    ease: EasingSchema.optional(),
  }).optional(),
  // Provenance of a generated clip (behaviors and presets, Phase 07).
  source: z.strictObject({ behavior: z.string().min(1).max(64), version: z.number().int().positive(), params: z.record(z.string(), z.unknown()).optional() }).optional(),
}));
export type MotionClipOutput = {
  id: string; label?: string; startMs: number; speed?: number; inMs?: number; durationMs?: number;
  loop?: false | number; ease?: Easing; mode?: "replace" | "add";
  tracks?: MotionTrack[]; clips?: MotionClipOutput[];
  members?: string[]; stagger?: { eachMs: number; order?: (typeof STAGGER_ORDERS)[number] | { random: number }; ease?: Easing };
  source?: { behavior: string; version: number; params?: Record<string, unknown> };
};
/** Declarative drivers (no expressions): to(t) = from(t - delayMs) * scale + offset. */
export const MotionLinkSchema = z.strictObject({
  to: TrackRefSchema,
  from: z.union([TrackRefSchema, z.strictObject({ channel: z.string().min(1).max(128) })]),
  scale: finite.optional(),
  offset: finite.optional(),
  delayMs: finite.min(-120_000).max(120_000).optional(),
  mode: z.enum(["replace", "add"]).optional(),
});
export type MotionLink = z.output<typeof MotionLinkSchema>;
export const MAX_CLIP_DEPTH = 4, MAX_LINKS = 256, MAX_LINK_DEPTH = 8;
export const MotionSchema = z
  .strictObject({
    durationMs: finite.nonnegative(),
    speed: finite.min(0.05).max(4).default(0.5),
    // Preview playback wraps for seamless loops; exports still render exactly one duration.
    loop: z.boolean().optional(),
    tracks: z.array(MotionTrackSchema),
    clips: z.array(MotionClipSchema).max(256).optional(),
    links: z.array(MotionLinkSchema).max(MAX_LINKS).optional(),
  })
  .superRefine((motion, ctx) => {
    if (!Number.isFinite(motion.durationMs / motion.speed))
      ctx.addIssue({code:"custom",path:["durationMs"],message:"Presentation duration must remain finite at the chosen speed."});
    for (const issue of structureIssues(motion)) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
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
  /** Offsets from add clips and add links on properties without a replace owner: add them to the
   * static base (see withAdditive). Present only when such offsets exist. */
  additive?: AdditiveState;
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

// ---------------------------------------------------------------------------------------------
// Structure: clips (with staggers), position paths and links flatten into "virtual tracks", each with
// a time map from authored scene time to the track's local time. Flattening happens once per compiled
// motion, so the per-frame cost stays linear in the number of tracks.
type Slot = { kind: string; id?: string; property: string };
const slotKey = (slot: Slot) => `${slot.kind}\u0000${slot.id ?? ""}\u0000${slot.property}`;
const refSlot = (ref: TrackRef | { channel: string }): Slot => "channel" in ref
  ? { kind: "channel", id: ref.channel, property: "value" }
  : { kind: ref.target.kind, id: "id" in ref.target ? ref.target.id : undefined, property: ref.property };
const describeSlot = (slot: Slot) => slot.id === undefined ? `${slot.kind}.${slot.property}` : `${slot.kind} ${slot.id}.${slot.property}`;
type TimeMap = (time: number) => number;
type Virtual = { track: MotionTrack; owner: string; add: boolean; map?: TimeMap };
/** Ownership slots of a track: a position path owns x, y and z (and the rotations orient derives). */
function trackSlots(track: MotionTrack): Slot[] {
  const id = "id" in track.target ? track.target.id : undefined;
  if (track.property !== "position") return [{ kind: track.target.kind, id, property: track.property }];
  const slots = ["x", "y", "z"].map(property => ({ kind: track.target.kind, id, property }));
  const orient = "orient" in track ? track.orient : undefined;
  if (orient) slots.push({ kind: track.target.kind, id, property: "rotateY" });
  if (orient?.axis === "yaw-pitch") slots.push({ kind: track.target.kind, id, property: "rotateX" });
  return slots;
}
const lastTime = (track: MotionTrack) => track.keyframes[track.keyframes.length - 1].timeMs;
/** Normalized stagger position (0..1) of each member for an order. */
function staggerPositions(count: number, order: NonNullable<MotionClipOutput["stagger"]>["order"] = "forward"): number[] {
  if (count <= 1) return Array.from({ length: count }, () => 0);
  const last = count - 1, center = last / 2;
  if (typeof order === "object") {
    const rng = createRng(order.random), ranks = Array.from({ length: count }, (_, i) => i);
    for (let i = last; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ranks[i], ranks[j]] = [ranks[j], ranks[i]]; }
    return ranks.map(rank => rank / last);
  }
  return Array.from({ length: count }, (_, i) => order === "forward" ? i / last : order === "reverse" ? (last - i) / last
    : order === "center-out" ? Math.abs(i - center) / center : 1 - Math.abs(i - center) / center);
}
/** Each member's time offset: ease(position) * eachMs * (n - 1). */
export function staggerOffsets(clip: Pick<MotionClipOutput, "members" | "stagger">): number[] {
  const members = clip.members ?? [], stagger = clip.stagger;
  if (!stagger) return members.map(() => 0);
  return staggerPositions(members.length, stagger.order).map(position =>
    (stagger.ease ? applyEasing(stagger.ease, position) : position) * stagger.eachMs * Math.max(0, members.length - 1));
}
/** Clip-local span (after trim) and its end on the parent timeline (after speed and loops). */
export function clipTiming(clip: MotionClipOutput): { span: number; endMs: number } {
  const offsets = staggerOffsets(clip);
  const natural = Math.max(0, ...(clip.tracks ?? []).map(lastTime), ...(clip.clips ?? []).map(child => clipTiming(child).endMs)) + Math.max(0, ...offsets);
  const span = clip.durationMs ?? Math.max(0, natural - (clip.inMs ?? 0));
  const plays = clip.loop || 1;
  return { span, endMs: clip.startMs + (span * plays) / (clip.speed ?? 1) };
}
function clipMap(clip: MotionClipOutput): TimeMap {
  const { span } = clipTiming(clip);
  const speed = clip.speed ?? 1, inMs = clip.inMs ?? 0, plays = clip.loop || 1, ease = clip.ease;
  return time => {
    if (span <= 0) return inMs;
    const raw = (time - clip.startMs) * speed;
    let within: number;
    if (raw <= 0) within = 0;
    else if (raw >= span * plays) within = span;
    else within = raw - Math.floor(raw / span) * span;
    // Without a group ease the local time is exact (no divide-multiply round trip).
    return inMs + (ease ? applyEasing(ease, within / span) * span : within);
  };
}
const compose = (outer: TimeMap | undefined, inner: TimeMap): TimeMap => outer ? time => inner(outer(time)) : inner;
function flatten(motion: Pick<MotionDefinition, "tracks" | "clips">): Virtual[] {
  const virtual: Virtual[] = motion.tracks.map((track, index) => ({ track, owner: `tracks.${index}`, add: false }));
  const visit = (clip: MotionClipOutput, path: string, outer: TimeMap | undefined, add: boolean) => {
    const map = compose(outer, clipMap(clip));
    const additive = add || clip.mode === "add";
    const members = clip.members, offsets = staggerOffsets(clip);
    for (const [index, track] of (clip.tracks ?? []).entries()) {
      const owner = `${path}.tracks.${index}`;
      const memberTrack = track.target.kind === "surface" && track.target.id === MEMBER_PLACEHOLDER;
      if (memberTrack && members) members.forEach((member, i) => virtual.push({
        track: { ...track, target: { kind: "surface", id: member } } as MotionTrack, owner: `${owner}[${i}]`, add: additive,
        map: time => map(time) - offsets[i],
      }));
      else virtual.push({ track, owner, add: additive, map });
    }
    for (const [index, child] of (clip.clips ?? []).entries()) visit(child, `${path}.clips.${index}`, map, additive);
  };
  for (const [index, clip] of (motion.clips ?? []).entries()) visit(clip, `clips.${index}`, undefined, false);
  return virtual;
}
type StructureIssue = { path: (string | number)[]; message: string };
const splitPath = (owner: string) => owner.replace(/\[\d+\]$/, "").split(".").map(part => /^\d+$/.test(part) ? Number(part) : part);
/** Cross-track rules for clips, paths and links: one replace owner per property, clip depth, ids,
 * stagger shape, clip end within the scene, acyclic links. Root-track duplicates keep their v2 message. */
function structureIssues(motion: MotionDefinition): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const structured = (motion.clips?.length ?? 0) > 0 || (motion.links?.length ?? 0) > 0 || motion.tracks.some(track => track.property === "position");
  if (!structured) return issues;
  const ids = new Set<string>();
  const visit = (clip: MotionClipOutput, path: (string | number)[], depth: number) => {
    if (depth > MAX_CLIP_DEPTH) issues.push({ path, message: `Clips nest at most ${MAX_CLIP_DEPTH} levels deep.` });
    if (ids.has(clip.id)) issues.push({ path: [...path, "id"], message: `Duplicate clip id "${clip.id}".` });
    ids.add(clip.id);
    if ((clip.members === undefined) !== (clip.stagger === undefined)) issues.push({ path, message: "A stagger clip needs both members and stagger." });
    for (const [index, track] of (clip.tracks ?? []).entries()) {
      if (track.target.kind === "surface" && track.target.id === MEMBER_PLACEHOLDER && !clip.members)
        issues.push({ path: [...path, "tracks", index, "target", "id"], message: `${MEMBER_PLACEHOLDER} targets need a stagger clip with members.` });
      if ((clip.mode === "add") && track.keyframes.some(frame => typeof frame.value === "string"))
        issues.push({ path: [...path, "tracks", index], message: "Additive clips sum numbers; put color tracks in a replace clip." });
    }
    for (const [index, child] of (clip.clips ?? []).entries()) visit(child, [...path, "clips", index], depth + 1);
  };
  for (const [index, clip] of (motion.clips ?? []).entries()) {
    visit(clip, ["clips", index], 1);
    const { endMs } = clipTiming(clip);
    if (endMs > motion.durationMs + 1e-9) issues.push({ path: ["clips", index], message: `Clip "${clip.id}" ends at ${Math.round(endMs)}ms, after the scene duration ${motion.durationMs}ms.` });
  }
  // One replace owner per (target, property) across root tracks, replace clips and replace links.
  const owners = new Map<string, { owner: string; direct: boolean }>();
  // direct: the track's own property (not one a position path or orient derives).
  const claim = (slot: Slot, owner: string, direct: boolean) => {
    const key = slotKey(slot), prior = owners.get(key);
    if (prior !== undefined && prior.owner !== owner) {
      // Two root tracks on the same property already report "Duplicate target/property track.".
      if (!(prior.owner.startsWith("tracks.") && owner.startsWith("tracks.") && prior.direct && direct))
        issues.push({ path: splitPath(owner), message: `${describeSlot(slot)} has two replace owners: ${prior.owner} and ${owner}. Move one into an add clip or remove it.` });
      return;
    }
    owners.set(key, { owner, direct });
  };
  for (const entry of flatten(motion)) {
    if (entry.add) continue;
    for (const slot of trackSlots(entry.track)) claim(slot, entry.owner, slot.property === entry.track.property);
  }
  const links = motion.links ?? [], targets = new Map<string, number>();
  for (const [index, link] of links.entries()) {
    const key = slotKey(refSlot(link.to));
    if (targets.has(key)) issues.push({ path: ["links", index, "to"], message: `${describeSlot(refSlot(link.to))} is already driven by links.${targets.get(key)}.` });
    targets.set(key, index);
    if ((link.mode ?? "replace") === "replace") claim(refSlot(link.to), `links.${index}`, true);
  }
  // Links form an acyclic chain graph (to <- from) of bounded depth.
  const depthOf = (key: string, trail: string[]): number => {
    const index = targets.get(key);
    if (index === undefined) return 0;
    if (trail.includes(key)) throw new Error([...trail, key].map(entry => describeSlot(slotFromKey(entry))).join(" -> "));
    return 1 + depthOf(slotKey(refSlot(links[index].from)), [...trail, key]);
  };
  for (const [index, link] of links.entries()) {
    try {
      if (depthOf(slotKey(refSlot(link.to)), []) > MAX_LINK_DEPTH) issues.push({ path: ["links", index], message: `Link chains are at most ${MAX_LINK_DEPTH} deep.` });
    } catch (cycle) {
      issues.push({ path: ["links", index], message: `Links form a cycle: ${(cycle as Error).message}.` });
      break;
    }
  }
  return issues;
}
function slotFromKey(key: string): Slot {
  const [kind, id, property] = key.split("\u0000");
  return { kind, id: id || undefined, property };
}

/** SOURCE OF TRUTH: the compiled evaluator (one path; the cache only skips repeated parsing).
 * Motion inputs are treated as immutable: callers that change a motion pass a new object. A cheap
 * structural fingerprint (duration, track and keyframe counts) recompiles a mutated cached object. */
type CompiledTrack = { track: MotionTrack; color: boolean; value: (time: number) => number | string; path?: CompiledPath };
type Entry = { compiled: CompiledTrack; add: boolean; map?: TimeMap; slots: Slot[]; keys: string[] };
type Compiled = { parsed?: MotionDefinition; issues: SceneIssue[]; entries: Entry[]; slots: Map<string, Slot & { unit?: string; color: boolean }>;
  byKey: Map<string, { entry: Entry; component: number }[]>; links: { link: MotionLink; to: string; from: string }[]; linkByTo: Map<string, { link: MotionLink; to: string; from: string }>; fingerprint: string };
const compiledMotion = new WeakMap<object, Compiled>();
/** Duration plus track, clip, link and keyframe counts of a raw motion input (for mutation diagnostics). */
export function motionFingerprint(input: unknown): string {
  if (typeof input !== "object" || input === null) return String(input);
  const raw = input as { durationMs?: unknown; speed?: unknown; tracks?: unknown; clips?: unknown; links?: unknown };
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  let frames = 0;
  for (const track of tracks) {
    const list = (track as { keyframes?: unknown } | null)?.keyframes;
    frames += Array.isArray(list) ? list.length : 0;
  }
  const structure = (Array.isArray(raw.clips) ? `|c${raw.clips.length}` : "") + (Array.isArray(raw.links) ? `|l${raw.links.length}` : "");
  return `${String(raw.durationMs)}|${String(raw.speed)}|${tracks.length}|${frames}${structure}`;
}
function compileTrack(track: MotionTrack): CompiledTrack {
  if (track.property === "position") {
    const frames = track.keyframes as z.output<typeof PathKeyframeSchema>[];
    const path = compilePath(frames.map(frame => ({
      timeMs: frame.timeMs, value: frame.value, inTangent: frame.inTangent, outTangent: frame.outTangent,
      progress: frame.easing === "auto" ? (t: number) => t : (t: number) => applyEasing(frame.easing as Easing, t),
    })), "rove" in track && track.rove === true);
    return { track, color: false, value: () => 0, path };
  }
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
  const empty = { entries: [], slots: new Map(), byKey: new Map(), links: [], linkByTo: new Map(), fingerprint };
  if (!parsed.success)
    return { issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })), ...empty };
  const slots: Compiled["slots"] = new Map(), byKey: Compiled["byKey"] = new Map();
  const entries = flatten(parsed.data).map(({ track, add, map }) => {
    const compiled = compileTrack(track);
    const trackSlotList = trackSlots(track);
    const keys = trackSlotList.map(slotKey);
    const entry: Entry = { compiled, add, map, slots: trackSlotList, keys };
    trackSlotList.forEach((slot, component) => {
      if (!slots.has(keys[component])) slots.set(keys[component], { ...slot, unit: "unit" in track ? track.unit : undefined, color: compiled.color });
      byKey.set(keys[component], [...(byKey.get(keys[component]) ?? []), { entry, component }]);
    });
    return entry;
  });
  const links = (parsed.data.links ?? []).map(link => {
    const to = slotKey(refSlot(link.to)), from = slotKey(refSlot(link.from));
    if (!slots.has(to)) slots.set(to, { ...refSlot(link.to), color: false });
    return { link, to, from };
  });
  return { parsed: parsed.data, issues: [], entries, slots, byKey, links, linkByTo: new Map(links.map(entry => [entry.to, entry])), fingerprint };
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
/** One component of an entry at authored time: path components 0..2 are x/y/z, 3 yaw and 4 pitch. */
function entryValue(entry: Entry, component: number, time: number, cache?: Map<Entry, unknown>): number | string {
  const local = entry.map ? entry.map(time) : time;
  const path = entry.compiled.path;
  if (!path) {
    if (cache?.has(entry)) return cache.get(entry) as number | string;
    const value = entry.compiled.value(local);
    cache?.set(entry, value);
    return value;
  }
  let sample = cache?.get(entry) as ReturnType<CompiledPath["sample"]> | undefined;
  if (!sample) { sample = path.sample(local); cache?.set(entry, sample); }
  if (component < 3) return sample.point[component];
  const orient = "orient" in entry.compiled.track ? entry.compiled.track.orient! : { axis: "yaw" as const };
  const angles = orientAngles(sample.tangent);
  return (component === 3 ? angles.yaw : angles.pitch) + (orient.offsetDeg ?? 0);
}
/** Base value of a slot from its tracks (replace value plus additive values); undefined without tracks. */
function baseValue(motion: Compiled, key: string, time: number): { replace?: number | string; add?: number } {
  const result: { replace?: number | string; add?: number } = {};
  for (const { entry, component } of motion.byKey.get(key) ?? []) {
    const value = entryValue(entry, component, time);
    if (entry.add) result.add = (result.add ?? 0) + (typeof value === "number" ? value : 0);
    else result.replace = value;
  }
  return result;
}
/** Final numeric value of a slot at a time, including links (used for link sources with delays). */
function slotValue(motion: Compiled, key: string, time: number): number | undefined {
  const base = baseValue(motion, key, time);
  let value = typeof base.replace === "number" ? base.replace + (base.add ?? 0) : base.add;
  const link = motion.linkByTo.get(key);
  if (link) {
    const contribution = (slotValue(motion, link.from, time - (link.link.delayMs ?? 0)) ?? 0) * (link.link.scale ?? 1) + (link.link.offset ?? 0);
    value = (link.link.mode ?? "replace") === "add" ? (value ?? 0) + contribution : contribution;
  }
  return value;
}
/** Every slot's value at one authored time: replace values in first-write order, plus additive values
 * for slots without a replace owner (they add onto the static base). */
function frameValues(motion: Compiled, time: number): { values: Map<string, number | string>; additive: Map<string, number> } {
  const values = new Map<string, number | string>(), additive = new Map<string, number>();
  const cache = new Map<Entry, unknown>();
  for (const entry of motion.entries) entry.keys.forEach((key, component) => {
    const value = entryValue(entry, component, time, cache);
    if (!entry.add) values.set(key, value);
    else if (typeof value === "number") additive.set(key, (additive.get(key) ?? 0) + value);
  });
  for (const { link, to, from } of motion.links) {
    const contribution = (slotValue(motion, from, time - (link.delayMs ?? 0)) ?? 0) * (link.scale ?? 1) + (link.offset ?? 0);
    if ((link.mode ?? "replace") === "add") additive.set(to, (additive.get(to) ?? 0) + contribution);
    else { values.delete(to); values.set(to, contribution); }
  }
  for (const [key, add] of additive) {
    const owner = values.get(key);
    if (typeof owner === "number") { values.set(key, owner + add); additive.delete(key); }
    else if (["channel", "style"].includes(motion.slots.get(key)?.kind ?? "")) { values.set(key, add); additive.delete(key); }
  }
  return { values, additive };
}
// Own data properties support arbitrary IDs without reading/writing Object.prototype.
function own<T>(record: Record<string, T>, key: string, value: T) {
  Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true });
}
export type AdditiveState = {
  surfaces?: Record<string, Record<string, number>>;
  camera?: Record<string, number>;
  focus?: Record<string, number>;
};

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
  const { values, additive } = frameValues(motion, time);
  for (const [key, value] of values) {
    const slot = motion.slots.get(key)!;
    if (slot.kind === "surface") {
      const id = slot.id!;
      const prior = Object.hasOwn(result.surfaces, id)
        ? result.surfaces[id]
        : {};
      own(result.surfaces, id, { ...prior, [slot.property]: value as number });
    } else if (slot.kind === "camera") {
      result.camera = { ...result.camera, [slot.property]: value };
    } else if (slot.kind === "focus") {
      result.focus = { ...result.focus, [slot.property]: value };
    } else if (slot.kind === "style") {
      const styles = (result.styles ??= {});
      const id = slot.id!;
      const prior = Object.hasOwn(styles, id) ? styles[id] : {};
      const css = typeof value === "string" ? value : cssNumber(value) + (slot.unit ?? "");
      own(styles, id, { ...prior, [slot.property]: css });
    } else if (typeof value === "string") {
      own((result.colorChannels ??= {}), slot.id!, value);
    } else {
      own(result.channels, slot.id!, value);
    }
  }
  if (additive.size) {
    const bucket: AdditiveState = (result.additive = {});
    for (const [key, value] of additive) {
      const slot = motion.slots.get(key)!;
      if (slot.kind === "surface") {
        const surfaces = (bucket.surfaces ??= {});
        own(surfaces, slot.id!, { ...(Object.hasOwn(surfaces, slot.id!) ? surfaces[slot.id!] : {}), [slot.property]: value });
      } else if (slot.kind === "camera" || slot.kind === "focus") (bucket[slot.kind] ??= {})[slot.property] = value;
    }
  }
  return result;
}
/** Base values plus additive offsets: an add clip with no replace owner adds onto the static base
 * (the scene's camera/focus/node transform, or the schema default when the base omits it). */
export function withAdditive<T extends Record<string, unknown>>(base: T, add: Record<string, number> | undefined, defaults: Record<string, unknown> = {}): T {
  if (!add) return base;
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(add)) {
    const current = base[key] ?? defaults[key] ?? 0;
    next[key] = (typeof current === "number" ? current : 0) + value;
  }
  return next as T;
}
/** Largest per-property difference between the first and last authored instant: 0 means a seamless loop.
 * Color tracks measure the largest sRGB channel (or alpha) difference in 0..255 units. */
export function loopSeam(input: unknown): number {
  const motion = compiled(input);
  if (!motion.parsed) return Number.NaN;
  const end = frameValues(motion, motion.parsed.durationMs), start = frameValues(motion, 0);
  let seam = 0;
  for (const [key, value] of end.values) {
    const first = start.values.get(key);
    seam = Math.max(seam, typeof value === "string" ? colorDifference(value, first as string) : Math.abs(value - (first as number)));
  }
  for (const [key, value] of end.additive) seam = Math.max(seam, Math.abs(value - (start.additive.get(key) ?? 0)));
  return seam;
}
/** Every track after clip and stagger expansion ($member resolved), for review and editors. */
export function motionTracks(input: unknown): { track: MotionTrack; owner: string; add: boolean }[] {
  const parsed = compiled(input).parsed;
  return parsed ? flatten(parsed).map(({ track, owner, add }) => ({ track, owner, add })) : [];
}
/** Segment speeds (px/ms) of every position path, for review advice. */
export function pathSpeeds(input: unknown): { owner: string; speeds: number[]; rove: boolean }[] {
  const motion = compiled(input);
  if (!motion.parsed) return [];
  return flatten(motion.parsed).flatMap(({ track, owner }) => {
    if (track.property !== "position") return [];
    const entry = motion.entries.find(candidate => candidate.compiled.track === track || (candidate.compiled.track.property === "position" && candidate.compiled.track.keyframes === track.keyframes));
    return entry?.compiled.path ? [{ owner, speeds: entry.compiled.path.segmentSpeeds, rove: "rove" in track && track.rove === true }] : [];
  });
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
