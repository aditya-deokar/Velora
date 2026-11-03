import { z } from "zod";
import { TransformSchema, CameraSchema, FocusSchema } from "./scene";
import { evaluateMotion, type MotionInput } from "./motion";
import { matrixFor, multiply, focusForSurface, sampleFocus, type Matrix } from "./spatial";
import { lensFor } from "./lens";
import type { EasingInput } from "./easing";

/** SOURCE OF TRUTH: ShotInputSchema, buildShot, framingReport, projectSubject, projectPoints, ASPECT_FRAMES.
 * WHAT: the camera-move vocabulary (push, survey, orbit, crane, rise, dolly zoom, rack focus,
 * scroll-through, macro, float loop, handheld, whip) compiled into plain scene + motion data,
 * plus a pure framing report that projects the subject through the canonical camera math.
 * WHY: templates must be cinematic starting points that never lose the subject, cross the
 * projection plane or miss focus, in every aspect and intensity, before a pixel is rendered.
 * WHERE: core/templates resolves template params into ShotInput; project/templates scaffolds the
 * output as editable recipe JSON; tests and velora templates check certify it with framingReport.
 * The subject is one Surface ("subject") centered on the stage; all values are pixels/degrees.
 */
export const SHOT_KINDS = Object.freeze([
  "push-in", "survey", "orbit", "crane", "rise", "dolly-zoom", "rack-focus",
  "scroll-through", "macro", "float-loop", "handheld-push", "whip",
] as const);
export const ShotKindSchema = z.enum(SHOT_KINDS);
export type ShotKind = z.output<typeof ShotKindSchema>;
export const ASPECT_FRAMES = Object.freeze({
  "16:9": { width: 1920, height: 1080, subject: { width: 1440, height: 900 } },
  "21:9": { width: 2520, height: 1080, subject: { width: 1440, height: 900 } },
  "1:1": { width: 1080, height: 1080, subject: { width: 1200, height: 900 } },
  "4:5": { width: 1080, height: 1350, subject: { width: 1000, height: 1100 } },
  "9:16": { width: 1080, height: 1920, subject: { width: 900, height: 1600 } },
} as const);
export const AspectSchema = z.enum(["16:9", "21:9", "1:1", "4:5", "9:16"]);
export type Aspect = z.output<typeof AspectSchema>;
export const IntensitySchema = z.enum(["subtle", "standard", "dramatic"]);
export type Intensity = z.output<typeof IntensitySchema>;
const RegionSchema = z.strictObject({
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().positive(), height: z.number().finite().positive(),
});
export type Region = z.output<typeof RegionSchema>;
export const ShotInputSchema = z.strictObject({
  kind: ShotKindSchema,
  aspect: AspectSchema.default("16:9"),
  subject: z.strictObject({ width: z.number().finite().min(64).max(7680), height: z.number().finite().min(64).max(7680) }).optional(),
  durationMs: z.number().finite().min(500).max(120_000).optional(),
  intensity: IntensitySchema.default("subtle"),
  lens: z.number().finite().min(16).max(200).optional(),
  // Subject pixels, top-left origin: what the shot frames and keeps in focus.
  focusRegion: RegionSchema.optional(),
  scrollDistance: z.number().finite().min(0).max(20_000).default(2400),
  seed: z.number().int().nonnegative().max(4_294_967_295).default(1),
});
export type ShotInput = z.input<typeof ShotInputSchema>;
export type ShotDefinition = {
  width: number; height: number;
  scene: { camera: z.input<typeof CameraSchema>; focus: z.input<typeof FocusSchema>; nodes: { id: string }[] };
  motion: MotionInput;
};
export const SUBJECT_ID = "subject";
export const SCROLL_CHANNEL = "subject-scroll";

