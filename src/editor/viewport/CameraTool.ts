import { cameraMatrix, invertAffine, lensFor, focalLengthForPerspective, type CameraDefinition, type Matrix } from "../../core";

/** Camera tool math (Phase 06.5): orbit, truck/pedestal, dolly, pan/tilt, roll, lens and dolly-zoom as
 * pure functions of a camera definition. The spatial owner's convention is view = R·p − c (cameraMatrix),
 * with the eye at (0, 0, perspective) in view space, so the eye in stage space is Rᵀ(c + (0, 0, P)). */
export type Camera = CameraDefinition;
type Vec3 = [number, number, number];
const apply = (m: Matrix, [x, y, z]: readonly number[]): Vec3 => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
const rotationOf = (c: Pick<Camera, "rotateX" | "rotateY" | "rotateZ">) => cameraMatrix({ x: 0, y: 0, z: 0, rotateX: c.rotateX, rotateY: c.rotateY, rotateZ: c.rotateZ });
const r = (value: number) => Math.round(value * 1000) / 1000;
const tidy = (c: Camera): Camera => ({ ...c, x: r(c.x), y: r(c.y), z: r(c.z), rotateX: r(c.rotateX), rotateY: r(c.rotateY), rotateZ: r(c.rotateZ), perspective: r(c.perspective) });
/** Stage position of a view-space point for this camera. */
export function toStage(c: Camera, view: readonly number[]): Vec3 { return apply(invertAffine(cameraMatrix(c))!, view); }
export function toView(c: Camera, stage: readonly number[]): Vec3 { return apply(cameraMatrix(c), stage); }
export const eyeOf = (c: Camera): Vec3 => toStage(c, [0, 0, c.perspective]);
/** The stage point the camera looks at on its axis at `distance` (the focus point by default). */
export const pivotPoint = (c: Camera, distance: number): Vec3 => toStage(c, [0, 0, c.perspective - distance]);
/** Re-solve camera x/y/z after a rotation so that `stage` keeps view position `view`: c = R'·p − v. */
function keep(c: Camera, rotation: Pick<Camera, "rotateX" | "rotateY" | "rotateZ">, stage: readonly number[], view: readonly number[]): Camera {
  const p = apply(rotationOf(rotation), stage);
  return tidy({ ...c, ...rotation, x: p[0] - view[0], y: p[1] - view[1], z: p[2] - view[2] });
}
/** Orbit around a stage point (the focus point, a lookAt target or the selected layer). */
export function orbit(c: Camera, pivot: readonly number[], yawDeg: number, pitchDeg: number): Camera {
  return keep(c, { rotateX: c.rotateX + pitchDeg, rotateY: c.rotateY + yawDeg, rotateZ: c.rotateZ }, pivot, toView(c, pivot));
}
/** Pan/tilt (and roll) in place: the eye stays fixed. */
export function panTilt(c: Camera, yawDeg: number, pitchDeg: number, rollDeg = 0): Camera {
  const eye = eyeOf(c);
  return keep(c, { rotateX: c.rotateX + pitchDeg, rotateY: c.rotateY + yawDeg, rotateZ: c.rotateZ + rollDeg }, eye, [0, 0, c.perspective]);
}
/** Truck/pedestal: content under the cursor follows it at `depth` (camera-axis distance). */
export function truck(c: Camera, dx: number, dy: number, depth: number): Camera {
  const k = depth / c.perspective;
  return tidy({ ...c, x: c.x - dx * k, y: c.y - dy * k });
}
/** Dolly along the view axis: positive moves the camera toward the scene. */
export function dolly(c: Camera, amount: number): Camera { return tidy({ ...c, z: c.z - amount }); }
/** Lens change (focal length in mm) at a fixed camera position. */
export function lens(c: Camera, mm: number, frameHeight: number): { camera: Camera; focalLength: number } {
  const next = lensFor(mm, frameHeight);
  return { camera: tidy({ ...c, perspective: next.perspective }), focalLength: next.focus.focalLength };
}
export const focalLengthOf = (c: Camera, frameHeight: number) => focalLengthForPerspective(c.perspective, frameHeight);
/** Dolly-zoom: change the lens and move along the view axis so the subject (a stage point) keeps its
 * projected size: k = P/(P − z) stays constant, so its depth scales with the perspective. */
export function dollyZoom(c: Camera, subject: readonly number[], perspective: number): Camera {
  const v = toView(c, subject);
  const depth = c.perspective - v[2];
  if (!(depth > 0)) return c;
  const nextDepth = (depth * perspective) / c.perspective;
  const nextZ = perspective - nextDepth;
  return tidy({ ...c, perspective, z: c.z + (v[2] - nextZ) });
}
/** Changed camera properties (the tool writes only these). */
export function cameraChanges(before: Camera, after: Camera): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of ["x", "y", "z", "rotateX", "rotateY", "rotateZ", "perspective"] as const) if (Math.abs(before[key] - after[key]) > 1e-6) out[key] = after[key];
  return out;
}
