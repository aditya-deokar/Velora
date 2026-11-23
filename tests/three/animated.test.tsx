import { expect, it } from "vitest";
import type { RootState } from "@react-three/fiber";
import { Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from "three";
import { CameraSchema } from "../../src/core";
import { projectWorld } from "../../src/core/spatial";
import { createRegistry } from "../../src/react/registry";
import { applyVeloraCamera } from "../../src/three/camera";
import { bindObject } from "../../src/three/animated";
import { ThreeRuntime } from "../../src/three/runtime";

it("keeps 3D metadata serializable and maps a camera pose with rotation and zoom", () => {
  const registry = createRegistry();
  const token = Symbol();
  registry.declareAnimatable(token, { id: "three:hero", explicitOwner: "world", kind: "three", key: "test",
    spec: { "position.x": { type: "number", default: 5 } } });
  expect(registry.animatables.get("three:hero")).toMatchObject({ id: "three:hero", kind: "three", owner: "world" });
  const remove = registry.registerAnchor(token, "hero", channels => [channels.x ?? 5, -20, 0]);
  expect(registry.sampleAnchors({ x: 50 }).get("hero")).toEqual([50, -20, 0]);
  remove();
  expect(registry.sampleAnchors({}).size).toBe(0);
  const camera = new PerspectiveCamera();
  const view = CameraSchema.parse({ perspective: 800, x: 80, y: -40, z: 120, rotateX: 11, rotateY: -17, rotateZ: 3 });
  applyVeloraCamera(camera, view, 640, 360);
  const point = new Vector3(100, 40, 60).project(camera);
  const dom = projectWorld(view, { width: 640, height: 360 }, [100, -40, 60])!;
  expect((point.x + 1) * 320).toBeCloseTo(dom.x, 8);
  expect((1 - point.y) * 180).toBeCloseTo(dom.y, 8);
  const prior = camera.fov;
  applyVeloraCamera(camera, { ...view, zoom: 2 }, 640, 360);
  expect(camera.fov).toBeLessThan(prior);
});

it("applies object channels before advancing and restores their authored values when tracks go away", () => {
  const registry = createRegistry();
  const runtime = new ThreeRuntime(registry, "world", false);
  const material = new MeshStandardMaterial({ color: "#114477", opacity: 0.9 });
  const mesh = new Mesh(undefined, material);
  mesh.position.set(7, 9, 11);
  mesh.rotation.y = 0.37;
  const drop = bindObject(runtime, mesh, "hero", undefined, Symbol());
  const frames: [number, number, number, string][] = [];
  const state = {
    size: { width: 640, height: 360 }, viewport: { dpr: 1 }, camera: new PerspectiveCamera(),
    gl: { domElement: { closest: () => null, dataset: {} } },
    advance: (seconds: number) => frames.push([seconds, mesh.position.x, mesh.position.y, material.color.getHexString()]),
  } as unknown as RootState;
  const channels = { "three:hero.position.x": 20, "three:hero.rotation.y": 180, "three:hero.opacity": 0.2 };
  const colorChannels = { "three:hero.color": "rgb(255, 128, 0)" };
  runtime.render({ seconds: 1, seed: 0, channels, colorChannels }, state);
  expect(frames).toEqual([[1, 20, 9, "ff8000"]]);
  expect(mesh.rotation.y).toBeCloseTo(Math.PI);
  expect(material.transparent).toBe(true);
  runtime.render({ seconds: 0, seed: 0, channels: {}, colorChannels: {} }, state);
  expect(frames.at(-1)).toEqual([0, 7, 9, "114477"]);
  expect(mesh.rotation.y).toBeCloseTo(0.37);
  expect(material.opacity).toBe(0.9);
  expect(material.transparent).toBe(false);
  drop();
  expect(registry.animatables.size).toBe(0);
});
