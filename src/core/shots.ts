import { z } from "zod";
import { CameraSchema, FocusSchema, SceneConstraintSchema, ConstraintTargetSchema, TransformSchema, PERSPECTIVE_MAX, type SceneConstraint } from "./scene";
import { evaluateMotion, withAdditive, withCameraAdditive, type MotionInput, type MotionClipInput, type MotionState } from "./motion";
import { applyPoint, evaluateScene, matrixFor, multiply, focusForSurface, sampleFocus, cameraMatrix as stageCamera, resolveConstraints, projectWorld, type Matrix } from "./spatial";
import { EasingSchema } from "./easing";
import { framingDistance, lensFor, lensPreset, perspectiveForFocalLength } from "./lens";
import type { EasingInput } from "./easing";
import type { PreviewDefinitionInput } from "./preview";
import { ElementTargetSchema, isElementTarget, matchesDepthLayer, parseElementTarget, type ElementTarget } from "./targets";

/** SOURCE OF TRUTH: ShotInputSchema, buildShot, framingReport, projectSubject, projectPoints, ASPECT_FRAMES, buildOrbitRig, buildRackFocus.
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
  focusTarget: ElementTargetSchema.optional(),
  scrollDistance: z.number().finite().min(0).max(20_000).default(2400),
  seed: z.number().int().nonnegative().max(4_294_967_295).default(1),
}).refine(shot => !(shot.focusRegion && shot.focusTarget), { path: ["focusTarget"], message: "Choose a focus target or a focus region." });
export type ShotInput = z.input<typeof ShotInputSchema>;
export type ShotDefinition = {
  width: number; height: number;
  scene: { camera: z.input<typeof CameraSchema>; focus: z.input<typeof FocusSchema>; nodes: { id: string }[]; constraints?: z.input<typeof SceneConstraintSchema>[] };
  motion: MotionInput;
  focusTarget?: ElementTarget;
};
export function lockShotFocus<T extends ShotDefinition>(definition: T, target: ElementTarget): T {
  const motion = { ...definition.motion, tracks: definition.motion.tracks.filter(track => track.target.kind !== "focus" || track.property !== "distance") };
  const constraints = [...(definition.scene.constraints ?? []), { kind: "lookAt" as const, target }, { kind: "focusFollow" as const, target }];
  return { ...definition, focusTarget: target, motion, scene: { ...definition.scene, constraints } };
}
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
// The spatial owner's camera matrix (one definition for evaluateScene, shots and rigs).
const cameraMatrix = (c: Camera): Matrix => stageCamera(c);
/** Camera and focus at one time: tracks, add-clip offsets, then constraints. The subject Surface is
 * centered on the stage with the given size; point targets need no measurement. */
function resolvedLens(definition: Pick<ShotDefinition, "scene" | "motion">, state: MotionState, subject?: { width: number; height: number }) {
  const camera = CameraSchema.parse(withCameraAdditive({ ...definition.scene.camera, ...state.camera }, state.additive?.camera));
  const focus = FocusSchema.parse(withAdditive({ ...definition.scene.focus, ...state.focus }, state.additive?.focus, FocusSchema.parse({})));
  const constraints = definition.scene.constraints?.map(constraint => SceneConstraintSchema.parse(constraint));
  return resolveConstraints(constraints, camera, focus, target => {
    if ("point" in target) return [...target.point] as [number, number, number];
    if (isElementTarget(target) || !("surface" in target) || target.surface !== SUBJECT_ID) return undefined;
    const [u, v] = target.anchor ?? [0.5, 0.5];
    return [(u - 0.5) * (subject?.width ?? 0), (v - 0.5) * (subject?.height ?? 0), 0];
  }, { channels: state.channels });
}
const rotation = (c: Pick<Camera, "rotateX" | "rotateY" | "rotateZ">) => cameraMatrix({ x: 0, y: 0, z: 0, ...c });
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

