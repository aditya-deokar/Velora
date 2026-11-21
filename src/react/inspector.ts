import { useSyncExternalStore } from "react";
import type { CameraDefinition, DepthEvidence, FocusDefinition, Matrix, MotionState, Measurement, SceneIssue, TransformInput } from "../core";
import type { AnimatableEntry } from "./registry";

/** SOURCE OF TRUTH: useSceneInspector.
 * WHAT: a read-only snapshot of one live Scene (registered Surfaces with parents, transforms and
 * measurements; declared animatables; evaluated world matrices, blur and depth; the evaluated motion
 * state and diagnostics) published through an explicit channel the Scene receives as a prop.
 * WHY: editor-grade consumers (the studio editor's layers, inspector and timeline) live outside the
 * Scene tree and must observe it without React instances, DOM nodes or a second evaluator.
 * WHERE: Scene publishes after each committed evaluation; ScenePreview creates the channel in editor
 * layout; panels subscribe with useSyncExternalStore. Snapshots are plain, frozen data.
 */
export type InspectedBinding = { id: string; parentId?: string; transform?: TransformInput; measurement?: Measurement; mounted: true };
export type InspectedNode = { id: string; world: Matrix; blur: number; depth: number; width: number; height: number };
export type SceneSnapshot = {
  revision: number;
  timeMs: number;
  bindings: readonly InspectedBinding[];
  nodes: readonly InspectedNode[];
  animatables: readonly AnimatableEntry[];
  motion: MotionState;
  issues: readonly SceneIssue[];
  advisories?: readonly SceneIssue[];
  depth?: readonly (DepthEvidence & { explicitTiers?: readonly number[] })[];
  /** The resolved camera and focus (after motion, add clips and constraints): what capture renders. */
  camera?: CameraDefinition;
  focus?: FocusDefinition;
  /** The director viewpoint when one is set; `nodes` are then evaluated from it (display space). */
  view?: CameraDefinition;
};
export type SceneInspector = {
  publish(snapshot: Omit<SceneSnapshot, "revision">): void;
  subscribe(listener: () => void): () => void;
  snapshot(): SceneSnapshot | undefined;
};
const freeze = <T,>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) freeze((value as Record<string, unknown>)[key]);
  }
  return value;
};
/** A channel for one Scene's snapshots. Publishing an equal snapshot does not notify subscribers. */
export function createSceneInspector(): SceneInspector {
  const listeners = new Set<() => void>();
  let current: SceneSnapshot | undefined;
  let key = "";
  return {
    publish(next) {
      const nextKey = JSON.stringify(next);
      if (nextKey === key) return;
      key = nextKey;
      current = freeze({ ...JSON.parse(nextKey), revision: (current?.revision ?? 0) + 1 } as SceneSnapshot);
      listeners.forEach(listener => listener());
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => current,
  };
}
const none = () => () => {};
/** The latest snapshot of the Scene that publishes to `inspector` (undefined before its first commit). */
export function useSceneInspector(inspector: SceneInspector | undefined): SceneSnapshot | undefined {
  return useSyncExternalStore(inspector?.subscribe ?? none, () => inspector?.snapshot(), () => undefined);
}
