import { createContext, useContext } from "react";
import type { CameraDefinition, EvaluatedNode, TransformInput } from "../core";
import type { SurfaceVisualProperty } from "../core/motion";
import type { GizmoMode, Registry } from "./registry";

export type ThreeSelection = { id: string; mode: GizmoMode };
export type SurfaceVisuals = Partial<Record<SurfaceVisualProperty, number>>;
type SceneContextValue = {
  registry: Registry;
  nodes: Map<string, EvaluatedNode>;
  transforms: Map<string, TransformInput>;
  visuals: Map<string, SurfaceVisuals>;
  channels: Readonly<Record<string, number>>;
  colorChannels: Readonly<Record<string, string>>;
  styles: Readonly<Record<string, Readonly<Record<string, string>>>>;
  timeMs: number;
  displayCamera?: CameraDefinition;
  threeSelection?: ThreeSelection;
};

const createSceneContexts = () => ({ scene: createContext<SceneContextValue | null>(null), parent: createContext<symbol | undefined>(undefined) });
function sceneContexts() {
  if (typeof window === "undefined") return createSceneContexts();
  // Fast Refresh can evaluate the installed React entry again while the existing Scene is mounted.
  // Share context identity within this browser realm and React runtime.
  const key = Symbol.for("velora.scene-context.v1");
  const host = window as unknown as Record<symbol, WeakMap<typeof createContext, ReturnType<typeof createSceneContexts>> | undefined>;
  const contexts = host[key] ??= new WeakMap();
  const existing = contexts.get(createContext);
  if (existing) return existing;
  const created = createSceneContexts();
  contexts.set(createContext, created);
  return created;
}
export const { scene: SceneContext, parent: ParentContext } = sceneContexts();

/** Opt-in component adapters read the same explicit time used by spatial tracks. */
export function useSceneTime(): number {
  const context = useContext(SceneContext);
  if (!context) throw new Error("useSceneTime requires a Velora Scene.");
  return context.timeMs;
}
/** Internal: the Scene context for sibling adapters (animatables); not part of the public API. */
export function useSceneContext() {
  return { context: useContext(SceneContext), parent: useContext(ParentContext) };
}
