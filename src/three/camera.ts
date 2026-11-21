import { Matrix4, Vector3, type PerspectiveCamera } from "three";
import type { CameraDefinition } from "../core";
import { cameraMatrix, cameraWorld, invertAffine } from "../core/spatial";

const basis = new Matrix4().makeScale(1, -1, 1);

/** Velora stage coordinates are centered, with Y down. Three world coordinates use Y up. */
export function applyVeloraCamera(camera: PerspectiveCamera, view: CameraDefinition & { zoom?: number }, width: number, height: number) {
  const pose = new Matrix4().fromArray([...cameraWorld(view)]).transpose();
  basis.clone().multiply(pose).multiply(basis).decompose(camera.position, camera.quaternion, camera.scale);
  camera.fov = 2 * Math.atan(height / (2 * view.perspective * (view.zoom ?? 1))) * (180 / Math.PI);
  camera.zoom = 1;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

export function cancelStageCamera(view: CameraDefinition): string {
  const matrix = new Matrix4().fromArray([...invertAffine(cameraMatrix(view))!]).transpose();
  return `matrix3d(${matrix.elements.join(",")})`;
}

export function asStagePoint(point: Vector3): [number, number, number] {
  return [point.x, -point.y, point.z];
}