const rackUnit = z.number().min(0).max(1);
const transformFields = TransformSchema.parse({});
export const RackTargetSchema = z.union([
  ElementTargetSchema,
  z.strictObject({ depth: z.number().finite().positive() }),
  z.strictObject({ surface: z.string().min(1).max(128), anchor: z.tuple([rackUnit, rackUnit]) }),
  z.strictObject({ layer: z.string().min(1).max(4096), surface: z.string().min(1).max(128).optional() }),
]);
export type RackTarget = z.output<typeof RackTargetSchema>;
export const RackFocusSchema = z.strictObject({
  from: RackTargetSchema, to: RackTargetSchema, atMs: z.number().nonnegative().max(120_000), durationMs: z.number().positive().max(120_000),
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,48}$/).optional(), ease: EasingSchema.optional(), hold: z.number().nonnegative().max(120_000).optional(),
  breathing: z.strictObject({ amount: z.number().min(0).max(0.03), direction: z.enum(["in", "out"]) }).optional(),
  fStopDip: z.strictObject({ from: FocusSchema.shape.fStop.removeDefault(), to: FocusSchema.shape.fStop.removeDefault() }).optional(),
  depths: z.strictObject({ from: z.number().positive(), to: z.number().positive() }).optional(),
});
export type RackFocusInput = z.input<typeof RackFocusSchema>;

export function rackTargetFromText(text: string) {
  const shorthand = /^([^@]+)@([^,]+),([^,]+)$/.exec(text);
  const target = text.startsWith("depth:") ? { depth: Number(text.slice(6)) }
    : text.startsWith("layer:") ? { layer: text.slice(6) }
    : parseElementTarget(text) ?? (shorthand ? { surface: shorthand[1], anchor: [Number(shorthand[2]), Number(shorthand[3])] } : undefined);
  const parsed = RackTargetSchema.safeParse(target);
  return parsed.success ? parsed.data : undefined;
}

export function rackLayerDepth(target: RackTarget, entries: readonly import("./depth").DepthEvidence[]) {
  if (!("layer" in target)) return undefined;
  const samples = entries.flatMap(entry => target.surface && target.surface !== entry.surface ? [] : entry.layers.flatMap(({ match }, index) => {
    return matchesDepthLayer(match, target.layer) && entry.focus?.[index] ? [entry.focus[index].depth] : [];
  }));
  return samples.length === 1 ? samples[0] : undefined;
}

export function rackSurfaceDepth(definition: PreviewDefinitionInput, target: RackTarget, timeMs: number) {
  if ("depth" in target) return target.depth;
  if (isElementTarget(target) || !("anchor" in target)) return undefined;
  const state = evaluateMotion(definition.motion ?? { durationMs: 0, tracks: [] }, timeMs);
  const frame = { width: definition.width ?? 1400, height: definition.height ?? 980 };
  const stage = definition.stage ?? frame;
  const fit = Math.min(frame.width / stage.width, frame.height / stage.height);
  const size = { width: stage.width * fit, height: stage.height * fit };
  const evaluation = evaluateScene({ ...definition.scene,
    camera: withCameraAdditive({ ...definition.scene.camera, ...state.camera }, state.additive?.camera),
    focus: withAdditive({ ...definition.scene.focus, ...state.focus }, state.additive?.focus, FocusSchema.parse({})),
    nodes: definition.scene.nodes.map(node => ({ ...node, transform: withAdditive({ ...node.transform,
      ...Object.fromEntries(Object.entries(state.surfaces[node.id] ?? {}).filter(([key]) => key === "position" || key in transformFields)),
    }, Object.fromEntries(Object.entries(state.additive?.surfaces?.[node.id] ?? {}).filter(([key]) => key === "position" || key in transformFields)), transformFields) })),
  }, Object.fromEntries(definition.scene.nodes.map(node => [node.id, size])), { channels: state.channels });
  const node = evaluation.nodes.find(node => node.id === target.surface);
  return node && evaluation.camera ? evaluation.camera.perspective - applyPoint(node.world, [size.width * (target.anchor[0] - 0.5), size.height * (target.anchor[1] - 0.5), 0])[2] : undefined;
}