type Camera = { x: number; y: number; z: number; rotateX: number; rotateY: number; rotateZ: number };
const level = { subtle: 1, standard: 1.5, dramatic: 2 } as const;
const defaults: Record<ShotKind, { lens: number; durationMs: number }> = {
  "push-in": { lens: 50, durationMs: 6000 }, survey: { lens: 35, durationMs: 8000 }, orbit: { lens: 50, durationMs: 7000 },
  crane: { lens: 35, durationMs: 7000 }, rise: { lens: 50, durationMs: 5000 }, "dolly-zoom": { lens: 85, durationMs: 5000 },
  "rack-focus": { lens: 85, durationMs: 5000 }, "scroll-through": { lens: 50, durationMs: 9000 }, macro: { lens: 85, durationMs: 6000 },
  "float-loop": { lens: 50, durationMs: 8000 }, "handheld-push": { lens: 50, durationMs: 4000 }, whip: { lens: 50, durationMs: 2500 },
};
function apply(m: Matrix, [x, y, z]: readonly [number, number, number]): [number, number, number] {
  return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
}
// The same camera matrix evaluateScene uses: scene positions minus camera, after stage rotation.
function cameraMatrix(c: Camera): Matrix {
  return matrixFor(TransformSchema.parse({ x: -c.x, y: -c.y, z: -c.z, rotateX: c.rotateX, rotateY: c.rotateY, rotateZ: c.rotateZ }));
}
const rotation = (c: Pick<Camera, "rotateX" | "rotateY" | "rotateZ">) => cameraMatrix({ x: 0, y: 0, z: 0, ...c });
// Camera distance that makes the subject's limiting side fill `fill` of the frame (at the stage center plane).
function distanceFor(fill: number, perspective: number, frame: { width: number; height: number }, subject: { width: number; height: number }): number {
  const scale = fill / Math.max(subject.width / frame.width, subject.height / frame.height);
  return perspective * (1 / scale - 1);
}
// Camera-axis depth of a subject point (subject-center coordinates) for a camera pose.
function depthAt(c: Camera, perspective: number, point: readonly [number, number]): number {
  return perspective - apply(cameraMatrix(c), [point[0], point[1], 0])[2];
}
const regionCenter = (region: Region, subject: { width: number; height: number }): [number, number] =>
  [region.x + region.width / 2 - subject.width / 2, region.y + region.height / 2 - subject.height / 2];
type Key = { timeMs: number; value: number; easing?: EasingInput };
const smooth = (target: object, property: string, keys: Key[], ease: EasingInput = "cinematic") =>
  ({ target, property, keyframes: keys, interpolation: "smooth" as const, ...(keys.length > 1 ? { ease } : {}) });
const camera = { kind: "camera" as const };
const focus = { kind: "focus" as const };
const round = (value: number) => Math.round(value * 100) / 100;

