import { z } from "zod";
import { compilePath, type PathKey, type Vector3 } from "./paths";
import { cameraAtStageEye, cameraMatrix, cameraWorld, coverScaleAt, projectWorld, resolveConstraints, applyPoint, type Frame } from "./spatial";
import { CameraSchema, FocusSchema, type CameraDefinition, type SceneConstraint, type SceneInput } from "./scene";
import { LENS_PRESETS, LensPresetSchema, lensPreset } from "./lens";
import { evaluateMotion, withAdditive, withCameraAdditive, type MotionInput, type MotionClipInput } from "./motion";
import { describeElementTarget, targetPoseKey, type AnchorReport, type ElementTarget } from "./targets";
import { buildOrbitRig } from "./shots";
import type { Stage } from "./stage";
import type { LookInput } from "./looks";

/** SOURCE OF TRUTH: simulateFollower, buildDroneFlyover, buildTelephotoOrbit, buildWhipPan, velocityBlurAt.
 * WHAT: bake physical camera motion and measure shutter displacement against sampled camera poses.
 * WHY: playback, scrubbing and export all evaluate the same authored data without integrating physics.
 * WHERE: shot builders, scene edits, Studio and render reporting use these deterministic functions.
 */
export * from "./rig-params";
import { DroneFlyoverSchema, TelephotoOrbitSchema, WhipPanSchema, RigRequestSchema, RigWaypointSchema,
  RIG_MASSES, RigDurationSchema, FollowerSchema, RigMassSchema, RigLayerSchema, type RigKind } from "./rig-params";
const bankLimit = { subtle: 6, standard: 9, dramatic: 12 };
const limits = { light: 180_000, medium: 100_000, heavy: 60_000 };
export type RigLayer = z.output<typeof RigLayerSchema>;
export function rigLayersFromAnchors(anchors: readonly Pick<AnchorReport, "target" | "ambiguous" | "stagePoint" | "stageCorners" | "tier" | "stageElevation">[]) {
  return anchors.flatMap(anchor => anchor.ambiguous || !anchor.stagePoint ? [] : [{
    id: describeElementTarget(anchor.target), target: anchor.target, tier: anchor.tier, point: anchor.stagePoint, corners: anchor.stageCorners,
    elevation: anchor.stageElevation,
  }]);
}
export type RigContext = { frame: Frame; stage?: Pick<Stage, "width" | "physicalWidthMm">; layers?: readonly RigLayer[]; id?: string; startMs?: number };
export type RigDefinition = {
  width: number; height: number; scene: SceneInput & { camera: z.input<typeof CameraSchema>; focus: z.input<typeof FocusSchema> }; motion: MotionInput; look?: LookInput; focusTarget?: ElementTarget;
};
type V = [number, number, number];
type Sample = { timeMs: number; value: V; velocity: V };
type Curve = { durationMs: number; sample: (ms: number) => Vector3 };
const map = (a: Vector3, f: (x: number, i: number) => number) => a.map(f) as V;
const add = (a: Vector3, b: Vector3) => map(a, (x, i) => x + b[i]);
const sub = (a: Vector3, b: Vector3) => map(a, (x, i) => x - b[i]);
const scale = (a: Vector3, k: number) => map(a, x => x * k || 0);
const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3, b: Vector3): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vector3) => scale(a, 1 / (Math.hypot(...a) || 1));
const clamp = (x: number, min = 0, max = 1) => Math.max(min, Math.min(max, x));
const round = (x: number) => Math.round(x * 1000) / 1000 || 0;
const smooth = (x: number) => { const u = clamp(x); return u * u * u * (10 + u * (-15 + 6 * u)); };
const lerp = (a: Vector3, b: Vector3, t: number) => add(a, scale(sub(b, a), t));
const radians = Math.PI / 180;
const massOf = (mass: z.output<typeof RigMassSchema>) => typeof mass === "string" ? RIG_MASSES[mass] : mass;
const camera = { kind: "camera" } as const;
const focus = { kind: "focus" } as const;
const angleDelta = (a: number, b: number) => ((a - b + 540) % 360 + 360) % 360 - 180;