/** One physical pull and its additive breathing child share the same local clock. */
export function buildRackFocus(input: RackFocusInput, resolve?: (target: RackTarget, timeMs: number) => number | undefined): MotionClipInput {
  const params = RackFocusSchema.parse(input);
  const { atMs, durationMs, ease = "cinematic", breathing, fStopDip, hold = 0 } = params;
  const id = params.id ?? `rack-${String(atMs).replace(".", "-")}`;
  const keys = (start: number, end: number) => [{ timeMs: 0, value: start, easing: ease }, { timeMs: durationMs, value: end, easing: ease },
    ...(hold ? [{ timeMs: durationMs + hold, value: end, easing: ease }] : [])];
  if (isElementTarget(params.from) || isElementTarget(params.to)) {
    const { depths: _, ...authored } = params;
    return { id, label: "Live rack focus", startMs: atMs, durationMs: durationMs + hold,
      tracks: [{ target: { kind: "channel", id: rackProgressChannel(id) }, property: "value", keyframes: keys(0, 1) }],
      source: { rack: "element", version: 1, params: authored } };
  }
  const targetDepth = (key: "from" | "to", timeMs: number) => {
    const target = params[key];
    return "depth" in target ? target.depth : params.depths?.[key] ?? resolve?.(target, timeMs);
  };
  const from = targetDepth("from", atMs), to = targetDepth("to", atMs + durationMs);
  if (from === undefined || to === undefined || !Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0)
    throw new RangeError("Rack targets must resolve to positive camera-axis depths.");
  const tracks: NonNullable<MotionClipInput["tracks"]> = [{ target: focus, property: "distance", keyframes: keys(from, to) }];
  if (fStopDip) tracks.push({ target: focus, property: "fStop", keyframes: [
    { timeMs: 0, value: fStopDip.from, easing: ease }, { timeMs: durationMs / 2, value: fStopDip.to, easing: ease },
    { timeMs: durationMs, value: fStopDip.from, easing: ease },
  ] });
  const amount = breathing ? breathing.amount * (breathing.direction === "in" ? 1 : -1) * Math.sign(from - to) : 0;
  return { id, label: "Rack focus", startMs: atMs, durationMs: durationMs + hold, tracks,
    ...(amount ? { clips: [{ id: `${id}-breathing`, label: "Lens breathing", startMs: 0, mode: "add", tracks: [{ target: camera, property: "zoom", keyframes: keys(0, amount) }] }] } : {}),
    source: { rack: "focus", version: 1, params: { ...params, depths: { from, to } } } };
}

const rackProgressChannel = (id: string) => `velora-rack:${id}`;
export function liveRacks(motion: MotionInput | undefined) {
  return (motion?.clips ?? []).flatMap(clip => {
    if (!clip.source || !("rack" in clip.source) || clip.source.rack !== "element") return [];
    const params = RackFocusSchema.safeParse(clip.source.params);
    return params.success ? [{ ...params.data, startMs: clip.startMs, channel: rackProgressChannel(clip.id) }] : [];
  }).sort((a, b) => a.startMs - b.startMs);
}
export type LiveRack = ReturnType<typeof liveRacks>[number] & { progress: number };

