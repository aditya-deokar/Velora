import { intersectPlane, projectWorld, screenRay, type CameraDefinition, type FocusDefinition, type ProjectedPoint } from "../../core";
import { dolly, eyeOf, orbit, pivotPoint, toStage, toView, type Camera } from "./CameraTool";
import type { Frame } from "./scene";

/** Director view (Phase 06.6): an editor-only viewpoint that sees the real camera in the set. The real
 * camera is drawn as a gizmo (eye, frustum to the frame plane, focus plane) from stage points projected
 * through the director camera. Display only: ScenePreview's viewCamera; capture refuses it. */
export type Gizmo = { eye: ProjectedPoint | null; frustum: (ProjectedPoint | null)[]; focus: (ProjectedPoint | null)[]; axis: ProjectedPoint | null };
/** A first director viewpoint: orbit the real camera 35° around its focus point, look down 15° and pull back. */
export function defaultDirector(real: CameraDefinition, focusDistance: number): CameraDefinition {
  const pivot = pivotPoint(real, focusDistance);
  return dolly(orbit(real, pivot, -35, -15), -real.perspective * 0.9);
}
/** Stage-space corners of a frame-sized rectangle at camera-axis distance `depth` from the eye. */
export function frustumCorners(real: Camera, frame: Frame, depth: number): [number, number, number][] {
  const k = depth / real.perspective, w = (frame.width / 2) * k, h = (frame.height / 2) * k, z = real.perspective - depth;
  return [[-w, -h, z], [w, -h, z], [w, h, z], [-w, h, z]].map(view => toStage(real, view));
}
export function cameraGizmo(real: Camera, focus: Pick<FocusDefinition, "distance">, director: CameraDefinition, frame: Frame): Gizmo {
  const project = (stage: readonly number[]) => projectWorld(director, frame, stage);
  return {
    eye: project(eyeOf(real)),
    frustum: frustumCorners(real, frame, real.perspective).map(project),
    focus: frustumCorners(real, frame, focus.distance).map(project),
    axis: project(toStage(real, [0, 0, real.perspective - Math.min(focus.distance, real.perspective) * 0.35])),
  };
}
/** Dragging the gizmo moves the real camera's eye in the plane through it parallel to the director's
 * image plane (screenRay + intersectPlane in director view space); returns the new real camera. */
export function dragCamera(real: Camera, director: CameraDefinition, frame: Frame, from: { x: number; y: number }, to: { x: number; y: number }): Camera | null {
  const eye = toView(director, eyeOf(real));
  const plane = [1, 0, 0, eye[0], 0, 1, 0, eye[1], 0, 0, 1, eye[2], 0, 0, 0, 1];
  const a = intersectPlane(screenRay(director, frame, from), plane), b = intersectPlane(screenRay(director, frame, to), plane);
  if (!a || !b) return null;
  // The eye delta in stage space; c = R·eye − (0, 0, P), so Δc = R·Δeye.
  const stageA = toStage(director, [eye[0] + a.u, eye[1] + a.v, eye[2]]), stageB = toStage(director, [eye[0] + b.u, eye[1] + b.v, eye[2]]);
  const delta = [stageB[0] - stageA[0], stageB[1] - stageA[1], stageB[2] - stageA[2]];
  const origin = toView(real, [0, 0, 0]), moved = toView(real, delta);
  const d = [moved[0] - origin[0], moved[1] - origin[1], moved[2] - origin[2]];
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { ...real, x: round(real.x + d[0]), y: round(real.y + d[1]), z: round(real.z + d[2]) };
}