/** Semi-implicit Euler. All integration steps are fixed, including the one that covers the endpoint. */
export function simulateFollower(targetPath: Curve, parameters: z.input<typeof FollowerSchema>, { stepHz = 240 }: { stepHz?: 240 | 480 } = {}): Sample[] {
  const { frequencyHz, dampingRatio } = FollowerSchema.parse(parameters);
  const durationMs = RigDurationSchema.parse(targetPath.durationMs);
  if (stepHz !== 240 && stepHz !== 480) throw new RangeError("Use a fixed 240 Hz or 480 Hz step.");
  const dt = 1 / stepHz, omega = 2 * Math.PI * frequencyHz;
  let x = map(targetPath.sample(0), n => n), v: V = [0, 0, 0];
  const output: Sample[] = [{ timeMs: 0, value: map(x, round), velocity: v }];
  for (let step = 1; step <= Math.ceil(durationMs * stepHz / 1000); step++) {
    const time = step * 1000 / stepHz;
    const target = targetPath.sample(Math.min(durationMs, time));
    const a = sub(scale(sub(target, x), omega * omega), scale(v, 2 * dampingRatio * omega));
    const last = x, lastV = v;
    v = add(v, scale(a, dt));
    x = add(x, scale(v, dt));
    const fraction = clamp((durationMs - time + 1000 * dt) / (1000 * dt));
    output.push({ timeMs: Math.min(time, durationMs), value: map(lerp(last, x, fraction), round), velocity: map(lerp(lastV, v, fraction), round) });
  }
  return output;
}
function bakeTimes(durationMs: number) {
  const end = round(durationMs);
  const keys = Array.from({ length: Math.ceil(end * 0.06) }, (_, i) => round(i / 0.06)).filter(time => time < end);
  return [...keys, end];
}
function interpolate(samples: readonly Sample[], ms: number, stepHz = 240) {
  const i = Math.min(samples.length - 2, Math.max(0, Math.floor(ms * stepHz / 1000)));
  const a = samples[i], b = samples[i + 1];
  return lerp(a.value, b.value, clamp((ms - a.timeMs) / (b.timeMs - a.timeMs)));
}
function sampleValues(times: readonly number[], values: readonly V[]) {
  return times.map((timeMs, i): Sample => {
    const a = Math.max(0, i - 1), b = Math.min(times.length - 1, i + 1);
    return { timeMs: round(timeMs), value: map(values[i], round), velocity: i === 0 || i === times.length - 1 ? [0, 0, 0] : scale(sub(values[b], values[a]), 1 / (times[b] - times[a])) };
  });
}
function hermite(a: Sample, b: Sample, ms: number) {
  const span = b.timeMs - a.timeMs, u = (ms - a.timeMs) / span;
  const f = u * u * (3 - 2 * u);
  return add(lerp(a.value, b.value, f), scale(sub(scale(a.velocity, 1 - u), scale(b.velocity, u)), span * u * (1 - u)));
}
/** RDP keeps a join where the candidate interpolant exceeds the tolerance against the 60 Hz bake. */
export function simplifyRigSamples(samples: readonly Sample[], tolerance: number, cubic = true): Sample[] {
  if (samples.length < 3) return [...samples];
  const last = samples.length - 1, indices = new Set([0, last]), pending = [[0, last]];
  while (pending.length) {
    const [a, b] = pending.pop()!;
    let worst = tolerance, index = -1;
    for (let i = a + 1; i < b; i++) {
      const { timeMs, value } = samples[i];
      const guess = cubic ? hermite(samples[a], samples[b], timeMs)
        : lerp(samples[a].value, samples[b].value, (timeMs - samples[a].timeMs) / (samples[b].timeMs - samples[a].timeMs));
      const error = Math.hypot(...sub(value, guess));
      if (error > worst) { worst = error; index = i; }
    }
    if (index !== -1) { indices.add(index); pending.push([a, index], [index, b]); }
  }
  return [...indices].sort((a, b) => a - b).map(i => samples[i]);
}
const baseFocus = FocusSchema.parse({});
function view({ perspective, rotateX = 0, rotateY = 0, rotateZ = 0 }: Partial<CameraDefinition> & { perspective: number }) {
  return CameraSchema.parse({ perspective, rotateX, rotateY, rotateZ });
}
function aim(eye: V, base: CameraDefinition, target: V) {
  return resolveConstraints([{ kind: "lookAt", target: { point: target } }], cameraAtStageEye(eye, base), baseFocus, () => target).camera;
}
const eyeOf = (pose: CameraDefinition) => applyPoint(cameraWorld(pose), [0, 0, 0]);
type RigLens = { perspective: number; focus: { focalLength: number; fStop: number; maxBlur: number } };
const lensOf = (name: z.output<typeof LensPresetSchema>, context: RigContext): RigLens => lensPreset(name, { frameHeight: context.frame.height, stage: context.stage });
function measured(target: ElementTarget, context: RigContext) {
  const layers = context.layers?.filter(row => row.target && targetPoseKey(row.target) === targetPoseKey(target));
  if (layers?.length !== 1) throw new RangeError(`Measure the unique target ${describeElementTarget(target)} in the running scene before baking.`);
  return layers[0];
}
type RigTrack = NonNullable<MotionClipInput["tracks"]>[number];
const key = (timeMs: number, value: number, easing: "linear" | "hold" = "linear") => ({ timeMs: round(timeMs), value: round(value), easing });
function weightTrack(id: string, name: string, frames: ReturnType<typeof key>[], tracks: RigTrack[]): NonNullable<SceneConstraint["weight"]> {
  const target = { kind: "channel" as const, id: `${id}-rig-${name}` };
  tracks.push({ target, property: "value", keyframes: frames });
  return { target, property: "value", fallback: 0 };
}
function baked(id: string, kind: RigKind, params: Record<string, unknown>, durationMs: number, context: RigContext, times: number[], poses: CameraDefinition[],
  optics: ReturnType<typeof lensOf>, tracks: RigTrack[], constraints: SceneConstraint[], bank?: number[]) {
  const samples = simplifyRigSamples(sampleValues(times, poses.map(eyeOf)), 0.245);
  const positions: RigTrack = { target: camera, property: "position", timing: "parametric", space: "stage-eye", keyframes: samples.map((sample, i) => ({
    timeMs: sample.timeMs, value: sample.value, easing: "linear",
    ...(i > 0 ? { inTangent: scale(sample.velocity, (samples[i - 1].timeMs - sample.timeMs) / 3) } : {}),
    ...(i + 1 < samples.length ? { outTangent: scale(sample.velocity, (samples[i + 1].timeMs - sample.timeMs) / 3) } : {}),
  })) };
  const angles = poses.map((p): V => [p.rotateX, p.rotateY, p.rotateZ]);
  for (let i = 1; i < angles.length; i++) angles[i] = map(angles[i], (v, axis) => angles[i - 1][axis] + angleDelta(v, angles[i - 1][axis]));
  const anglesKeys = simplifyRigSamples(sampleValues(times, angles), 0.049, false);
  const clip: MotionClipInput = { id, label: kind, startMs: context.startMs ?? 0, durationMs: round(durationMs),
    tracks: [positions, ...(["rotateX", "rotateY"] as const).map((property, i): RigTrack => ({ target: camera, property, interpolation: "smooth", keyframes: anglesKeys.map(s => ({ timeMs: s.timeMs, value: s.value[i] })) })),
      { target: camera, property: "perspective", keyframes: [key(0, optics.perspective)] },
      { target: camera, property: "zoom", keyframes: [key(0, 1)] },
      ...Object.entries(optics.focus).map(([property, value]) => ({ target: focus, property, keyframes: [key(0, value)] }) as RigTrack),
      ...tracks],
    ...(bank ? { clips: [{ id: `${id.slice(0, 59)}-bank`, label: "Horizon bank", startMs: 0, mode: "add", tracks: [
      { target: camera, property: "rotateZ", interpolation: "smooth", keyframes: simplifyRigSamples(sampleValues(times, bank.map(v => [v, 0, 0])), 0.049, false).map(s => ({ timeMs: s.timeMs, value: s.value[0] })) },
    ] }] } : {}),
    source: { rig: kind, version: 1, params },
  };
  const nodes = [...new Set(constraints.flatMap(({ target }) => "surface" in target ? [target.surface] : []))].map(id => ({ id }));
  const definition: RigDefinition = { ...context.frame, scene: { nodes, camera: poses[0], focus: { ...optics.focus, distance: Math.max(optics.perspective, optics.focus.focalLength + 1) }, constraints },
    motion: { speed: 1, durationMs: (context.startMs ?? 0) + round(durationMs), tracks: [], clips: [clip] } };
  return { clip, constraints, definition };
}
export type BakedRig = ReturnType<typeof baked> & { clearance?: ReturnType<typeof rigClearance>; parallax?: ReturnType<typeof orbitParallax>; peakMs?: number; overshoot?: number };