export function rackReport(clip: MotionClipInput, lens: z.input<typeof FocusSchema>, authoredZoom = 1) {
  const params = RackFocusSchema.parse(clip.source && "rack" in clip.source ? clip.source.params : undefined);
  if (!params.depths) throw new Error("Use live capture to inspect an element rack.");
  const { from, to } = params.depths;
  const motion = { durationMs: clip.startMs + clip.durationMs!, speed: 1, tracks: [], clips: [clip] };
  const endpoint = (timeMs: number, fixed: number, other: number) => {
    const state = evaluateMotion(motion, timeMs);
    const optics = FocusSchema.parse({ ...lens, ...state.focus });
    const zoom = withCameraAdditive({ zoom: authoredZoom }, state.additive?.camera).zoom;
    const blur = (depth: number) => sampleFocus({ ...optics, depth, depthX: 0, depthY: 0, scale: 1, perspective: 0 }, 0, 0) * zoom;
    return { sharpBlur: blur(fixed), otherBlur: blur(other), zoom };
  };
  const start = endpoint(params.atMs, from, to), end = endpoint(params.atMs + params.durationMs, to, from);
  const breathing = Math.abs(end.zoom - start.zoom);
  return { start, end, breathing, pass: start.sharpBlur < 0.5 && end.sharpBlur < 0.5 && Math.abs(breathing - (from === to ? 0 : params.breathing?.amount ?? 0)) <= 0.001 };
}

/** Compile one camera move into a scene + motion definition (speed 1: authored time is playback time). */
export function buildShot(input: ShotInput, { stageFit = false }: { stageFit?: boolean } = {}): ShotDefinition {
  const shot = ShotInputSchema.parse(input);
  const frame = ASPECT_FRAMES[shot.aspect];
  const subject = shot.subject ?? frame.subject;
  const a = level[shot.intensity];
  const durationMs = shot.durationMs ?? defaults[shot.kind].durationMs;
  const mm = shot.lens ?? defaults[shot.kind].lens;
  const perspective = perspectiveForFocalLength(mm, frame.height);
  const lens = perspective > 10_000 ? { perspective, focus: { focalLength: lensPreset("200mm-telephoto", { frameHeight: frame.height }).focus.focalLength * mm / 200 } }
    : lensFor(mm, frame.height);
  const p = lens.perspective;
  const end = durationMs;
  const fit = (fill: number) => round(framingDistance(p, frame, subject, fill));
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
      const fill = 1.1 + 0.1 * a;
      // A shallower stage fits the same viewport at a closer distance. Keep the rail
      // at least as far back as the original framing so the oblique near edge stays clear.
      const base = { x: 0, y: 0, z: stageFit ? Math.max(fit(fill), round(framingDistance(p, frame, frame.subject, fill))) : fit(fill) };
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
  const definition: ShotDefinition = {
    width: frame.width, height: frame.height,
    scene: {
      camera: { perspective: round(p), x: settled.x, y: settled.y, z: settled.z, rotateX: settled.rotateX, rotateY: settled.rotateY, rotateZ: settled.rotateZ },
      focus: { distance: round(Math.max(lens.focus.focalLength + 1, depthAt(settled, p, shot.kind === "macro" || shot.kind === "push-in" || shot.kind === "handheld-push" || shot.kind === "rack-focus" ? target : [0, 0]))), fStop: round(fStop), focalLength, maxBlur },
      nodes: [{ id: SUBJECT_ID }],
    },
    motion: { durationMs, speed: 1, ...(loop ? { loop: true } : {}), tracks: tracks as MotionInput["tracks"] },
  };
  return shot.focusTarget ? lockShotFocus(definition, shot.focusTarget) : definition;
}

export type FramingSample = { timeMs: number; subjectVisible: number; regionVisible: number; regionBlur: number; depthMargin: number };
export type FramingReport = { samples: FramingSample[]; minSubjectVisible: number; minDepthMargin: number; worstRegionBlur: number };
/** Project a grid over the subject (and its focus region) at sampled times: visible fraction inside
 * the frame, camera-plane margin (fraction of perspective) and depth-of-field blur at the region. */
