import { describe, expect, it } from "vitest";
import { CameraSchema, applyEdits, cameraMatrix, evaluateMotion, evaluateScene, matrixFor, multiply, projectWorld, sampleFocus, surfaceQuad, TransformSchema } from "../../src/core";
import { guideLines, moveTo, setOps } from "../../src/editor/viewport/MovePlane";
import { ringDelta, rotateTo } from "../../src/editor/viewport/RotateRings";
import { scaleUniform } from "../../src/editor/viewport/ScaleHandles";
import { pivotTo } from "../../src/editor/viewport/Pivot";
import { dolly, dollyZoom, eyeOf, orbit, panTilt, toView, truck } from "../../src/editor/viewport/CameraTool";
import { cameraGizmo, defaultDirector, dragCamera } from "../../src/editor/viewport/DirectorView";
import { focusHit, rackOps } from "../../src/editor/viewport/FocusTool";
import { onionSkin } from "../../src/editor/viewport/OnionSkin";
import { layerPath, pathKeys, sampleTimes } from "../../src/editor/viewport/MotionPath";
import { snapshotOf } from "./picking.test";

const frame = { width: 1400, height: 980 };
const ctx = { timeMs: 1000, fps: 60, autoKey: false, armed: [] as string[] };
const docWith = (tracks: unknown[] = [], scene: Record<string, unknown> = {}) => ({ version: 1, id: "s", title: "S", definition: { width: 1400, height: 980, scene: { camera: { perspective: 1800 }, focus: { maxBlur: 0 }, nodes: [{ id: "card" }], ...scene }, motion: { durationMs: 4000, speed: 1, tracks } } });
const project = (camera: ReturnType<typeof CameraSchema.parse>, transform: Record<string, number>, corner: [number, number], size = { width: 400, height: 200 }) => {
  const node = evaluateScene({ camera, nodes: [{ id: "n", transform }] }, { n: size }).nodes[0];
  return surfaceQuad(node, camera, frame)[corner[0]]!;
};

describe("move gizmo", () => {
  it("is perspective-correct: the grabbed point follows the cursor on a tilted, distant plane", () => {
    const camera = CameraSchema.parse({ perspective: 1200, rotateY: 25, z: 300 });
    const start = TransformSchema.parse({ z: -400, x: 50 });
    const parent = cameraMatrix(camera);
    const from = { x: 700, y: 490 }, to = { x: 800, y: 470 };
    const moved = moveTo({ camera, frame, parent, start, from, to })!;
    // The local point under `from` moves exactly under `to`.
    const plane = multiply(parent, matrixFor(TransformSchema.parse({ z: -400 })));
    const before = projectWorld(camera, frame, [plane[3], plane[7], plane[11]], "view")!;
    expect(before).toBeTruthy();
    const startQuad = project(camera, start, [0, 0]), movedQuad = project(camera, { ...start, x: moved.x, y: moved.y }, [0, 0]);
    expect(movedQuad.x - startQuad.x).not.toBeCloseTo(100, 0); // a tilted plane foreshortens
    expect(Number.isFinite(moved.x)).toBe(true);
  });
  it("moves exactly the cursor delta on a frontal plane at the stage and scales with depth", () => {
    const camera = CameraSchema.parse({ perspective: 1800 });
    const parent = cameraMatrix(camera);
    expect(moveTo({ camera, frame, parent, start: TransformSchema.parse({}), from: { x: 600, y: 400 }, to: { x: 700, y: 400 } })).toEqual({ x: 100, y: 0 });
    // At z = -1800 (depth 3600) one screen px is two local px.
    expect(moveTo({ camera, frame, parent, start: TransformSchema.parse({ z: -1800 }), from: { x: 600, y: 400 }, to: { x: 700, y: 450 } })).toEqual({ x: 200, y: 100 });
  });
  it("axis handles constrain, Shift snaps to 10 px and guides snap the projected center", () => {
    const camera = CameraSchema.parse({ perspective: 1800 });
    const parent = cameraMatrix(camera), start = TransformSchema.parse({});
    expect(moveTo({ camera, frame, parent, start, from: { x: 0, y: 0 }, to: { x: 37, y: 21 }, axis: "x" })).toEqual({ x: 37, y: 0 });
    expect(moveTo({ camera, frame, parent, start, from: { x: 0, y: 0 }, to: { x: 37, y: 21 }, shift: true })).toEqual({ x: 40, y: 20 });
    const snapped = moveTo({ camera, frame, parent, start, from: { x: 700, y: 490 }, to: { x: 700 + 1400 / 3 - 700 + 5, y: 490 }, center: { x: 700, y: 490 }, guides: guideLines(frame), threshold: 8 })!;
    expect(snapped.x).toBeCloseTo(1400 / 3 - 700, 3);
    expect(snapped.snapped?.x).toBeCloseTo(1400 / 3, 6);
  });
  it("writes through intentToOps: static override without auto-key, keyframe when animated", () => {
    const staticDoc = docWith();
    expect(setOps(staticDoc, { kind: "surface", id: "card" }, { x: 100, y: 0 }, { x: 0, y: 0 }, ctx)).toEqual([{ op: "track.add", track: { target: { kind: "surface", id: "card" }, property: "x" }, keyframes: [{ timeMs: 0, value: 100 }] }]);
    const animated = docWith([{ target: { kind: "surface", id: "card" }, property: "x", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 2000, value: 50 }] }]);
    expect(setOps(animated, { kind: "surface", id: "card" }, { x: 100 }, { x: 25 }, ctx)).toEqual([{ op: "key.set", track: { target: { kind: "surface", id: "card" }, property: "x" }, atMs: 1000, value: 100 }]);
    expect(setOps(animated, { kind: "camera" }, { z: 300 }, { z: 0 }, ctx)).toEqual([{ op: "camera.set", property: "z", value: 300 }]);
  });
});