function fadeToEndpoint(value: number, u: number, start = 0.8) {
  return value + (1 - value) * smooth((u - start) / (1 - start));
}
function frameDistance(layer: RigLayer, frame: Frame, fill: number, perspective: number) {
  if (!layer.corners) throw new RangeError("Measure the element’s rectangle before framing it.");
  const [a, b, , d] = layer.corners;
  const relative = Math.max(Math.hypot(...sub(b, a)) / frame.width, Math.hypot(...sub(d, a)) / frame.height);
  return perspective * relative / fill;
}
const ref = (target: z.output<typeof RigWaypointSchema>): SceneConstraint["target"] => Array.isArray(target) ? { point: target } : target;

export function buildDroneFlyover(input: z.input<typeof DroneFlyoverSchema>, context: RigContext): BakedRig {
  const params = DroneFlyoverSchema.parse(input), optics = lensOf(params.lens, context);
  if (LENS_PRESETS[params.lens].mm < 50) optics.focus.fStop = 8;
  const layers = params.waypoints.map(waypoint => Array.isArray(waypoint) ? { point: waypoint } : measured(waypoint, context));
  const points = layers.map(layer => {
    const corners = "corners" in layer ? layer.corners : undefined;
    const normal: V = corners ? unit(cross(sub(corners[1], corners[0]), sub(corners[3], corners[0]))) : [0, 0, 1];
    return add(layer.point, scale(normal, params.altitude));
  });
  const provisional = points.map((value, timeMs): PathKey => ({ value, timeMs, progress: u => u }));
  const length = compilePath(provisional, true).length;
  if (length < 0.001) throw new RangeError("Choose waypoints at distinct positions.");
  const durationMs = RigDurationSchema.parse(params.durationMs ?? (params.speed ? 1000 * length / params.speed : 5000));
  const path = compilePath(provisional.map((p, i) => ({ ...p, timeMs: i * durationMs / (points.length - 1) })), true);
  const lifted = context.layers?.filter(layer => layer.corners);
  if (params.through && !lifted?.length) throw new RangeError("Measure the layer planes in the running scene before checking flight clearance.");
  const tiers = lifted?.filter(layer => layer.tier === "floating" || layer.tier === "control").map(layer => layer.point[2]) ?? [];
  const gap = tiers.length >= 2 ? (Math.min(...tiers) + Math.max(...tiers)) / 2 : undefined;
  const fly = (ms: number) => {
    const p = path.sample(ms).point;
    if (!params.through) return p;
    return lerp(p, [p[0], p[1], gap ?? p[2] - params.altitude / 2], Math.sin(Math.PI * ms / durationMs) ** 2);
  };
  const samples = simulateFollower({ durationMs, sample: ms => fly(Math.min(durationMs, ms / 0.75)) }, massOf(params.mass));
  const times = bakeTimes(durationMs);
  const eyes = times.map(ms => lerp(interpolate(samples, ms), points.at(-1)!, smooth((ms / durationMs - 0.78) / 0.22)));
  const poses = eyes.map((eye, i) => {
    const t = times[i], direction = sub(eyes[Math.min(i + 1, eyes.length - 1)], eyes[Math.max(0, i - 1)]);
    const next = path.sample(Math.min(durationMs, t + params.lookAhead * durationMs / (points.length - 1))).point;
    const tangent = Math.hypot(...direction) > 0.001 ? unit(direction) : unit(sub(points.at(-1)!, points.at(-2)!));
    const ahead = add(eye, scale(tangent, Math.max(100, params.altitude)));
    const look = lerp(ahead, [next[0], next[1], next[2] - Math.max(30, params.altitude)], 0.65);
    return aim(eye, view(optics), look);
  });
  const maxBank = bankLimit[params.bank];
  const desiredBank = times.map((_, i) => {
    if (i < 1 || i >= times.length - 1) return 0;
    const acceleration = scale(add(sub(eyes[i + 1], scale(eyes[i], 2)), eyes[i - 1]), 3600);
    const forward = unit(sub(eyes[i + 1], eyes[i - 1]));
    // The flight direction defines the airframe's right axis. The gimbal aims independently.
    const right = unit(cross([0, 0, 1], forward));
    return clamp(0.004 * dot(acceleration, right), -maxBank, maxBank);
  });
  const roll = simulateFollower({ durationMs, sample: ms => [desiredBank[Math.min(desiredBank.length - 1, Math.round(ms * 0.06))], 0, 0] }, massOf(params.mass));
  const bank = times.map(ms => clamp(interpolate(roll, ms)[0] * (1 - smooth((ms / durationMs - 0.88) / 0.12)), -maxBank, maxBank));
  const id = context.id ?? "camera-rig", tracks: RigTrack[] = [], constraints: SceneConstraint[] = [];
  const nearest = eyes.map(eye => layers.reduce((best, point, j) => Math.hypot(...sub(point.point, eye)) < Math.hypot(...sub(layers[best].point, eye)) ? j : best, 0));
  layers.forEach((_, i) => {
    const target = ref(params.waypoints[i]);
    if (LENS_PRESETS[params.lens].mm >= 50)
      constraints.push({ kind: "focusFollow", target, weight: weightTrack(id, `focus-${i}`, times.flatMap((ms, j) => j === 0 || (nearest[j] === i) !== (nearest[j - 1] === i)
        ? [key(ms, Number(nearest[j] === i), "hold")] : []), tracks) });
    if (i > 0 && i === layers.length - 1)
      constraints.push({ kind: "lookAt", target, weight: weightTrack(id, "look-ahead", [key(0, 0), key(durationMs * 0.75, 0), key(durationMs, 0.65)], tracks) });
  });
  const result = baked(id, "drone-flyover", params, durationMs, context, times, poses, optics, tracks, constraints, bank);
  const clearance = rigClearance(result.definition, context.layers ?? [], { margin: params.margin });
  if (params.through && !clearance.pass) throw new RangeError(`Flight clearance is ${clearance.minimum.toFixed(1)} px. Increase altitude or move a waypoint to clear ${params.margin} px.`);
  return { ...result, clearance };
}

