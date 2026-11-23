import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement, type Ref, type RefObject } from "react";
import { Color, Euler, Matrix4, Quaternion, Vector3, type Light, type Mesh, type MeshStandardMaterial, type Object3D, type PerspectiveCamera } from "three";
import type { AnimatableProp } from "../core";
import { ANIMATABLE_ID_PATTERN, ThreeAnimatableSpecSchema, animatableChannel, coerceAnimatable } from "../core/animatable";
import { asStagePoint } from "./camera";
import { useThreeRuntime } from "./clock";
import type { FrameInput, ThreeRuntime } from "./runtime";

type Value = number | string | boolean;
type Field = { spec: AnimatableProp; read(): Value; write(value: Value): void; base: Value; last: Value };
export type Animatable3DSpec = Partial<Record<string, AnimatableProp>>;
const axes = ["x", "y", "z"] as const;
const degrees = 180 / Math.PI;

function field(spec: AnimatableProp, read: Field["read"], write: Field["write"]): Field {
  const base = read();
  return { spec, read, write, base, last: base };
}

function bindFields(object: Object3D) {
  const fields: Record<string, Field> = {};
  function numeric(key: string, read: () => number, write: (value: number) => void, extra: { min?: number; max?: number; unit?: string; step?: number } = {}) {
    fields[key] = field({ type: "number", default: read(), ...extra }, read, value => write(Number(value)));
  }
  function color(key: string, paint: Color) {
    const read = () => "#" + paint.getHexString();
    fields[key] = field({ type: "color", default: read() }, read, value => paint.setStyle(String(value)));
  }
  for (const axis of axes) {
    numeric(`position.${axis}`, () => object.position[axis], value => { object.position[axis] = value; });
    numeric(`rotation.${axis}`, () => object.rotation[axis] * degrees, value => { object.rotation[axis] = value / degrees; }, { unit: "deg" });
    numeric(`scale.${axis}`, () => object.scale[axis], value => { object.scale[axis] = value; }, { step: 0.01 });
  }
  fields.visible = field({ type: "boolean", default: object.visible }, () => object.visible, value => { object.visible = Boolean(value); });
  const mesh = object as Mesh;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const material = mesh.isMesh ? materials.find((candidate): candidate is MeshStandardMaterial => !!(candidate as MeshStandardMaterial)?.isMeshStandardMaterial) : undefined;
  const authoredTransparency = material?.transparent;
  if (material) {
    for (const key of ["opacity", "roughness", "metalness"] as const) {
      // Three accepts authored values outside the usual range. Preserve them until tracked.
      numeric(key, () => material[key], value => { material[key] = value; }, { min: Math.min(0, material[key]), max: Math.max(1, material[key]), step: 0.01 });
    }
    numeric("emissiveIntensity", () => material.emissiveIntensity, value => { material.emissiveIntensity = value; }, { step: 0.01 });
    color("color", material.color);
    color("emissive", material.emissive);
  }
  const light = object as Light;
  if (light.isLight) {
    numeric("intensity", () => light.intensity, value => { light.intensity = value; }, { step: 0.01 });
    color("color", light.color);
  }
  const camera = object as PerspectiveCamera;
  const target = camera.isPerspectiveCamera ? camera.getWorldDirection(new Vector3()).add(camera.getWorldPosition(new Vector3())) : undefined;
  if (target) {
    numeric("fov", () => camera.fov, value => { camera.fov = value; camera.updateProjectionMatrix(); }, { min: Math.min(1, camera.fov), max: Math.max(179, camera.fov), unit: "deg" });
    for (const axis of axes) numeric(`target.${axis}`, () => target[axis], value => { target[axis] = value; });
  }
  return { fields, material, authoredTransparency, target };
}

