import { CameraSchema, FocusSchema, MotionSchema, TransformSchema, evaluateMotion, type MotionState, type TrackAddress } from "../core";
import type { SceneSnapshot } from "../react";
import type { Doc } from "./store";
import { findTrack } from "./model";

/** Inspector property catalog and value resolution at the playhead. Keyframe times are authored time;
 * the session cursor is presentation time (authored / motion.speed). Convert only through here. */
export type PropertySpec = { name: string; label?: string; unit?: string; step: number; min?: number; max?: number };
export const TRANSFORM_PROPS: readonly PropertySpec[] = [
  { name: "x", unit: "px", step: 1 }, { name: "y", unit: "px", step: 1 }, { name: "z", unit: "px", step: 1 },
  { name: "rotateX", unit: "°", step: 0.5 }, { name: "rotateY", unit: "°", step: 0.5 }, { name: "rotateZ", unit: "°", step: 0.5 },
  { name: "scale", step: 0.01, min: 0.01, max: 100 }, { name: "scaleX", step: 0.01, min: 0.01, max: 100 }, { name: "scaleY", step: 0.01, min: 0.01, max: 100 }, { name: "scaleZ", step: 0.01, min: 0.01, max: 100 },
  { name: "skewX", unit: "°", step: 0.5, min: -89, max: 89 }, { name: "skewY", unit: "°", step: 0.5, min: -89, max: 89 },
  { name: "originX", unit: "%", step: 1, min: -100, max: 200 }, { name: "originY", unit: "%", step: 1, min: -100, max: 200 },
];
export const VISUAL_PROPS: readonly PropertySpec[] = [
  { name: "opacity", step: 0.01, min: 0, max: 1 }, { name: "blur", unit: "px", step: 0.1, min: 0, max: 64 },
  { name: "brightness", step: 0.01, min: 0, max: 4 }, { name: "contrast", step: 0.01, min: 0, max: 4 }, { name: "saturate", step: 0.01, min: 0, max: 4 },
  { name: "hueRotate", unit: "°", step: 1, min: -360, max: 360 }, { name: "grayscale", step: 0.01, min: 0, max: 1 },
  { name: "clipTop", unit: "%", step: 0.5, min: 0, max: 100 }, { name: "clipRight", unit: "%", step: 0.5, min: 0, max: 100 },
  { name: "clipBottom", unit: "%", step: 0.5, min: 0, max: 100 }, { name: "clipLeft", unit: "%", step: 0.5, min: 0, max: 100 },
  { name: "clipRadius", unit: "%", step: 0.5, min: 0, max: 150 },
];
export const CAMERA_PROPS: readonly PropertySpec[] = [
  { name: "x", unit: "px", step: 1 }, { name: "y", unit: "px", step: 1 }, { name: "z", unit: "px", step: 1 },
  { name: "rotateX", unit: "°", step: 0.5 }, { name: "rotateY", unit: "°", step: 0.5 }, { name: "rotateZ", unit: "°", step: 0.5 },
  { name: "perspective", unit: "px", step: 10, min: 100, max: 10_000 },
];
export const FOCUS_PROPS: readonly PropertySpec[] = [
  { name: "distance", unit: "px", step: 10, min: 1 }, { name: "fStop", step: 0.1, min: 0.7, max: 128 },
  { name: "focalLength", unit: "px", step: 1, min: 1, max: 300 }, { name: "maxBlur", unit: "px", step: 0.1, min: 0, max: 32 },
];
const VISUAL_BASE: Record<string, number> = { opacity: 1, blur: 0, brightness: 1, contrast: 1, saturate: 1, hueRotate: 0, grayscale: 0, clipTop: 0, clipRight: 0, clipBottom: 0, clipLeft: 0, clipRadius: 150 };
/** The motion speed (authored ms per presentation ms); legacy recipes default to 0.5. */
export function motionSpeed(doc: Doc): number {
  // Read the field with the schema's default; never parse the whole motion just for its speed.
  const motion = doc?.definition?.motion;
  if (!motion) return 1;
  const speed = motion.speed;
  return typeof speed === "number" && speed > 0 ? speed : MOTION_DEFAULT_SPEED;
}
const MOTION_DEFAULT_SPEED = MotionSchema.parse({ durationMs: 0, tracks: [] }).speed;
export const toAuthored = (doc: Doc, presentationMs: number) => presentationMs * motionSpeed(doc);
export const toPresentation = (doc: Doc, authoredMs: number) => authoredMs / motionSpeed(doc);
/** Evaluated motion at a presentation time (the compiled evaluator caches per draft motion object). */
export function stateAt(doc: Doc, presentationMs: number): MotionState | undefined {
  const motion = doc?.definition?.motion;
  if (!motion) return undefined;
  const state = evaluateMotion(motion, presentationMs);
  return state.issues.length ? undefined : state;
}
/** The value a property shows at the playhead: animated value, else the static base, else the default. */
export function valueAt(doc: Doc, address: TrackAddress, state: MotionState | undefined, snapshot: SceneSnapshot | undefined): number | string | undefined {
  const { target, property } = address;
  if (target.kind === "camera") {
    const animated = state?.camera[property as keyof MotionState["camera"]];
    return animated ?? (CameraSchema.safeParse(doc?.definition?.scene?.camera ?? {}).data as Record<string, number> | undefined)?.[property];
  }
  if (target.kind === "focus") {
    const animated = state?.focus[property as keyof MotionState["focus"]];
    return animated ?? (FocusSchema.safeParse(doc?.definition?.scene?.focus ?? {}).data as Record<string, number> | undefined)?.[property];
  }
  if (target.kind === "surface") {
    const animated = state && Object.hasOwn(state.surfaces, target.id) ? (state.surfaces[target.id] as Record<string, number>)[property] : undefined;
    if (animated !== undefined) return animated + (state?.additive?.surfaces?.[target.id]?.[property] ?? 0);
    if (property in VISUAL_BASE) return VISUAL_BASE[property] + (state?.additive?.surfaces?.[target.id]?.[property] ?? 0);
    const binding = snapshot?.bindings.find(entry => entry.id === target.id);
    const base = (TransformSchema.safeParse(binding?.transform ?? {}).data ?? TransformSchema.parse({})) as Record<string, number | undefined>;
    const value = base[property] ?? (property.startsWith("scale") ? 1 : property.startsWith("origin") ? 50 : 0);
    return value + (state?.additive?.surfaces?.[target.id]?.[property] ?? 0);
  }
  if (target.kind === "style") return state?.styles?.[target.id]?.[property];
  if (target.kind === "channel") return state ? (Object.hasOwn(state.channels, target.id) ? state.channels[target.id] : state.colorChannels?.[target.id]) : undefined;
  return undefined;
}
/** Whether the playhead sits exactly on a keyframe of the track (authored time). */
export function keyAtPlayhead(doc: Doc, address: TrackAddress, authoredMs: number): boolean {
  return !!findTrack(doc, address)?.keyframes.some((frame: { timeMs: number }) => Math.abs(frame.timeMs - authoredMs) < 1e-6);
}