export function framingReport(definition: ShotDefinition, subject: { width: number; height: number }, options: {
  samples?: number; focusRegion?: Region; times?: number[];
  poseAt?: (timeMs: number) => { world: Matrix; perspective: number; zoom?: number; focus: z.output<typeof FocusSchema> };
} = {}): FramingReport {
  const motion = definition.motion;
  const duration = motion.durationMs / (motion.speed ?? 0.5);
  const times = options.times ?? Array.from({ length: options.samples ?? 24 }, (_, i) => (duration * i) / ((options.samples ?? 24) - 1));
  const region = options.focusRegion ?? { x: subject.width / 3, y: subject.height / 3, width: subject.width / 3, height: subject.height / 3 };
  const grid = (x0: number, y0: number, w: number, h: number, n: number) =>
    Array.from({ length: n * n }, (_, i) => [x0 + (w * (i % n + 0.5)) / n - subject.width / 2, y0 + (h * (Math.floor(i / n) + 0.5)) / n - subject.height / 2] as const);
  const subjectGrid = grid(0, 0, subject.width, subject.height, 9), regionGrid = grid(region.x, region.y, region.width, region.height, 5);
  const samples = times.map(timeMs => {
    const pose = options.poseAt?.(timeMs);
    const { camera: c, focus: f } = pose ? { camera: pose, focus: pose.focus } : resolvedLens(definition, evaluateMotion(motion, timeMs), subject);
    const m = pose ? pose.world : cameraMatrix(c as z.output<typeof CameraSchema>);
    const project = ([x, y]: readonly [number, number]) => {
      const [wx, wy, wz] = apply(m, [x, y, 0]);
      const k = c.perspective / (c.perspective - wz) * (c.zoom ?? 1);
      return { inside: wz < c.perspective && Math.abs(wx * k) <= definition.width / 2 && Math.abs(wy * k) <= definition.height / 2, margin: (c.perspective - wz) / c.perspective };
    };
    const visible = (points: readonly (readonly [number, number])[]) => points.filter(point => project(point).inside).length / points.length;
    const field = focusForSurface(m, f, c.perspective);
    const center = regionCenter(region, subject);
    return {
      timeMs,
      subjectVisible: visible(subjectGrid),
      regionVisible: visible(regionGrid),
      regionBlur: sampleFocus(field, center[0], center[1]) * (c.zoom ?? 1),
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
  const c = resolvedLens(definition, state).camera;
  return points.map(point => {
    const projected = projectWorld(c, definition, point);
    return projected && { x: projected.x, y: projected.y };
  });
}
/** Screen-space corners of the centered subject plane at one time: the studio's schematic storyboards
 * draw these without a live render. */
export function projectSubject(definition: ShotDefinition, subject: { width: number; height: number }, timeMs: number): ({ x: number; y: number } | null)[] {
  const w = subject.width / 2, h = subject.height / 2;
  return projectPoints(definition, [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]], timeMs);
}

/** Orbit rig input: the camera circles `center` at `radius` (stage px) from fromDeg to toDeg while a
 * lookAt constraint keeps `target` at frame center. `height` raises the camera above the orbit plane. */
export const OrbitRigSchema = z.strictObject({
  target: ConstraintTargetSchema.default({ surface: SUBJECT_ID }),
  center: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).default([0, 0, 0]),
  radius: z.number().finite().positive().max(20_000),
  fromDeg: z.number().finite().min(-720).max(720),
  toDeg: z.number().finite().min(-720).max(720),
  height: z.number().finite().min(-20_000).max(20_000).default(0),
  perspective: z.number().finite().min(100).max(PERSPECTIVE_MAX).default(1400),
  startMs: z.number().finite().nonnegative().default(0),
  durationMs: z.number().finite().positive().max(120_000),
  ease: EasingSchema.default("cinematic"),
  stepDeg: z.number().finite().min(1).max(45).default(10),
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/).default("orbit"),
});
export type OrbitRigInput = z.input<typeof OrbitRigSchema>;
/** Sugar that compiles to data: one clip (a constant-speed camera position path, eased as a group,
 * plus matching rotation hints) and a lookAt constraint. Add both to a recipe. */