/** Compile one camera move into a scene + motion definition (speed 1: authored time is playback time). */
export function buildShot(input: ShotInput): ShotDefinition {
  const shot = ShotInputSchema.parse(input);
  const frame = ASPECT_FRAMES[shot.aspect];
  const subject = shot.subject ?? frame.subject;
  const a = level[shot.intensity];
  const durationMs = shot.durationMs ?? defaults[shot.kind].durationMs;
  const lens = lensFor(shot.lens ?? defaults[shot.kind].lens, frame.height);
  const p = lens.perspective;
  const end = durationMs;
  const fit = (fill: number) => round(distanceFor(fill, p, frame, subject));
  const region = shot.focusRegion ?? { x: subject.width / 3, y: subject.height / 3, width: subject.width / 3, height: subject.height / 3 };
  const target = regionCenter(region, subject);
  let pose: Camera = { x: 0, y: 0, z: fit(0.78), rotateX: 10, rotateY: -16, rotateZ: 0 };
  const tracks: unknown[] = [];
  let fStop = 4, maxBlur = 8, loop = false;
  // Shallow-focus shots use a long-lens aperture so the pull reads on screen (depth of field
  // scales with focus focal length; the field of view still follows the chosen lens).
  let focalLength = lens.focus.focalLength;
  // Focus follows the framed point's depth along the move; holding it fixed would blur the payoff.
  const focusTrack = (poses: [number, Camera][], point: readonly [number, number] = target) =>
    smooth(focus, "distance", poses.map(([timeMs, c]) => ({ timeMs, value: round(depthAt(c, p, point)) })));
  const cameraTracks = (from: Camera, to: Camera, ease: EasingInput = "cinematic") => {
    for (const key of ["x", "y", "z", "rotateX", "rotateY", "rotateZ"] as const)
      if (from[key] !== to[key] || from[key] !== 0) tracks.push(smooth(camera, key, [{ timeMs: 0, value: from[key] }, { timeMs: end, value: to[key] }], ease));
  };
  switch (shot.kind) {
    case "push-in":
    case "handheld-push": {
      const handheld = shot.kind === "handheld-push";
      const angle = { rotateX: 6 + 4 * a, rotateY: -(10 + 6 * a), rotateZ: 0 };
      const from: Camera = { x: 0, y: 0, z: fit(0.66 - 0.06 * a), ...angle };
      const to: Camera = { x: 0, y: 0, z: fit(0.84), ...angle };
      pose = from;
      tracks.push(smooth(camera, "z", [{ timeMs: 0, value: from.z }, { timeMs: end, value: to.z }]));
      tracks.push(focusTrack([[0, from], [end, to]]));
      if (handheld)
        for (const [key, amplitude] of [["x", 5 * a], ["y", 4 * a], ["rotateZ", 0.35 * a]] as const)
          tracks.push({ target: camera, property: key, keyframes: [{ timeMs: 0, value: 0 }], noise: { amplitude: round(amplitude), frequency: 0.6, octaves: 2, seed: shot.seed + key.length } });
      fStop = 4 - 0.6 * (a - 1);
      break;
    }
    case "survey": {
      // Travel along the tilted page itself: camera moves along the rotated page x-axis.
      const angle = { rotateX: 12 + 4 * a, rotateY: -(24 + 6 * a), rotateZ: 0 };
      const axis = apply(rotation(angle), [1, 0, 0]);
      const travel = 0.16 * a * subject.width;
      const base = { x: 0, y: 0, z: fit(1.1 + 0.1 * a) };
      const at = (offset: number): Camera => ({ x: round(base.x + axis[0] * offset), y: round(base.y + axis[1] * offset), z: round(base.z + axis[2] * offset), ...angle });
      const from = at(-travel), to = at(travel);
      pose = from;
      for (const key of ["x", "y", "z"] as const) tracks.push(smooth(camera, key, [{ timeMs: 0, value: from[key] }, { timeMs: end, value: to[key] }]));
      tracks.push(focusTrack([[0, from], [end / 2, at(0)], [end, to]], [0, 0]));
      fStop = 2.8; maxBlur = 10;
      break;
    }
    case "orbit": {
      const arc = 15 * (a + 1);
      const from: Camera = { x: 0, y: 0, z: fit(0.74), rotateX: 10, rotateY: -14 + arc, rotateZ: 0 };
      const to: Camera = { ...from, rotateY: -14 };
      pose = from;
      tracks.push(smooth(camera, "rotateY", [{ timeMs: 0, value: from.rotateY }, { timeMs: end, value: to.rotateY }]));
      tracks.push(focusTrack([[0, from], [end / 2, { ...from, rotateY: (from.rotateY + to.rotateY) / 2 }], [end, to]], [0, 0]));
      fStop = 5.6;
      break;
    }
    case "crane": {
      const from: Camera = { x: 0, y: round(-0.12 * a * frame.height), z: fit(0.62), rotateX: Math.min(62, 40 + 8 * a), rotateY: -8, rotateZ: 0 };
      const to: Camera = { x: 0, y: 0, z: fit(0.78), rotateX: 12, rotateY: -8, rotateZ: 0 };
      pose = from;
      cameraTracks(from, to);
      tracks.push(focusTrack([[0, from], [end / 2, { ...from, rotateX: (from.rotateX + to.rotateX) / 2, y: from.y / 2, z: (from.z + to.z) / 2 }], [end, to]], [0, 0]));
      fStop = 5.6;
      break;
    }
    case "rise": {
      const from: Camera = { x: 0, y: 0, z: fit(0.78), rotateX: Math.min(80, 64 + 8 * a), rotateY: 0, rotateZ: 0 };
      const to: Camera = { ...from, rotateX: a >= 2 ? 4 : 8 };
      pose = from;
      tracks.push(smooth(camera, "rotateX", [{ timeMs: 0, value: from.rotateX }, { timeMs: end, value: to.rotateX }], "expo.out"));
      fStop = 5.6;
      break;
    }
    case "dolly-zoom": {
      // The subject stays on the projection plane (camera z = 0) so it holds its size while the
      // lens widens and everything off that plane stretches: the classic dolly zoom.
      const wide = lensFor(Math.max(24, 85 - 25 * a), frame.height).perspective;
      pose = { x: 0, y: 0, z: 0, rotateX: 18, rotateY: -18, rotateZ: 0 };
      tracks.push(smooth(camera, "perspective", [{ timeMs: 0, value: round(p) }, { timeMs: end, value: round(wide) }]));
      tracks.push(smooth(focus, "distance", [{ timeMs: 0, value: round(p) }, { timeMs: end, value: round(wide) }]));
      fStop = 5.6;
      break;
    }
    case "rack-focus": {
      pose = { x: 0, y: 0, z: fit(0.8), rotateX: 36, rotateY: -10, rotateZ: 0 };
      // Pull from the near (lower) edge to the far edge, or to the framed region when one is given.
      // Positive rotateX brings the bottom of the page toward the camera.
      const near: [number, number] = [0, subject.height * 0.35];
      const far: [number, number] = shot.focusRegion ? target : [0, -subject.height * 0.3];
      const hold = Math.min(600, end / 5);
      const a0 = round(depthAt(pose, p, near)), b0 = round(depthAt(pose, p, far));
      tracks.push({ target: focus, property: "distance", keyframes: [
        { timeMs: 0, value: a0 }, { timeMs: hold, value: a0, easing: "cinematic" }, { timeMs: end - hold, value: b0 }, { timeMs: end, value: b0 },
      ] });
      fStop = round(1.8 / Math.sqrt(a)); maxBlur = 12; focalLength = 220;
      break;
    }
    case "scroll-through": {
      const angle = { rotateX: 12, rotateY: -16, rotateZ: 0 };
      const from: Camera = { x: round(-0.03 * a * subject.width), y: 0, z: fit(0.8), ...angle };
      const to: Camera = { ...from, x: -from.x };
      pose = from;
      tracks.push(smooth(camera, "x", [{ timeMs: 0, value: from.x }, { timeMs: end, value: to.x }]));
      tracks.push({ target: { kind: "channel", id: SCROLL_CHANNEL }, property: "value", interpolation: "smooth", ease: "cubic.inOut",
        keyframes: [{ timeMs: 0, value: 0 }, { timeMs: end, value: shot.scrollDistance }] });
      tracks.push(focusTrack([[0, from], [end, to]], [0, 0]));
      fStop = 4;
      break;
    }
    case "macro": {
      const angle = { rotateX: 8, rotateY: -12, rotateZ: 0 };
      const regionFill = (0.55 + 0.1 * a) / Math.max(region.width / frame.width, region.height / frame.height);
      // Center the region: the camera sits on the region's rotated world position.
      const world = apply(rotation(angle), [target[0], target[1], 0]);
      const close = p * (1 / regionFill - 1);
      const from: Camera = { x: round(world[0]), y: round(world[1]), z: round(world[2] + close), ...angle };
      const to: Camera = { x: 0, y: 0, z: fit(0.8), ...angle };
      pose = from;
      for (const key of ["x", "y", "z"] as const) tracks.push(smooth(camera, key, [{ timeMs: 0, value: from[key] }, { timeMs: end, value: to[key] }]));
      tracks.push(focusTrack([[0, from], [end, to]]));
      fStop = 2; maxBlur = 10; focalLength = 180;
      break;
    }
    case "float-loop": {
      // Sine-eased segments reach zero velocity at every extreme, so the seam is invisible.
      const swing = round(4 * a), bob = round(8 * a);
      pose = { x: 0, y: 0, z: fit(0.76), rotateX: 8, rotateY: -12, rotateZ: 0 };
      const q = end / 4;
      tracks.push({ target: camera, property: "rotateY", keyframes: [
        { timeMs: 0, value: -12 - swing, easing: "sine.inOut" }, { timeMs: 2 * q, value: -12 + swing, easing: "sine.inOut" }, { timeMs: end, value: -12 - swing },
      ] });
      tracks.push({ target: camera, property: "y", keyframes: [
        { timeMs: 0, value: 0, easing: "sine.inOut" }, { timeMs: q, value: -bob, easing: "sine.inOut" }, { timeMs: 2 * q, value: 0, easing: "sine.inOut" },
        { timeMs: 3 * q, value: bob, easing: "sine.inOut" }, { timeMs: end, value: 0 },
      ] });
      fStop = 5.6; loop = true;
      break;
    }
    case "whip": {
      const settle = Math.min(450, end / 3);
      pose = { x: round(-(1.2 + 0.2 * a) * frame.width), y: 0, z: fit(0.76), rotateX: 8, rotateY: -10, rotateZ: 0 };
      tracks.push({ target: camera, property: "x", keyframes: [{ timeMs: 0, value: pose.x, easing: "expo.out" }, { timeMs: settle, value: 0 }] });
      fStop = 5.6;
      break;
    }
  }
  const settled: Camera = { ...pose, x: shot.kind === "whip" ? 0 : pose.x };
  return {
    width: frame.width, height: frame.height,
    scene: {
      camera: { perspective: round(p), x: settled.x, y: settled.y, z: settled.z, rotateX: settled.rotateX, rotateY: settled.rotateY, rotateZ: settled.rotateZ },
      focus: { distance: round(Math.max(lens.focus.focalLength + 1, depthAt(settled, p, shot.kind === "macro" || shot.kind === "push-in" || shot.kind === "handheld-push" || shot.kind === "rack-focus" ? target : [0, 0]))), fStop: round(fStop), focalLength, maxBlur },
      nodes: [{ id: SUBJECT_ID }],
    },
    motion: { durationMs, speed: 1, ...(loop ? { loop: true } : {}), tracks: tracks as MotionInput["tracks"] },
  };
}

