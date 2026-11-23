import { describe, expect, it } from "vitest";
import { evaluateMotion, MotionSchema, type MotionInput } from "../../src/core/motion";
import { orientAngles } from "../../src/core/paths";
import { reviewAuthoring } from "../../src/core/authoring";

const path = (keys: [number, [number, number, number], string?][], extra: object = {}, target: object = { kind: "surface", id: "a" }) =>
  ({ durationMs: 4000, speed: 1, tracks: [{ target, property: "position", keyframes: keys.map(([timeMs, value, easing]) => ({ timeMs, value, easing: easing ?? "linear" })), ...extra }] }) as MotionInput;
const at = (input: MotionInput, t: number) => { const s = evaluateMotion(input, t).surfaces.a; return [s.x!, s.y!, s.z!]; };
const curve = path([[0, [0, 0, 0]], [1000, [300, 100, 0]], [2500, [400, 400, -200]], [4000, [0, 500, 0]]]);

describe("position paths", () => {
  it("passes through every keyframe and holds outside", () => {
    expect(at(curve, 0)).toEqual([0, 0, 0]);
    for (const [t, v] of [[1000, [300, 100, 0]], [2500, [400, 400, -200]], [4000, [0, 500, 0]]] as const) at(curve, t).forEach((value, i) => expect(value).toBeCloseTo(v[i], 6));
  });
  it("keeps the direction continuous at joins with auto tangents (G1)", () => {
    const h = 0.01;
    for (const t of [1000, 2500]) {
      const before = at(curve, t).map((v, i) => v - at(curve, t - h)[i]), after = at(curve, t + h).map((v, i) => v - at(curve, t)[i]);
      const unit = (v: number[]) => v.map(c => c / Math.hypot(...v));
      unit(before).forEach((c, i) => expect(c).toBeCloseTo(unit(after)[i], 3));
    }
  });
  it("moves at constant speed with rove (variance < 1%)", () => {
    const roving = path([[0, [0, 0, 0]], [500, [300, 100, 0]], [3500, [400, 400, -200]], [4000, [0, 500, 0]]], { rove: true });
    const speeds: number[] = [];
    for (let t = 40; t < 3960; t += 40) speeds.push(Math.hypot(...at(roving, t + 40).map((v, i) => v - at(roving, t)[i])));
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    expect(Math.max(...speeds.map(v => Math.abs(v - mean) / mean))).toBeLessThan(0.01);
  });
  it("maps easing to distance along a segment", () => {
    const straight = path([[0, [0, 0, 0], "quad.in"], [1000, [100, 0, 0]]]);
    expect(at(straight, 500)[0]).toBeCloseTo(25, 1);
  });
  it("orients yaw and pitch to the path tangent", () => {
    const oriented = path([[0, [0, 0, 0]], [1000, [300, 100, 0]], [2500, [400, 400, -200]], [4000, [0, 500, 0]]], { orient: { axis: "yaw-pitch", offsetDeg: 0 } });
    for (const t of [400, 1700, 3100]) {
      const s = evaluateMotion(oriented, t).surfaces.a;
      const h = 0.01, d = at(oriented, t + h).map((v, i) => v - at(oriented, t - h)[i]) as [number, number, number];
      const expected = orientAngles(d);
      expect(s.rotateY).toBeCloseTo(expected.yaw, 2);
      expect(s.rotateX).toBeCloseTo(expected.pitch, 2);
    }
  });
  it("accepts explicit tangents and camera targets", () => {
    const camera = path([[0, [0, 0, 0]], [1000, [100, 0, 0]]], {}, { kind: "camera" });
    const withTangent = { ...camera, tracks: [{ ...camera.tracks[0], keyframes: [{ timeMs: 0, value: [0, 0, 0], outTangent: [0, 200, 0] }, { timeMs: 1000, value: [100, 0, 0], inTangent: [0, 200, 0] }] }] } as MotionInput;
    expect(evaluateMotion(camera, 500).camera.x).toBeCloseTo(50, 6);
    expect(evaluateMotion(withTangent, 500).camera.y!).toBeGreaterThan(50);
  });
  it("rejects x/y/z tracks alongside a path, orient with rotate tracks, smooth and noise", () => {
    const base = path([[0, [0, 0, 0]], [1000, [1, 1, 1]]]);
    const add = (track: object) => ({ ...base, tracks: [...base.tracks, track] });
    expect(MotionSchema.safeParse(add({ target: { kind: "surface", id: "a" }, property: "x", keyframes: [{ timeMs: 0, value: 0 }] })).success).toBe(false);
    const oriented = path([[0, [0, 0, 0]], [1000, [1, 1, 1]]], { orient: { axis: "yaw" } });
    expect(MotionSchema.safeParse({ ...oriented, tracks: [...oriented.tracks, { target: { kind: "surface", id: "a" }, property: "rotateY", keyframes: [{ timeMs: 0, value: 0 }] }] }).success).toBe(false);
    expect(MotionSchema.safeParse({ ...oriented, tracks: [...oriented.tracks, { target: { kind: "surface", id: "a" }, property: "rotateX", keyframes: [{ timeMs: 0, value: 0 }] }] }).success).toBe(true);
    expect(MotionSchema.safeParse(path([[0, [0, 0, 0]]], { interpolation: "smooth" })).success).toBe(false);
    expect(MotionSchema.safeParse(path([[0, [0, 0, 0]]], { noise: { amplitude: 1 } })).success).toBe(false);
  });
  it("advises on speed spikes between segments", () => {
    const spiky = path([[0, [0, 0, 0]], [1000, [10, 0, 0]], [1100, [500, 0, 0]]]);
    expect(reviewAuthoring({ scene: { nodes: [{ id: "a" }] }, motion: spiky }).advice.map(a => a.code)).toContain("path-speed-spike");
    expect(reviewAuthoring({ scene: { nodes: [{ id: "a" }] }, motion: path([[0, [0, 0, 0]], [1000, [10, 0, 0]], [1100, [500, 0, 0]]], { rove: true }) }).advice.map(a => a.code)).not.toContain("path-speed-spike");
  });
});