export function buildOrbitRig(input: OrbitRigInput): { clip: MotionClipInput; constraint: SceneConstraint } {
  const rig = OrbitRigSchema.parse(input);
  const sweep = rig.toDeg - rig.fromDeg;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / rig.stepDeg));
  const distance = Math.hypot(rig.radius, rig.height);
  const pitch = (Math.atan2(rig.height, rig.radius) * 180) / Math.PI;
  const keys = Array.from({ length: steps + 1 }, (_, k) => {
    const yaw = rig.fromDeg + (sweep * k) / steps;
    // The camera that sees `center` head-on at this yaw/pitch from `distance`: c = R(center) - (0, 0, P - D).
    const [x, y, z] = apply(rotation({ rotateX: pitch, rotateY: yaw, rotateZ: 0 }), rig.center);
    return { timeMs: round((rig.durationMs * k) / steps), yaw, value: [round(x), round(y), round(z - (rig.perspective - distance))] as [number, number, number] };
  });
  const tracks = [
    { target: camera, property: "position" as const, rove: true, keyframes: keys.map(({ timeMs, value }) => ({ timeMs, value, easing: "linear" as const })) },
    // Authored rotation hints near the solution, so lookAt picks the same branch at every yaw.
    { target: camera, property: "rotateY" as const, keyframes: keys.map(({ timeMs, yaw }) => ({ timeMs, value: round(yaw), easing: "linear" as const })) },
    { target: camera, property: "rotateX" as const, keyframes: [{ timeMs: 0, value: round(pitch) }] },
  ];
  return {
    clip: { id: rig.id, label: "Orbit rig", startMs: rig.startMs, ease: rig.ease, tracks, source: { behavior: "orbit-rig", version: 1, params: { radius: rig.radius, fromDeg: rig.fromDeg, toDeg: rig.toDeg, height: rig.height } } },
    constraint: { kind: "lookAt", subject: "camera", target: rig.target },
  };
}

/** Camera-move library (07.5): one `SHOT_KINDS` move applied to a layer of an existing scene. buildShot
 * designs the move for a subject at the stage origin in a standard aspect frame; this scales it to the
 * scene frame, moves it to the layer's stage center (camera x/y/z += R(t)·P per key, so the view of the
 * layer is the designed one) and returns a camera clip with `source: {shot, version, params}`, together
 * with the framing report of the designed move and a certification verdict with "Adjust" suggestions. */