export type FramingSample = { timeMs: number; subjectVisible: number; regionVisible: number; regionBlur: number; depthMargin: number };
export type FramingReport = { samples: FramingSample[]; minSubjectVisible: number; minDepthMargin: number; worstRegionBlur: number };
/** Project a grid over the subject (and its focus region) at sampled times: visible fraction inside
 * the frame, camera-plane margin (fraction of perspective) and depth-of-field blur at the region. */
export function framingReport(definition: ShotDefinition, subject: { width: number; height: number }, options: { samples?: number; focusRegion?: Region; times?: number[] } = {}): FramingReport {
  const motion = definition.motion;
  const duration = motion.durationMs / (motion.speed ?? 0.5);
  const times = options.times ?? Array.from({ length: options.samples ?? 24 }, (_, i) => (duration * i) / ((options.samples ?? 24) - 1));
  const region = options.focusRegion ?? { x: subject.width / 3, y: subject.height / 3, width: subject.width / 3, height: subject.height / 3 };
  const grid = (x0: number, y0: number, w: number, h: number, n: number) =>
    Array.from({ length: n * n }, (_, i) => [x0 + (w * (i % n + 0.5)) / n - subject.width / 2, y0 + (h * (Math.floor(i / n) + 0.5)) / n - subject.height / 2] as const);
  const subjectGrid = grid(0, 0, subject.width, subject.height, 9), regionGrid = grid(region.x, region.y, region.width, region.height, 5);
  const samples = times.map(timeMs => {
    const state = evaluateMotion(motion, timeMs);
    const c = CameraSchema.parse({ ...definition.scene.camera, ...state.camera });
    const f = FocusSchema.parse({ ...definition.scene.focus, ...state.focus });
    const m = cameraMatrix(c);
    const project = ([x, y]: readonly [number, number]) => {
      const [wx, wy, wz] = apply(m, [x, y, 0]);
      const k = c.perspective / (c.perspective - wz);
      return { inside: wz < c.perspective && Math.abs(wx * k) <= definition.width / 2 && Math.abs(wy * k) <= definition.height / 2, margin: (c.perspective - wz) / c.perspective };
    };
    const visible = (points: readonly (readonly [number, number])[]) => points.filter(point => project(point).inside).length / points.length;
    const field = focusForSurface(m, f, c.perspective);
    const center = regionCenter(region, subject);
    return {
      timeMs,
      subjectVisible: visible(subjectGrid),
      regionVisible: visible(regionGrid),
      regionBlur: sampleFocus(field, center[0], center[1]),
      depthMargin: Math.min(...subjectGrid.map(point => project(point).margin)),
    };
  });
  return {
    samples,
    minSubjectVisible: Math.min(...samples.map(s => s.subjectVisible)),
    minDepthMargin: Math.min(...samples.map(s => s.depthMargin)),
    worstRegionBlur: Math.max(...samples.map(s => s.regionBlur)),
  };
}
/** Screen-space positions (frame pixels, top-left origin) of stage points (center origin, z toward the
 * camera) at one time through the canonical camera. Points behind the camera are null. */
export function projectPoints(definition: Pick<ShotDefinition, "width" | "height" | "scene" | "motion">, points: readonly (readonly [number, number, number])[], timeMs: number): ({ x: number; y: number } | null)[] {
  const state = evaluateMotion(definition.motion, timeMs);
  const c = CameraSchema.parse({ ...definition.scene.camera, ...state.camera });
  const m = cameraMatrix(c);
  return points.map(point => {
    const [x, y, z] = apply(m, point);
    if (z >= c.perspective) return null;
    const k = c.perspective / (c.perspective - z);
    return { x: definition.width / 2 + x * k, y: definition.height / 2 + y * k };
  });
}
/** Screen-space corners of the centered subject plane at one time: the studio's schematic storyboards
 * draw these without a live render. */
export function projectSubject(definition: ShotDefinition, subject: { width: number; height: number }, timeMs: number): ({ x: number; y: number } | null)[] {
  const w = subject.width / 2, h = subject.height / 2;
  return projectPoints(definition, [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]], timeMs);
}
