import { createContext, useContext } from "react";
import { useSceneTime } from "../react/context";
import type { ThreeRuntime } from "./runtime";

export type SceneClock = { t: number; seconds: number; seed: number };
export const ThreeRuntimeContext = createContext<ThreeRuntime | null>(null);
export const ThreeSeedContext = createContext<number | null>(null);
export function useThreeRuntime() {
  const runtime = useContext(ThreeRuntimeContext);
  if (!runtime) throw new Error("This hook requires a Velora ThreeSurface.");
  return runtime;
}

/** The Scene's evaluated time (including its motion rate and loop), in ms and seconds. */
export function useSceneClock(): SceneClock {
  const t = useSceneTime();
  const seed = useContext(ThreeSeedContext);
  if (seed === null) throw new Error("useSceneClock requires a Velora ThreeSurface.");
  return { t, seconds: t / 1000, seed };
}