export function buildTelephotoOrbit(input: z.input<typeof TelephotoOrbitSchema>, context: RigContext): BakedRig {
  const params = TelephotoOrbitSchema.parse(input), optics = lensOf(params.lens, context);
  const hero = measured(params.target, context);
  const radius = Math.max(optics.focus.focalLength + 50, frameDistance(hero, context.frame, params.fill, optics.perspective));
  const { durationMs, arcDeg } = params, times = bakeTimes(durationMs);
  const axis = params.axis === "horizontal" ? { yaw: 1, pitch: 0 } : params.axis === "vertical" ? { yaw: 0, pitch: 1 }
    : { yaw: Math.cos(params.axis.pitch * radians) * Math.cos(params.axis.yaw * radians), pitch: Math.sin(params.axis.pitch * radians) || Math.sin(params.axis.yaw * radians) };
  const orbit = buildOrbitRig({ center: hero.point, radius, fromDeg: -arcDeg / 2, toDeg: arcDeg / 2,
    perspective: optics.perspective, durationMs, target: params.target, ease: "linear" });
  const spring = simulateFollower({ durationMs, sample: ms => [smooth(ms / (0.72 * durationMs)), 0, 0] }, massOf(params.mass));
  const orbitMotion: MotionInput = { speed: 1, durationMs, tracks: [], clips: [orbit.clip] };
  const poses = times.map(ms => {
    const travel = fadeToEndpoint(interpolate(spring, ms)[0], ms / durationMs);
    if (params.axis === "horizontal") {
      const state = evaluateMotion(orbitMotion, clamp(travel) * durationMs);
      return CameraSchema.parse({ ...state.camera, perspective: optics.perspective });
    }
    const angle = arcDeg * (travel - 0.5);
    const hint = view({ ...optics, rotateX: axis.pitch * angle, rotateY: axis.yaw * angle });
    const c = applyPoint(cameraMatrix(hint), hero.point);
    return { ...hint, x: c[0], y: c[1], z: c[2] + radius - optics.perspective };
  });
  const id = context.id ?? "camera-rig", tracks: RigTrack[] = [];
  if (params.depthBoost !== undefined) tracks.push({ target: { kind: "surface", id: params.target.surface }, property: "elevation", interpolation: "smooth",
    keyframes: [key(0, 1), key(durationMs / 2, params.depthBoost), key(durationMs, 1)] });
  const weight = weightTrack(id, "lock", [key(0, 1)], tracks);
  const constraints: SceneConstraint[] = [{ kind: "frame", target: params.target, fill: params.fill, weight },
    { ...orbit.constraint, weight }, { kind: "focusFollow", target: params.target, weight }];
  const result = baked(id, "telephoto-parallax-orbit", params, durationMs, context, times, poses, optics, tracks, constraints);
  result.definition.focusTarget = params.target;
  return { ...result, parallax: orbitParallax(result.definition, hero, context.layers ?? [], params.fill) };
}