export type ShotVerdict = { ok: boolean; inFrame: number; depthMargin: number; focusBlur: number; suggestions: string[] };
export const SHOT_CERTIFICATION = Object.freeze({ minSubjectVisible: 0.85, minDepthMargin: 0.15, maxRegionBlur: 2 });
export function shotVerdict(report: FramingReport, input: { lens?: number; intensity?: string }): ShotVerdict {
  const suggestions: string[] = [];
  const inFrame = report.minSubjectVisible, depthMargin = report.minDepthMargin, focusBlur = report.worstRegionBlur;
  if (inFrame < SHOT_CERTIFICATION.minSubjectVisible) suggestions.push(input.intensity && input.intensity !== "subtle" ? "Lower the intensity to subtle." : "Use a wider lens (35 mm) so the subject stays in frame.");
  if (depthMargin < SHOT_CERTIFICATION.minDepthMargin) suggestions.push("Lower the intensity: the camera passes too close to the subject.");
  if (focusBlur > SHOT_CERTIFICATION.maxRegionBlur) suggestions.push("Use a longer lens or deeper focus so the subject region stays sharp.");
  return { ok: suggestions.length === 0, inFrame, depthMargin, focusBlur, suggestions };
}
export function buildShotClip(input: ShotInput, options: { subject: { width: number; height: number; center?: readonly [number, number, number] }; frame: { width: number; height: number }; sceneSpeed?: number; clipId?: string; startMs?: number }):
  { clip: MotionClipInput; definition: ShotDefinition; report: FramingReport; verdict: ShotVerdict } {
  const ratio = options.frame.width / options.frame.height;
  const aspect = (Object.keys(ASPECT_FRAMES) as (keyof typeof ASPECT_FRAMES)[]).reduce((best, key) =>
    Math.abs(Math.log(ASPECT_FRAMES[key].width / ASPECT_FRAMES[key].height / ratio)) < Math.abs(Math.log(ASPECT_FRAMES[best].width / ASPECT_FRAMES[best].height / ratio)) ? key : best, "16:9" as keyof typeof ASPECT_FRAMES);
  const s = options.frame.height / ASPECT_FRAMES[aspect].height;
  const clampSide = (value: number) => Math.min(7680, Math.max(64, value));
  const subject = { width: clampSide(options.subject.width / s), height: clampSide(options.subject.height / s) };
  const shot = ShotInputSchema.parse({ ...input, aspect, subject });
  const definition = buildShot(shot);
  const report = framingReport(definition, subject);
  const verdict = shotVerdict(report, { ...(shot.lens !== undefined ? { lens: shot.lens } : {}), intensity: shot.intensity });
  const [px, py, pz] = options.subject.center ?? [0, 0, 0];
  const base = CameraSchema.parse(definition.scene.camera);
  const offsetAt = (timeMs: number) => {
    const state = evaluateMotion(definition.motion, timeMs);
    const c = CameraSchema.parse({ ...definition.scene.camera, ...state.camera });
    return apply(rotation(c), [px, py, pz]);
  };
  const spatial = new Set(["x", "y", "z", "perspective"]);
  const axis = { x: 0, y: 1, z: 2 } as const;
  const tracks = (definition.motion.tracks as { target: { kind: string }; property: string; keyframes: { timeMs: number; value: number }[] }[]).map(track => {
    if (track.target.kind === "camera" && spatial.has(track.property))
      return { ...track, keyframes: track.keyframes.map(frame => ({ ...frame, value: round(frame.value * s + (track.property in axis ? offsetAt(frame.timeMs)[axis[track.property as keyof typeof axis]] : 0)) })) };
    if (track.target.kind === "focus" && track.property === "distance") return { ...track, keyframes: track.keyframes.map(frame => ({ ...frame, value: round(frame.value * s) })) };
    return track;
  });
  // Static camera and focus values of the designed shot become constant tracks inside the clip.
  const animated = new Set(tracks.map(track => `${track.target.kind}.${track.property}`));
  for (const key of ["x", "y", "z", "rotateX", "rotateY", "rotateZ", "perspective"] as const) {
    if (animated.has(`camera.${key}`)) continue;
    const value = key in axis ? base[key] * s + offsetAt(0)[axis[key as keyof typeof axis]] : key === "perspective" ? base.perspective * s : base[key];
    tracks.push({ target: { kind: "camera" }, property: key, keyframes: [{ timeMs: 0, value: round(value) }] });
  }
  const focus = FocusSchema.parse(definition.scene.focus);
  for (const key of ["distance", "fStop", "focalLength", "maxBlur"] as const) {
    if (animated.has(`focus.${key}`)) continue;
    tracks.push({ target: { kind: "focus" }, property: key, keyframes: [{ timeMs: 0, value: round(key === "distance" ? focus.distance * s : focus[key]) }] });
  }
  const speed = Math.min(4, Math.max(0.05, 1 / (options.sceneSpeed ?? 1)));
  const clip: MotionClipInput = {
    id: options.clipId ?? `shot-${shot.kind}`, label: `${shot.kind} camera move`, startMs: options.startMs ?? 0, durationMs: definition.motion.durationMs,
    ...(Math.abs(speed - 1) > 1e-9 ? { speed: round(speed) } : {}),
    tracks: tracks as MotionClipInput["tracks"],
    source: { shot: shot.kind, version: 1, params: { intensity: shot.intensity, ...(shot.lens !== undefined ? { lens: shot.lens } : {}), durationMs: definition.motion.durationMs, aspect } },
  };
  return { clip, definition, report, verdict };
}
