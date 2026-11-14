import { describe, expect, it } from "vitest";
import { evaluateScene, sampleFocus, cameraMatrix } from "../../src/core/spatial";
import { evaluateMotion, withAdditive, type MotionInput } from "../../src/core/motion";
import { buildOrbitRig, framingReport, projectPoints, type ShotDefinition } from "../../src/core/shots";
import { SceneSchema } from "../../src/core/scene";
import { createRng } from "../../src/core/random";

// Screen offset of a stage point from frame center for a resolved camera (cameraToCss convention).
function screenOffset(camera: { x: number; y: number; z: number; rotateX: number; rotateY: number; rotateZ: number; perspective: number }, p: number[]) {
  const m = cameraMatrix(camera);
  const q = [0, 1, 2].map(r => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]);
  const k = camera.perspective / (camera.perspective - q[2]);
  return { x: q[0] * k, y: q[1] * k, inFront: q[2] < camera.perspective };
}
const subject = { width: 800, height: 500, offsetX: 120, offsetY: -60 };
const scene = (camera: object, constraints: unknown[]) => ({ camera, focus: { distance: 1400, fStop: 2, focalLength: 50, maxBlur: 12 }, nodes: [{ id: "portrait", transform: { z: -150, rotateY: 10 } }], constraints });
describe("lookAt", () => {
  it("keeps the anchor at frame center within 0.5 px across random curved camera paths", () => {
    const rng = createRng(11);
    for (let trial = 0; trial < 200; trial++) {
      const camera = { x: (rng() - 0.5) * 600, y: (rng() - 0.5) * 300, z: rng() * 500 - 250, rotateZ: (rng() - 0.5) * 10, perspective: 1400 + rng() * 1000 };
      const anchor: [number, number] = [rng(), rng()];
      const evaluation = evaluateScene(scene(camera, [{ kind: "lookAt", target: { surface: "portrait", anchor } }]), { portrait: subject });
      expect(evaluation.issues).toEqual([]);
      // The anchor in stage space: node stage world times the local anchor point.
      const local = [(anchor[0] - 0.5) * subject.width, (anchor[1] - 0.5) * subject.height, 0];
      const world = evaluation.nodes[0].world;
      const q = [0, 1, 2].map(r => world[r * 4] * local[0] + world[r * 4 + 1] * local[1] + world[r * 4 + 2] * local[2] + world[r * 4 + 3]);
      const k = evaluation.camera!.perspective / (evaluation.camera!.perspective - q[2]);
      expect(Math.abs(q[0] * k)).toBeLessThan(0.5);
      expect(Math.abs(q[1] * k)).toBeLessThan(0.5);
      expect(q[2]).toBeLessThan(evaluation.camera!.perspective);
    }
  });
  it("blends with weight: 0 keeps the authored rotation, 1 aims exactly", () => {
    const camera = { x: 200, rotateX: 3, rotateY: -4 };
    const none = evaluateScene(scene(camera, [{ kind: "lookAt", target: { point: [0, 0, 0] }, weight: 0 }]), { portrait: subject });
    expect([none.camera!.rotateX, none.camera!.rotateY]).toEqual([3, -4]);
    const full = evaluateScene(scene(camera, [{ kind: "lookAt", target: { point: [0, 0, 0] }, weight: 1 }]), { portrait: subject });
    const offset = screenOffset(full.camera!, [0, 0, 0]);
    expect(Math.abs(offset.x) + Math.abs(offset.y)).toBeLessThan(1e-6);
    const half = evaluateScene({ ...scene(camera, [{ kind: "lookAt", target: { point: [0, 0, 0] }, weight: { target: { kind: "channel", id: "settle" }, property: "value" } }]) }, { portrait: subject }, { channels: { settle: 0.5 } });
    expect(half.camera!.rotateY).toBeCloseTo((-4 + full.camera!.rotateY) / 2, 9);
  });
  it("leaves scenes without constraints unchanged and rejects unknown targets", () => {
    const plain = evaluateScene({ camera: { x: 5 }, nodes: [{ id: "a" }] });
    expect(plain.camera!.rotateY).toBe(0);
    expect(SceneSchema.safeParse({ nodes: [], constraints: [{ kind: "lookAt", target: { surface: "ghost" } }] }).success).toBe(false);
    expect(SceneSchema.safeParse({ nodes: [], constraints: Array.from({ length: 17 }, () => ({ kind: "focusFollow", target: { point: [0, 0, 0] } })) }).success).toBe(false);
  });
});
describe("focusFollow", () => {
  it("keeps the target sharp (< 0.5 px blur) at every sample while the camera dollies", () => {
    for (let z = -400; z <= 600; z += 50) {
      const evaluation = evaluateScene(scene({ x: 150, z }, [
        { kind: "lookAt", target: { surface: "portrait" } },
        { kind: "focusFollow", target: { surface: "portrait" } },
      ]), { portrait: subject });
      const node = evaluation.nodes[0];
      expect(sampleFocus(node.focus, 0, 0)).toBeLessThan(0.5);
    }
  });
  it("applies the offset and weight", () => {
    const exact = evaluateScene(scene({}, [{ kind: "focusFollow", target: { point: [0, 0, -100] } }]), {});
    expect(exact.focus!.distance).toBeCloseTo(1500, 9);
    const offset = evaluateScene(scene({}, [{ kind: "focusFollow", target: { point: [0, 0, -100] }, offset: 50 }]), {});
    expect(offset.focus!.distance).toBeCloseTo(1550, 9);
    const half = evaluateScene(scene({}, [{ kind: "focusFollow", target: { point: [0, 0, -100] }, weight: 0.5 }]), {});
    expect(half.focus!.distance).toBeCloseTo(1450, 9);
  });
});
describe("orbit rig", () => {
  it("compiles to a clip plus lookAt that keeps the subject centered and sharp for the whole move", () => {
    const rig = buildOrbitRig({ radius: 1100, fromDeg: -35, toDeg: 35, height: 250, durationMs: 6000, ease: "cinematic" });
    const definition: ShotDefinition = {
      width: 1920, height: 1080,
      scene: { camera: { perspective: 1400 }, focus: { distance: 1400, fStop: 2.8, focalLength: 85, maxBlur: 10 }, nodes: [{ id: "subject" }],
        constraints: [rig.constraint, { kind: "focusFollow", target: { surface: "subject" } }] },
      motion: { durationMs: 6000, speed: 1, tracks: [], clips: [rig.clip] } as MotionInput,
    };
    expect(evaluateMotion(definition.motion, 0).issues).toEqual([]);
    for (let t = 0; t <= 6000; t += 250) {
      const [center] = projectPoints(definition, [[0, 0, 0]], t);
      expect(Math.abs(center!.x - 960)).toBeLessThan(0.5);
      expect(Math.abs(center!.y - 540)).toBeLessThan(0.5);
    }
    const report = framingReport(definition, { width: 1440, height: 900 }, { focusRegion: { x: 620, y: 400, width: 200, height: 100 } });
    expect(report.worstRegionBlur).toBeLessThan(0.5);
    // The yaw sweeps through the requested arc.
    const yaws = [0, 3000, 6000].map(t => withAdditive(evaluateMotion(definition.motion, t).camera, undefined).rotateY);
    expect(yaws[0]).toBeCloseTo(-35, 6);
    expect(yaws[2]).toBeCloseTo(35, 6);
  });
});
