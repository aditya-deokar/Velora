import { useMemo, useState } from "react";
import { useLayoutEffect, useEffect } from "react";
import {
  ANIMATABLE_ID_PATTERN,
  AnimatableSpecSchema,
  animatableChannel,
  coerceAnimatable,
  type AnimatableProp,
  type AnimatableValues,
} from "../core";
import { useSceneContext } from "./index";

/** SOURCE OF TRUTH: useAnimatable.
 * WHAT: typed component props at scene time: each declared prop reads channel `<id>.<prop>` (or an
 * alias) from the evaluated motion, coerced to its type, and falls back to the spec default.
 * WHY: any React component gets keyframeable props without a second clock or state model; the Scene
 * registry records the spec so the editor inspector and agents know what is animatable.
 * WHERE: core/animatable owns specs and coercion; core/motion evaluates channel tracks; Scene supplies
 * the evaluated channels; registry.ts stores { id, spec, owner } and never component instances.
 */
export type AnimatableOptions<S> = {
  /** Map a prop to an existing channel id (for example { x: "cursor-x" }) so old channel names keep working. */
  channels?: Partial<Record<keyof S & string, string>>;
};
const useLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Values plus which props currently have a track (so components can keep their own prop fallbacks). */
export function useAnimatableState<const S extends Record<string, AnimatableProp>>(id: string | undefined, spec: S, options: AnimatableOptions<S> = {}): { values: AnimatableValues<S>; animated: ReadonlySet<keyof S & string> } {
  const { context, parent } = useSceneContext();
  if (!context) throw new Error("useAnimatable requires a Velora Scene.");
  const key = JSON.stringify(spec);
  const parsed = useMemo(() => AnimatableSpecSchema.safeParse(spec), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!parsed.success) throw new Error(`Invalid animatable spec for ${id ?? "component"}: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const [token] = useState(() => Symbol("velora-animatable"));
  const registry = context.registry;
  const registrable = id !== undefined && ANIMATABLE_ID_PATTERN.test(id);
  useLayout(() => {
    if (registrable) registry.declareAnimatable(token, { id, spec: parsed.data, key, owner: parent });
    else registry.releaseAnimatable(token);
  }, [registry, token, registrable, id, key, parent]);
  useLayout(() => () => registry.releaseAnimatable(token), [registry, token]);
  const values: Record<string, number | string | boolean> = {};
  const animated = new Set<keyof S & string>();
  for (const prop of Object.keys(parsed.data) as (keyof S & string)[]) {
    const channel = options.channels?.[prop] ?? (id === undefined ? undefined : animatableChannel(id, prop));
    const raw = channel === undefined ? undefined
      : parsed.data[prop].type === "color"
        ? (Object.hasOwn(context.colorChannels, channel) ? context.colorChannels[channel] : undefined)
        : (Object.hasOwn(context.channels, channel) ? context.channels[channel] : undefined);
    if (raw !== undefined) animated.add(prop);
    values[prop] = coerceAnimatable(parsed.data, prop, raw);
  }
  return { values: values as AnimatableValues<S>, animated };
}
/** Typed values of a component's animatable props at the current scene time. */
export function useAnimatable<const S extends Record<string, AnimatableProp>>(id: string, spec: S, options: AnimatableOptions<S> = {}): AnimatableValues<S> {
  return useAnimatableState(id, spec, options).values;
}
