import { cameraMatrix, projectWorld, type CameraDefinition, type EditOp, type ProjectedPoint } from "../../core";
import type { SceneSnapshot } from "../../react";
import type { Doc } from "../store";
import { listTracks } from "../model";
import { toAuthored, toPresentation } from "../properties";
import { eyeOf } from "./CameraTool";
import { sceneAt, type Frame } from "./scene";

/** Motion paths (Phase 06.4): a layer's evaluated center sampled at frame rate through the compiled
 * evaluator and projected through the current viewpoint (ticks show speed); keyframe dots at the times
 * of its position keys; path-track tangent handles. The camera path is drawn in director view. Pure. */
export type PathSample = { timeMs: number; point: ProjectedPoint };
export type PathKey = { timeMs: number; point: ProjectedPoint; tracks: ("x" | "y" | "position")[]; tangents?: { in?: ProjectedPoint | null; out?: ProjectedPoint | null } };
export const MAX_SAMPLES = 360;
/** Presentation times sampled at the editor fps across [fromMs, toMs] (capped, endpoints included). */
export function sampleTimes(fromMs: number, toMs: number, fps: number): number[] {
  const span = Math.max(0, toMs - fromMs);
  const step = Math.max(1000 / fps, span / MAX_SAMPLES);
  const out: number[] = [];
  for (let t = fromMs; t < toMs - 1e-6; t += step) out.push(t);
  out.push(toMs);
  return out;
}
const centerOf = (world: readonly number[]) => [world[3], world[7], world[11]];
/** The layer's projected center at each sample (null samples sit behind the eye and break the line). */
export function layerPath(doc: Doc, snapshot: SceneSnapshot, id: string, camera: CameraDefinition, frame: Frame, times: readonly number[]): (PathSample | null)[] {
  return times.map(timeMs => {
    const node = sceneAt(doc, snapshot, timeMs, camera).nodes.find(entry => entry.id === id);
    const point = node ? projectWorld(camera, frame, centerOf(node.world), "view") : null;
    return point ? { timeMs, point } : null;
  });
}
/** The real camera's eye over time, projected through the director viewpoint. */
export function cameraPath(doc: Doc, snapshot: SceneSnapshot, director: CameraDefinition, frame: Frame, times: readonly number[]): (PathSample | null)[] {
  return times.map(timeMs => {
    const camera = sceneAt(doc, snapshot, timeMs).camera;
    const point = camera ? projectWorld(director, frame, eyeOf(camera)) : null;
    return point ? { timeMs, point } : null;
  });
}
/** Keyframe dots: authored times of the layer's x / y / position keys (root tracks only; clip tracks
 * shift by their clip and are edited on the timeline). */
export function pathKeys(doc: Doc, snapshot: SceneSnapshot, id: string, camera: CameraDefinition, frame: Frame): PathKey[] {
  const times = new Map<number, Set<"x" | "y" | "position">>();
  const tangents = new Map<number, { inTangent?: number[]; outTangent?: number[]; value: number[] }>();
  for (const entry of listTracks(doc)) {
    if (entry.clip || entry.address.target.kind !== "surface" || entry.address.target.id !== id) continue;
    const property = entry.address.property;
    if (property !== "x" && property !== "y" && property !== "position") continue;
    for (const key of entry.track.keyframes ?? []) {
      if (!times.has(key.timeMs)) times.set(key.timeMs, new Set());
      times.get(key.timeMs)!.add(property);
      if (property === "position") tangents.set(key.timeMs, { value: key.value, ...(key.inTangent ? { inTangent: key.inTangent } : {}), ...(key.outTangent ? { outTangent: key.outTangent } : {}) });
    }
  }
  const out: PathKey[] = [];
  for (const [timeMs, tracks] of [...times].sort((a, b) => a[0] - b[0])) {
    const evaluation = sceneAt(doc, snapshot, toPresentation(doc, timeMs), camera);
    const node = evaluation.nodes.find(entry => entry.id === id);
    const point = node && projectWorld(camera, frame, centerOf(node.world), "view");
    if (!node || !point) continue;
    const tangent = tangents.get(timeMs);
    const handle = (vector?: number[]) => {
      if (!vector) return undefined;
      // A tangent is a stage-space offset from the key's position in the parent's frame (root: stage).
      const parent = snapshot.bindings.find(binding => binding.id === id)?.parentId;
      const basis = parent ? evaluation.nodes.find(entry => entry.id === parent)?.world : undefined;
      const m = basis ?? cameraMatrix(camera);
      const [x, y, z] = [vector[0] ?? 0, vector[1] ?? 0, vector[2] ?? 0];
      const world = [node.world[3] + m[0] * x + m[1] * y + m[2] * z, node.world[7] + m[4] * x + m[5] * y + m[6] * z, node.world[11] + m[8] * x + m[9] * y + m[10] * z];
      return projectWorld(camera, frame, world, "view");
    };
    out.push({ timeMs, point, tracks: [...tracks], ...(tangent ? { tangents: { in: handle(tangent.inTangent), out: handle(tangent.outTangent) } } : {}) });
  }
  return out;
}
/** Dragging a keyframe dot: key.set on the tracks that have a key at that time. */
export function keyDotOps(doc: Doc, id: string, timeMs: number, tracks: readonly string[], start: { x: number; y: number; z: number }, next: { x: number; y: number }): EditOp[] {
  const target = { kind: "surface" as const, id };
  return tracks.flatMap((property): EditOp[] => {
    if (property === "position") return [{ op: "key.set", track: { target, property: "position" }, atMs: timeMs, value: [next.x, next.y, start.z] } as EditOp];
    return [{ op: "key.set", track: { target, property }, atMs: timeMs, value: property === "x" ? next.x : next.y } as EditOp];
  });
}
/** The motion-path window: the work area when set, else the whole scene (presentation ms). */
export function pathWindow(doc: Doc, workArea: { startMs: number; endMs: number } | undefined, durationMs: number): [number, number] {
  return workArea ? [workArea.startMs, workArea.endMs] : [0, durationMs];
}
export { toAuthored };