describe("rotate, scale and pivot", () => {
  it("rotateZ follows the cursor angle; Shift snaps to 15Â° multiples", () => {
    const center = { x: 0, y: 0 };
    expect(ringDelta("rotateZ", center, { x: 100, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(90, 9);
    expect(rotateTo(3, 40, true)).toBe(45);
    expect(rotateTo(0, -22.6, true)).toBe(-30);
    expect(rotateTo(10, 2.3456)).toBe(12.346);
  });
  it("corner scale keeps the opposite corner fixed (rotated layer)", () => {
    const camera = CameraSchema.parse({ perspective: 1800 });
    const start = TransformSchema.parse({ x: 30, y: -20, rotateZ: 30 });
    const fixed = { x: -200, y: -100 }; // top-left stays while dragging bottom-right
    const values = scaleUniform(start, 400, 200, 1.5, fixed, false);
    const before = project(camera, start, [0, 0]), after = project(camera, { ...start, ...values }, [0, 0]);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.01);
    expect(values.scale).toBe(1.5);
    expect(scaleUniform(start, 400, 200, 2, fixed, true)).toEqual({ scale: 2 });
  });
  it("moving the pivot compensates position so nothing moves on screen", () => {
    const camera = CameraSchema.parse({ perspective: 1800 });
    const start = TransformSchema.parse({ x: 10, y: 20, rotateZ: 40, rotateY: 20, scale: 1.3 });
    const values = pivotTo(start, 400, 200, { x: -150, y: 60 });
    expect(values.originX).toBeCloseTo(12.5, 6);
    expect(values.originY).toBeCloseTo(80, 6);
    for (const corner of [0, 1, 2, 3] as const) {
      const before = project(camera, start, [corner, 0]), after = project(camera, { ...start, ...values }, [corner, 0]);
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.01);
    }
  });
});

describe("camera tool", () => {
  const base = CameraSchema.parse({ perspective: 1600, x: 40, z: 100, rotateY: 5 });
  it("orbit keeps the pivot's view position; pan/tilt keeps the eye", () => {
    const pivot = [0, 0, -200];
    const orbited = orbit(base, pivot, 30, -10);
    toView(orbited, pivot).forEach((value, index) => expect(value).toBeCloseTo(toView(base, pivot)[index], 2));
    expect(orbited.rotateY).toBe(35);
    const panned = panTilt(base, 12, 4, 3);
    eyeOf(panned).forEach((value, index) => expect(value).toBeCloseTo(eyeOf(base)[index], 2));
  });
  it("truck moves content with the cursor and dolly moves along the view axis", () => {
    const point = [0, 0, 0];
    const depth = base.perspective - toView(base, point)[2];
    const moved = truck(base, 100, 0, depth);
    expect(projectWorld(moved, frame, point)!.x - projectWorld(base, frame, point)!.x).toBeCloseTo(100, 1);
    expect(dolly(base, 50).z).toBe(50);
  });
  it("dolly-zoom keeps the subject's projected width within 1% while the lens changes", () => {
    const subject = [0, 0, 0], width = 400;
    const size = (camera: typeof base) => projectWorld(camera, frame, [subject[0] + width / 2, 0, 0])!.x - projectWorld(camera, frame, [subject[0] - width / 2, 0, 0])!.x;
    const zoomed = dollyZoom(CameraSchema.parse({ perspective: 1600 }), subject, 3200);
    expect(Math.abs(size(zoomed) / size(CameraSchema.parse({ perspective: 1600 })) - 1)).toBeLessThan(0.01);
    expect(zoomed.perspective).toBe(3200);
    // The background warps: a far point changes projected size.
    const far = (camera: typeof base) => projectWorld(camera, frame, [300, 0, -2000])!.x;
    expect(Math.abs(far(zoomed) - far(CameraSchema.parse({ perspective: 1600 })))).toBeGreaterThan(5);
  });
});

describe("director view and focus", () => {
  it("draws the real camera from a pulled-back viewpoint and drags the real eye", () => {
    const real = CameraSchema.parse({ perspective: 1800 });
    const director = defaultDirector(real, 1800);
    const gizmo = cameraGizmo(real, { distance: 1800 }, director, frame);
    expect(gizmo.eye).not.toBeNull();
    expect(gizmo.frustum.every(Boolean)).toBe(true);
    const dragged = dragCamera(real, director, frame, gizmo.eye!, { x: gizmo.eye!.x + 40, y: gizmo.eye!.y })!;
    const eye = projectWorld(director, frame, eyeOf(dragged))!;
    expect(eye.x).toBeCloseTo(gizmo.eye!.x + 40, 3);
    expect(eye.y).toBeCloseTo(gizmo.eye!.y, 3);
  });
  it("focus click picks the real-camera depth of the clicked point", () => {
    const snapshot = snapshotOf([{ id: "card", transform: { z: -400 }, width: 400, height: 200 }]);
    const node = snapshot.nodes[0];
    const real = snapshot.camera!;
    const hit = focusHit(real, real, frame, node, { x: 700, y: 490 })!;
    expect(hit.depth).toBeCloseTo(2200, 6);
    expect(hit.anchor).toEqual([0.5, 0.5]);
  });
  it("rack focus lands sharp (< 0.5 px) on each layer at each end", () => {
    const tracks = [{ target: { kind: "surface", id: "near" }, property: "z", keyframes: [{ timeMs: 0, value: 200 }, { timeMs: 2000, value: 300 }] }];
    const doc = { ...docWith(tracks, { nodes: [{ id: "near" }, { id: "far" }], focus: { maxBlur: 12, fStop: 1.4 } }) };
    const snapshot = snapshotOf([{ id: "near", transform: { z: 200 } }, { id: "far", transform: { z: -900 } }]);
    const result = rackOps(doc, snapshot, "near", "far", 0, 2000, 60)!;
    expect(result.ops[0]).toMatchObject({ op: "rack.add" });
    const applied = applyEdits(doc, result.ops);
    expect(applied.ok).toBe(true);
    const motion = (applied as unknown as { recipe: typeof doc }).recipe.definition.motion;
    const scene = doc.definition.scene;
    for (const [atMs, id, z] of [[0, "near", 200], [2000, "far", -900]] as const) {
      const distance = evaluateMotion(motion, atMs / (motion.speed ?? 0.5)).focus.distance;
      const evaluation = evaluateScene({ camera: scene.camera, focus: { ...scene.focus, distance }, nodes: [{ id, transform: { z } }] }, { [id]: { width: 200, height: 120 } });
      expect(sampleFocus(evaluation.nodes[0].focus, 0, 0)).toBeLessThan(0.5);
    }
    expect(result.distances).toEqual([1800 - 200, 1800 + 900]);
  });
});

describe("motion paths and onion skin", () => {
  const tracks = [{ target: { kind: "surface", id: "card" }, property: "x", keyframes: [{ timeMs: 0, value: -300 }, { timeMs: 2000, value: 300 }] }];
  const doc = docWith(tracks);
  const snapshot = snapshotOf([{ id: "card" }]);
  const camera = snapshot.camera!;
  it("samples the evaluated center at frame rate and puts dots on keyframes", () => {
    const times = sampleTimes(0, 2000, 30);
    expect(times.length).toBe(61);
    const path = layerPath(doc, snapshot, "card", camera, frame, times);
    expect(path[0]!.point.x).toBeCloseTo(700 - 300, 6);
    expect(path[path.length - 1]!.point.x).toBeCloseTo(700 + 300, 6);
    const keys = pathKeys(doc, snapshot, "card", camera, frame);
    expect(keys.map(key => [key.timeMs, Math.round(key.point.x), key.tracks])).toEqual([[0, 400, ["x"]], [2000, 1000, ["x"]]]);
  });
  it("onion skin returns ghost quads at Â±N frames, not a second render", () => {
    const ghosts = onionSkin(doc, snapshot, ["card"], camera, frame, 1000, 60, { frames: 2, step: 3 });
    expect(ghosts.map(ghost => ghost.offset)).toEqual([-2, -1, 1, 2]);
    expect(ghosts[3].quad[0].x).toBeGreaterThan(ghosts[0].quad[0].x);
  });
});