export function bindObject(runtime: ThreeRuntime, object: Object3D, id: string, options: Animatable3DSpec | undefined, token: symbol) {
  if (!object.isObject3D) throw new Error(`3D animatable "${id}" must reference a Three.js Object3D.`);
  if (!ANIMATABLE_ID_PATTERN.test(id) || id.length > 80) throw new Error(`Invalid 3D object id "${id}". Use lowercase letters, numbers, hyphens and dots (max 80 characters).`);
  const prefix = `three:${id}`;
  if (runtime.objects.has(prefix)) throw new Error(`Duplicate 3D object id "${id}" in ThreeSurface "${runtime.owner}".`);
  const { fields, material, authoredTransparency, target } = bindFields(object);
  for (const key of Object.keys(options ?? {})) {
    if (!fields[key] || options?.[key]?.type !== fields[key].spec.type) throw new Error(`Invalid 3D animatable override "${key}" on "${id}".`);
  }
  const spec = ThreeAnimatableSpecSchema.parse(Object.fromEntries(Object.entries(fields).map(([key, binding]) => [key, options?.[key] ?? binding.spec])));
  const label = object.name || id;
  runtime.objects.set(prefix, object);
  runtime.registry.declareAnimatable(token, { id: prefix, spec, key: JSON.stringify(spec), explicitOwner: runtime.owner, kind: "three", label });

  const local = (channels: FrameInput["channels"]) => {
    if (!object.matrixAutoUpdate) return object.matrix;
    const number = (key: string) => {
      const binding = fields[key];
      const value = channels[animatableChannel(prefix, key)];
      return value === undefined ? Number(binding.base) : Number(coerceAnimatable(spec, key, value));
    };
    const position = new Vector3(...axes.map(axis => number(`position.${axis}`)));
    const rotation = new Euler(number("rotation.x") / degrees, number("rotation.y") / degrees, number("rotation.z") / degrees, object.rotation.order);
    const scale = new Vector3(...axes.map(axis => number(`scale.${axis}`)));
    return new Matrix4().compose(position, new Quaternion().setFromEuler(rotation), scale);
  };
  runtime.transforms.set(object, local);
  const releaseAnchor = runtime.unified ? runtime.registry.registerAnchor(token, id, channels => {
    const point = new Vector3();
    for (let node: Object3D | null = object; node; node = node.parent) {
      const sampled = runtime.transforms.get(node)?.(channels);
      const matrix = sampled ?? (node.matrixAutoUpdate ? new Matrix4().compose(node.position, node.quaternion, node.scale) : node.matrix);
      point.applyMatrix4(matrix);
    }
    return asStagePoint(point);
  }) : undefined;

  const release = runtime.register(frame => {
    let hasTarget = false;
    let hasOpacity = false;
    for (const [key, binding] of Object.entries(fields)) {
      const channel = animatableChannel(prefix, key);
      const tracked = (spec[key].type === "color" ? frame.colorChannels : frame.channels)[channel];
      const current = binding.read();
      if (!Object.is(current, binding.last)) binding.base = current;
      const next = tracked === undefined ? binding.base : coerceAnimatable(spec, key, tracked);
      if (!Object.is(next, current)) binding.write(next);
      binding.last = binding.read();
      hasTarget ||= tracked !== undefined && key.startsWith("target.");
      hasOpacity ||= tracked !== undefined && key === "opacity";
    }
    if (target && hasTarget) {
      object.lookAt(target);
      for (const axis of axes) fields[`rotation.${axis}`].last = object.rotation[axis] * degrees;
    }
    if (material && authoredTransparency !== undefined) {
      const transparent = authoredTransparency || (hasOpacity && material.opacity < 1);
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
    }
  });
  return () => {
    release();
    releaseAnchor?.();
    runtime.objects.delete(prefix);
    runtime.transforms.delete(object);
    runtime.registry.releaseAnimatable(token);
    for (const binding of Object.values(fields)) {
      if (Object.is(binding.read(), binding.last) && !Object.is(binding.last, binding.base)) binding.write(binding.base);
    }
    if (material && authoredTransparency !== undefined && material.transparent !== authoredTransparency) {
      material.transparent = authoredTransparency;
      material.needsUpdate = true;
    }
  };
}

/** Expose a bound Object3D's native properties as timeline channels. Rotation is authored in degrees. */
export function useAnimatable3D<T extends Object3D>(ref: RefObject<T | null>, id: string, spec?: Animatable3DSpec): void {
  const runtime = useThreeRuntime();
  const [token] = useState(() => Symbol("three-object"));
  const binding = useRef<{ object: T; release(): void } | undefined>(undefined);
  const specKey = JSON.stringify(spec);
  useLayoutEffect(() => {
    const object = ref.current;
    if (object) binding.current = { object, release: bindObject(runtime, object, id, spec, token) };
    return () => { binding.current?.release(); binding.current = undefined; };
  }, [runtime, ref, id, specKey, token]);
  useLayoutEffect(() => {
    const object = ref.current;
    if (binding.current?.object === object) return;
    binding.current?.release();
    binding.current = object ? { object, release: bindObject(runtime, object, id, spec, token) } : undefined;
  });
}

type BoundChild = ReactElement<{ ref?: Ref<Object3D> }>;
export type AnimatedProps = { id: string; spec?: Animatable3DSpec; children: BoundChild };
export function Animated({ id, spec, children }: AnimatedProps) {
  const object = useRef<Object3D | null>(null);
  useAnimatable3D(object, id, spec);
  const original = children.props.ref;
  return cloneElement(children, {
    ref(value) {
      object.current = value;
      if (typeof original === "function") {
        const cleanup = original(value);
        if (typeof cleanup === "function") return () => { object.current = null; cleanup(); };
      } else if (original) original.current = value;
    },
  });
}
