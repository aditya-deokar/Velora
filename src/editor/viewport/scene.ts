import {
  CameraSchema, FocusSchema, SURFACE_VISUAL_PROPERTIES, TransformSchema, cameraMatrix, evaluateMotion, evaluateScene, withAdditive,
  type CameraDefinition, type Evaluation, type Matrix, type Measurements, type MotionState, type Transform,
} from "../../core";
import type { SceneSnapshot } from "../../react";
import type { Doc } from "../store";
import { valueAt } from "../properties";

/** Viewport geometry read from the one Scene snapshot plus the draft recipe (no DOM rects, no second
 * renderer). Every projection goes through the spatial owner (projectWorld, screenRay, intersectPlane). */
export type Frame = { width: number; height: number };
const visual: ReadonlySet<string> = new Set(SURFACE_VISUAL_PROPERTIES);
const CAMERA_BASE = CameraSchema.parse({}), FOCUS_BASE = FocusSchema.parse({}), TRANSFORM_BASE = TransformSchema.parse({});
/** The camera the frame is displayed through: the director viewpoint when set, else the resolved camera. */
export function displayCamera(snapshot: SceneSnapshot | undefined, doc: Doc): CameraDefinition {
  return snapshot?.view ?? snapshot?.camera ?? CameraSchema.parse(doc?.definition?.scene?.camera ?? {});
}
/** The real (capture) camera, resolved by the Scene. */
export function realCamera(snapshot: SceneSnapshot | undefined, doc: Doc): CameraDefinition {
  return snapshot?.camera ?? CameraSchema.parse(doc?.definition?.scene?.camera ?? {});
}
export const parentOf = (snapshot: SceneSnapshot | undefined, id: string) => snapshot?.bindings.find(binding => binding.id === id)?.parentId;
/** World matrix (display space) of a Surface's parent frame: the parent Surface, or the camera for roots. */
export function parentWorld(snapshot: SceneSnapshot | undefined, id: string, camera: CameraDefinition): Matrix {
  const parent = parentOf(snapshot, id);
  const node = parent ? snapshot?.nodes.find(entry => entry.id === parent) : undefined;
  return node?.world ?? cameraMatrix(camera);
}
const TRANSFORM_KEYS = ["x", "y", "z", "rotateX", "rotateY", "rotateZ", "scale", "scaleX", "scaleY", "scaleZ", "skewX", "skewY", "originX", "originY"] as const;
/** A Surface's local transform at the playhead (animated, static base or default), through valueAt. */
export function transformAt(doc: Doc, id: string, state: MotionState | undefined, snapshot: SceneSnapshot | undefined): Transform {
  const out: Record<string, number> = {};
  for (const property of TRANSFORM_KEYS) {
    const value = valueAt(doc, { target: { kind: "surface", id }, property }, state, snapshot);
    if (typeof value === "number") out[property] = value;
  }
  return TransformSchema.parse(out);
}
/** Evaluate the scene at another presentation time with the live layout (snapshot measurements), the
 * same input construction the Scene uses. `camera` pins the viewpoint (motion paths and onion skin are
 * drawn in the current view); otherwise the evaluated camera and constraints apply. */
export function sceneAt(doc: Doc, snapshot: SceneSnapshot, presentationMs: number, camera?: CameraDefinition): Evaluation & { state: MotionState } {
  const definition = doc?.definition ?? {};
  const state = definition.motion ? evaluateMotion(definition.motion, presentationMs) : { surfaces: {}, camera: {}, focus: {}, channels: {}, issues: [] } as MotionState;
  const additive = state.additive;
  const split = (values: Record<string, number> | undefined, keepVisual: boolean) =>
    values ? Object.fromEntries(Object.entries(values).filter(([key]) => visual.has(key) === keepVisual)) : undefined;
  const nodes = snapshot.bindings.map(binding => ({
    id: binding.id, ...(binding.parentId ? { parentId: binding.parentId } : {}),
    transform: withAdditive({ ...binding.transform, ...split(state.surfaces[binding.id] as Record<string, number> | undefined, false) },
      split(additive?.surfaces?.[binding.id], false), TRANSFORM_BASE),
  }));
  const measurements: Measurements = Object.fromEntries(snapshot.bindings.flatMap(binding => binding.measurement ? [[binding.id, binding.measurement]] : []));
  const input = camera
    ? { camera, focus: { ...FOCUS_BASE, maxBlur: 0 }, nodes }
    : {
      camera: withAdditive({ ...definition.scene?.camera, ...state.camera }, additive?.camera, CAMERA_BASE),
      focus: withAdditive({ ...definition.scene?.focus, ...state.focus }, additive?.focus, FOCUS_BASE),
      ...(definition.scene?.constraints ? { constraints: definition.scene.constraints } : {}),
      nodes,
    };
  return { ...evaluateScene(input, measurements, { channels: state.channels }), state };
}
/** Pointer position in frame pixels from a client point (the overlay SVG carries the frame's CTM). */
export function framePoint(svg: SVGSVGElement, clientX: number, clientY: number, frame: Frame): { x: number; y: number } {
  const matrix = svg.getScreenCTM?.();
  if (matrix) { const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()); return { x: point.x, y: point.y }; }
  const rect = svg.getBoundingClientRect();
  return { x: ((clientX - rect.left) / rect.width) * frame.width, y: ((clientY - rect.top) / rect.height) * frame.height };
}
