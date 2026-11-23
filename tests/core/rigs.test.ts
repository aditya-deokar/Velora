import { describe, expect, it } from "vitest";
import { applyEdits, buildDroneFlyover, buildTelephotoOrbit, buildWhipPan, buildShot, evaluateMotion, rigPose, rigSmoothness, rigClearance, simulateFollower, simplifyRigSamples, projectWorld, type RigLayer } from "../../src/core";
import { compilePath } from "../../src/core/paths";

const frame = { width: 960, height: 540 };
const target = { surface: "panel", anchor: "revenue" };
const destination = { surface: "panel", anchor: "conversion" };
const layer = (id: string, x: number, y: number, z: number, target?: RigLayer["target"]): RigLayer => ({
  id, target, point: [x, y, z],
  corners: [[x - 110, y - 65, z], [x + 110, y - 65, z], [x + 110, y + 65, z], [x - 110, y + 65, z]],
});
const hero = layer("hero", -120, -20, 25, target);
const other = layer("other", 180, 20, 60, destination);
const backdrop = layer("wall", 0, 0, -3800);
const layers = [hero, other, backdrop];

describe("physical camera rigs", () => {
  it("uses quantized fixed steps and agrees with a finer step on the same smooth flight", () => {
    const path = { durationMs: 2500, sample: (ms: number): [number, number, number] => [120 * Math.sin(ms / 1300), 0, 0] };
    const params = { frequencyHz: 1, dampingRatio: 0.95 };
    const a = simulateFollower(path, params), b = simulateFollower(path, params, { stepHz: 480 });
    expect(a).toEqual(simulateFollower(path, params));
    expect(Math.max(...a.map((sample, i) => Math.abs(sample.value[0] - b[2 * i].value[0])))).toBeLessThan(0.5);
  });

  it("bakes continuous paths and additive bank with stable bytes", () => {
    const params = { waypoints: [[-240, 0, 0], [0, -80, 0], [250, 0, 0]] as [number, number, number][], altitude: 230, durationMs: 5000 };
    const result = buildDroneFlyover(params, { frame });
    expect(JSON.stringify(buildDroneFlyover(params, { frame }))).toBe(JSON.stringify(result));
    const bank = result.clip.clips![0];
    expect(bank.mode).toBe("add");
    const rolls = bank.tracks![0].keyframes.map(key => Number(key.value));
    expect(Math.max(...rolls.map(Math.abs))).toBeGreaterThan(0);
    expect(Math.max(...rolls.map(Math.abs))).toBeLessThanOrEqual(6);
    expect(rolls[0]).toBe(0);
    expect(rolls.at(-1)).toBe(0);
    const report = rigSmoothness(result.definition);
    expect(report.maxVelocityDiscontinuity).toBeLessThan(0.05);
    expect(report.peakJerk).toBeLessThanOrEqual(report.threshold);
    expect(evaluateMotion(result.definition.motion, 2200).issues).toEqual([]);
    const straight = buildDroneFlyover({ ...params, waypoints: [[-200, 0, 0], [200, 0, 0]] }, { frame });
    expect(straight.clip.clips![0].tracks![0].keyframes.every(key => Math.abs(Number(key.value)) < 0.05)).toBe(true);
    const mirrored = buildDroneFlyover({ ...params, waypoints: [[-240, 0, 0], [0, 80, 0], [250, 0, 0]] }, { frame });
    expect(mirrored.clip.clips![0].tracks![0].keyframes.map(key => Number(key.value))).toEqual(rolls.map(roll => -roll || 0));
  });

  it("keeps the simplified parametric curve within a quarter pixel of the input samples", () => {
    const input = Array.from({ length: 121 }, (_, i) => ({ timeMs: i * 1000 / 60,
      value: [Math.sin(i / 21) * 120, i, 0] as [number, number, number], velocity: [Math.cos(i / 21) * 120 / 350, 0.06, 0] as [number, number, number] }));
    const retained = simplifyRigSamples(input, 0.25);
    expect(retained.length).toBeLessThan(input.length / 2);
    const curve = compilePath(retained.map((sample, i) => ({ timeMs: sample.timeMs, value: sample.value, progress: (u: number) => u,
      ...(i > 0 ? { inTangent: sample.velocity.map(v => v * (retained[i - 1].timeMs - sample.timeMs) / 3) as typeof sample.value } : {}),
      ...(i + 1 < retained.length ? { outTangent: sample.velocity.map(v => v * (retained[i + 1].timeMs - sample.timeMs) / 3) as typeof sample.value } : {}),
    })), false, true);
    for (const sample of input) expect(Math.hypot(...curve.sample(sample.timeMs).point.map((n, i) => n - sample.value[i]))).toBeLessThanOrEqual(0.25);
  });

  it("locks the telephoto target and predicts parallax with the existing projection", () => {
    const rig = buildTelephotoOrbit({ target, arcDeg: 36, durationMs: 2600 }, { frame, layers });
    const seen: { x: number; y: number }[] = [];
    for (let t = 0; t <= 2600; t += 1000 / 60) {
      const { camera, focus } = rigPose(rig.definition, t, layers);
      const p = projectWorld(camera, frame, hero.point)!;
      expect(p.x).toBeCloseTo(frame.width / 2, 4);
      expect(p.y).toBeCloseTo(frame.height / 2, 4);
      expect(focus.distance).toBeCloseTo(p.depth, 4);
      seen.push(projectWorld(camera, frame, backdrop.point)!);
    }
    const peak = Math.max(...seen.map(p => Math.hypot(p.x - seen[0].x, p.y - seen[0].y)));
    expect(Math.abs(rig.parallax!.find(p => p.id === "wall")!.peakPx / peak - 1)).toBeLessThan(0.05);
    expect(buildShot({ kind: "telephoto-orbit", focusTarget: target }, { layers }).motion.clips![0].source).toMatchObject({ rig: "telephoto-parallax-orbit" });
  });

  it("switches whip focus at the velocity peak and bounds the spring overshoot", () => {
    for (const settle of ["organic", "none"] as const) {
      const rig = buildWhipPan({ from: target, to: destination, settle }, { frame, layers });
      expect(rig.overshoot!).toBeLessThanOrEqual(settle === "organic" ? 0.02001 : 0);
      expect(rig.peakMs).toBeGreaterThan(0);
      expect(rig.peakMs).toBeLessThan(rig.definition.motion.durationMs);
      for (const [t, point] of [[0, hero], [rig.definition.motion.durationMs, other]] as const) {
        const { camera, focus } = rigPose(rig.definition, t, layers);
        const p = projectWorld(camera, frame, point.point)!;
        expect(p.x).toBeCloseTo(frame.width / 2, 4);
        expect(p.depth).toBeCloseTo(focus.distance, 4);
      }
    }
  });

  it("bakes, updates, and undoes as a single recipe edit", () => {
    const recipe = { version: 1, id: "demo", title: "Demo", definition: { ...frame, scene: { nodes: [{ id: "panel" }], camera: { rotateZ: 3 } } } };
    const apply = applyEdits(recipe, [{ op: "rig.apply", kind: "telephoto-parallax-orbit", params: { target }, geometry: layers }]);
    expect(apply.ok, JSON.stringify(apply)).toBe(true);
    if (!apply.ok) return;
    const update = applyEdits(apply.recipe, [{ op: "rig.update", clipId: "camera-rig", params: { arcDeg: 40 }, geometry: layers }]);
    expect(update.ok, JSON.stringify(update)).toBe(true);
    if (!update.ok) return;
    expect(applyEdits(update.recipe, update.inverse)).toMatchObject({ ok: true, recipe: apply.recipe });
    expect(applyEdits(apply.recipe, apply.inverse)).toMatchObject({ ok: true, recipe });
  });

  it("rejects an obstructed through-flight", () => {
    const through = { waypoints: [[-120, 0, 0], [120, 0, 0]] as [number, number, number][], altitude: 30, through: true };
    expect(() => buildDroneFlyover(through, { frame, layers: [layer("obstacle", 0, 0, 20)] })).toThrow(/clearance/i);
    expect(rigClearance({ scene: { nodes: [], camera: { perspective: 400 } } }, [layer("wall", 0, 0, 390)]).minimum).toBeCloseTo(10);
  });
});
