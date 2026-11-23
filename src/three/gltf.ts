import { useLayoutEffect, useMemo } from "react";
import { AnimationMixer, LoopOnce, type AnimationClip, type Object3D } from "three";
import type { AnimatableSpec } from "../core";
import { ANIMATABLE_ID_PATTERN, animatableChannel } from "../core/animatable";
import { useThreeRuntime } from "./clock";

export type GLTFClipBinding = { name: string; time: string; weight: string; duration: number };
type AnimatedGLTF = { scene: Object3D; animations: readonly AnimationClip[] };

function clipBindings(clips: readonly AnimationClip[], id: string) {
  const ids = new Set<string>();
  return clips.map((clip, index) => {
    const name = clip.name || `Clip ${index + 1}`;
    const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 35) || "clip";
    let slug = stem;
    for (let suffix = 2; ids.has(slug); suffix++) slug = `${stem}-${suffix}`;
    ids.add(slug);
    const entry = `three:${id}.${slug}`;
    return { entry, name, time: animatableChannel(entry, "time"), weight: animatableChannel(entry, "weight"), duration: clip.duration };
  });
}

/** The GLTF scene must be the instance mounted in the canvas. Use separate instances for repeated models. */
export function useGLTFClips(gltf: AnimatedGLTF, id: string): readonly GLTFClipBinding[] {
  const runtime = useThreeRuntime();
  if (!ANIMATABLE_ID_PATTERN.test(id) || id.length > 80) throw new Error(`Invalid glTF animatable id "${id}".`);
  const bindings = useMemo(() => clipBindings(gltf.animations, id), [gltf.animations, id]);
  useLayoutEffect(() => {
    const mixer = new AnimationMixer(gltf.scene);
    const actions = gltf.animations.map(clip => mixer.clipAction(clip).setLoop(LoopOnce, 1));
    const tokens = bindings.map(binding => {
      const token = Symbol("three-clip");
      const spec: AnimatableSpec = {
        time: { type: "number", default: 0, min: 0, max: binding.duration, step: 0.01, unit: "s" },
        weight: { type: "number", default: 0, min: 0, max: 1, step: 0.01 },
      };
      runtime.registry.declareAnimatable(token, { id: binding.entry, spec, key: JSON.stringify(spec),
        explicitOwner: runtime.owner, kind: "three", label: binding.name });
      return token;
    });
    const remove = runtime.register(({ channels }) => {
      actions.forEach((action, index) => {
        const binding = bindings[index];
        const time = Math.max(0, Math.min(binding.duration, channels[binding.time] ?? 0));
        const weight = Math.max(0, Math.min(1, channels[binding.weight] ?? 0));
        action.reset().setEffectiveWeight(weight).startAt(1 - time).play();
        action.clampWhenFinished = true;
      });
      // setTime resets the shared mixer. Scheduling each action relative to this sample
      // gives its own absolute clip time while preserving Three's normal weight blending.
      mixer.setTime(1);
    }, "mixer");
    return () => {
      remove();
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      tokens.forEach(token => runtime.registry.releaseAnimatable(token));
    };
  }, [runtime, gltf.scene, gltf.animations, bindings]);
  return bindings;
}