export function buildWhipPan(input: z.input<typeof WhipPanSchema>, context: RigContext): BakedRig {
  const params = WhipPanSchema.parse(input), optics = lensOf(params.lens, context);
  const from = measured(params.from, context), to = measured(params.to, context);
  const center = lerp(from.point, to.point, 0.5);
  const distance = Math.max(frameDistance(to, context.frame, params.fill, optics.perspective), optics.focus.focalLength + 50);
  const eye: V = [center[0], center[1], Math.max(from.point[2], to.point[2]) + distance];
  const a = aim(eye, view(optics), from.point), b = aim(eye, a, to.point);
  const { durationMs } = params, times = bakeTimes(durationMs);
  const physics = massOf(params.mass);
  const response = simulateFollower({ durationMs, sample: ms => [smooth(ms / (durationMs * 0.24)), 0, 0] },
    { frequencyHz: clamp(physics.frequencyHz * 1080 / durationMs, 0.8, 12), dampingRatio: params.settle === "none" ? 1 : 0.79 });
  const peakOvershoot = Math.max(0, ...response.map(sample => sample.value[0] - 1));
  const travels = times.map(ms => {
    const p = interpolate(response, ms)[0];
    const settled = p > 1 ? 1 + (p - 1) * Math.min(1, 0.02 / peakOvershoot) : p;
    return fadeToEndpoint(settled, ms / durationMs, 0.78);
  });
  const peakIndex = travels.reduce((best, value, i) => i > 0 && Math.abs(value - travels[i - 1]) > Math.abs(travels[best] - travels[best - 1]) ? i : best, 1);
  const peakMs = times[peakIndex];
  const poses = travels.map(p => cameraAtStageEye(eye, { ...a,
    rotateX: a.rotateX + p * angleDelta(b.rotateX, a.rotateX), rotateY: a.rotateY + p * angleDelta(b.rotateY, a.rotateY) }));
  const id = context.id ?? "camera-rig", tracks: RigTrack[] = [];
  const pulse = (name: string, start: number, stop: number) => weightTrack(id, name, [key(0, start, "hold"), key(peakMs, stop)], tracks);
  const constraints: SceneConstraint[] = [
    { kind: "lookAt", target: params.from, weight: weightTrack(id, "aim-from", [key(0, 1), key(durationMs * 0.12, 0)], tracks) },
    { kind: "lookAt", target: params.to, weight: weightTrack(id, "aim-to", [key(0, 0), key(durationMs * 0.82, 0), key(durationMs, 1)], tracks) },
    { kind: "focusFollow", target: params.from, weight: pulse("focus-from", 1, 0) },
    { kind: "focusFollow", target: params.to, weight: pulse("focus-to", 0, 1) },
    { kind: "frame", target: params.to, fill: params.fill, weight: weightTrack(id, "frame", [key(0, 0), key(durationMs * 0.72, 0), key(durationMs, 1)], tracks) },
  ];
  const result = baked(id, "whip-pan-macro", params, durationMs, context, times, poses, optics, tracks, constraints);
  result.definition.focusTarget = params.to;
  if (params.blur === "auto") result.definition.look = { velocityBlur: { shutterMs: 20.8, maxPx: 24 } };
  return { ...result, peakMs: round(peakMs), overshoot: Math.max(0, ...travels.map(x => x - 1)) };
}
export function buildRig(input: z.input<typeof RigRequestSchema>, context: RigContext): BakedRig {
  const request = RigRequestSchema.parse(input);
  if (request.kind === "drone-flyover") return buildDroneFlyover(request.params, context);
  if (request.kind === "telephoto-parallax-orbit") return buildTelephotoOrbit(request.params, context);
  return buildWhipPan(request.params, context);
}
export function rigTargets(request: z.output<typeof RigRequestSchema>): ElementTarget[] {
  if (request.kind === "telephoto-parallax-orbit") return [request.params.target];
  if (request.kind === "whip-pan-macro") return [request.params.from, request.params.to];
  return request.params.waypoints.flatMap(point => Array.isArray(point) ? [] : [point]);
}

type SampleDefinition = { width?: number; height?: number; scene: SceneInput; motion?: MotionInput; look?: LookInput; focusTarget?: ElementTarget };
export function rigPose(definition: SampleDefinition, timeMs: number, layers?: readonly RigLayer[]) {
  const state = definition.motion ? evaluateMotion(definition.motion, timeMs) : undefined;
  const camera = CameraSchema.parse(withCameraAdditive({ ...definition.scene.camera, ...state?.camera }, state?.additive?.camera, state?.cameraPositionSpace));
  const focus = FocusSchema.parse(withAdditive({ ...definition.scene.focus, ...state?.focus }, state?.additive?.focus, baseFocus));
  const constraints = definition.scene.constraints as SceneConstraint[] | undefined;
  const geometry = (target: SceneConstraint["target"]) => {
    if ("point" in target) return { point: target.point };
    if (!("surface" in target) || !("selector" in target || typeof target.anchor === "string")) return;
    const row = layers?.find(row => row.target && targetPoseKey(row.target) === targetPoseKey(target as ElementTarget));
    return row && layerAtElevation(row, state?.surfaces[target.surface]?.elevation);
  };
  return resolveConstraints(constraints, camera, focus, target => geometry(target)?.point,
    { channels: state?.channels, frame: { width: definition.width ?? 1400, height: definition.height ?? 980 }, targetGeometry: geometry });
}
function layerAtElevation(layer: RigLayer, factor?: number): RigLayer {
  if (factor === undefined || !layer.elevation) return layer;
  const offset = sub(scale(layer.elevation.rest, factor), layer.elevation.current);
  return { ...layer, point: add(layer.point, offset), corners: layer.corners?.map(point => add(point, offset)) as RigLayer["corners"] };
}
export function rigSmoothness(definition: SampleDefinition, mass: z.output<typeof RigMassSchema> = "medium") {
  const clips = definition.motion?.clips?.filter(clip => clip.source && "rig" in clip.source) ?? [];
  const times = bakeTimes((definition.motion?.durationMs ?? 0) / (definition.motion?.speed ?? 0.5));
  const points = times.map(t => eyeOf(rigPose(definition, t).camera));
  let peakJerk = 0, maxVelocityDiscontinuity = 0;
  for (let i = 3; i < points.length; i++) {
    if (times[i] - times[i - 1] < 16) continue;
    const third = sub(sub(points[i], points[i - 3]), scale(sub(points[i - 1], points[i - 2]), 3));
    peakJerk = Math.max(peakJerk, Math.hypot(...third) * 216000);
  }
  for (const clip of clips) for (const track of clip.tracks ?? []) {
    if (track.property !== "position" || track.target.kind !== "camera") continue;
    for (let i = 1; i + 1 < track.keyframes.length; i++) {
      const a = track.keyframes[i - 1], b = track.keyframes[i], c = track.keyframes[i + 1];
      const input = "inTangent" in b && b.inTangent ? scale(b.inTangent, -3000 / (b.timeMs - a.timeMs)) : [0, 0, 0] as V;
      const output = "outTangent" in b && b.outTangent ? scale(b.outTangent, 3000 / (c.timeMs - b.timeMs)) : [0, 0, 0] as V;
      maxVelocityDiscontinuity = Math.max(maxVelocityDiscontinuity, Math.hypot(...sub(input, output)));
    }
  }
  const threshold = typeof mass === "string" ? limits[mass] : limits.medium;
  return { peakJerk: round(peakJerk), maxVelocityDiscontinuity: round(maxVelocityDiscontinuity), threshold, pass: peakJerk <= threshold && maxVelocityDiscontinuity < 0.05 };
}
function planeDistance(eye: V, layer: RigLayer) {
  if (!layer.corners) return Math.hypot(...sub(eye, layer.point));
  const corners = layer.corners;
  const [a, b, , d] = corners;
  const normal = unit(cross(sub(b, a), sub(d, a)));
  const distance = dot(sub(eye, a), normal);
  const projected = sub(eye, scale(normal, distance));
  if (corners.every((point, i) => dot(cross(sub(corners[(i + 1) % 4], point), sub(projected, point)), normal) >= 0))
    return Math.abs(distance);
  return Math.min(...corners.map((point, i) => {
    const edge = sub(corners[(i + 1) % 4], point);
    return Math.hypot(...sub(eye, add(point, scale(edge, clamp(dot(sub(eye, point), edge) / (dot(edge, edge) || 1))))));
  }));
}
function frustumDepth(layer: RigLayer, camera: CameraDefinition, frame: Frame) {
  const matrix = cameraMatrix(camera), p = camera.perspective, k = p * (camera.zoom ?? 1);
  let polygon = (layer.corners ?? [layer.point]).map(point => applyPoint(matrix, point));
  const clips = [
    (point: V) => p - point[2],
    (point: V) => frame.width * (p - point[2]) / 2 + point[0] * k,
    (point: V) => frame.width * (p - point[2]) / 2 - point[0] * k,
    (point: V) => frame.height * (p - point[2]) / 2 + point[1] * k,
    (point: V) => frame.height * (p - point[2]) / 2 - point[1] * k,
  ];
  for (const side of clips) polygon = polygon.flatMap((a, i, points) => {
    const b = points[(i + 1) % points.length], x = side(a), y = side(b);
    return (x >= 0) === (y >= 0) ? (x >= 0 ? [a] : []) : [...(x >= 0 ? [a] : []), lerp(a, b, x / (x - y))];
  });
  return Math.min(...polygon.map(point => Math.max(0, p - point[2])));
}
export function rigClearance(definition: SampleDefinition, layers: readonly RigLayer[], { poses, margin = 40 }: { poses?: readonly CameraDefinition[]; margin?: number } = {}) {
  const cameras = poses ?? bakeTimes((definition.motion?.durationMs ?? 0) / (definition.motion?.speed ?? 0.5)).map(t => rigPose(definition, t, layers).camera);
  let layerClearance = Infinity, cameraClearance = Infinity;
  for (const camera of cameras) for (const layer of layers) {
    layerClearance = Math.min(layerClearance, planeDistance(eyeOf(camera), layer));
    cameraClearance = Math.min(cameraClearance, frustumDepth(layer, camera, { width: definition.width ?? 1400, height: definition.height ?? 980 }));
  }
  const minimum = Math.min(layerClearance, cameraClearance);
  return { minimum, layerClearance, cameraClearance, margin, pass: minimum >= margin };
}
function orbitParallax(definition: RigDefinition, hero: RigLayer, layers: readonly RigLayer[], fill: number) {
  const offsets = layers.map(layer => ({ id: layer.id, projected: [] as { x: number; y: number }[], coverScale: 1 }));
  for (const ms of bakeTimes(definition.motion.durationMs)) {
    const { camera } = rigPose(definition, ms, [hero]);
    const state = evaluateMotion(definition.motion, ms);
    const at = (layer: RigLayer) => layerAtElevation(layer, layer.target ? state.surfaces[layer.target.surface]?.elevation : undefined);
    const center = projectWorld(camera, definition, at(hero).point);
    if (!center) continue;
    layers.forEach((original, i) => {
      const layer = at(original);
      const sample = projectWorld(camera, definition, layer.point);
      if (sample) offsets[i].projected.push({ x: sample.x - center.x, y: sample.y - center.y });
      if (layer.point[2] <= -2000 && layer.corners) {
        const [a, b, , d] = layer.corners;
        const size = { width: Math.hypot(...sub(b, a)), height: Math.hypot(...sub(d, a)) };
        const cover = coverScaleAt(layer.point[2], camera, definition, size);
        if (Number.isFinite(cover)) offsets[i].coverScale = Math.max(offsets[i].coverScale, cover);
      }
    });
  }
  return offsets.map(({ id, projected, coverScale }) => {
    const first = projected[0];
    return { id, fill, peakPx: first ? round(Math.max(...projected.map(p => Math.hypot(p.x - first.x, p.y - first.y)))) : 0, coverScale: round(coverScale) };
  });
}
export type VelocityBlur = { shutterMs: number; maxPx: number };
export function velocityBlurAt(definition: SampleDefinition, timeMs: number, options: { accumulate?: boolean; layers?: readonly RigLayer[]; sample?: (ms: number) => ReturnType<typeof rigPose>; targetPoint?: V } = {}) {
  const blur = definition.look?.velocityBlur;
  if (!blur || options.accumulate || timeMs <= 0) return { x: 0, y: 0 };
  const sample = options.sample ?? (ms => rigPose(definition, ms, options.layers));
  const now = sample(timeMs), previous = sample(Math.max(0, timeMs - blur.shutterMs));
  const target = options.targetPoint ?? options.layers?.find(layer => layer.target && definition.focusTarget && targetPoseKey(layer.target) === targetPoseKey(definition.focusTarget))?.point
    ?? applyPoint(cameraWorld(now.camera), [0, 0, -now.focus.distance]);
  const a = applyPoint(cameraMatrix(now.camera), target), b = applyPoint(cameraMatrix(previous.camera), target);
  const pixels = now.camera.perspective * (now.camera.zoom ?? 1) / Math.max(1, now.camera.perspective - a[2]);
  const x = (a[0] - b[0]) * pixels, y = (a[1] - b[1]) * pixels;
  const gain = Math.min(1, blur.maxPx / (Math.hypot(x, y) || 1));
  return { x: round(Math.abs(x) * gain), y: round(Math.abs(y) * gain) };
}
