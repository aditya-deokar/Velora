import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateMotion, loopSeam, motionDuration, MotionSchema, MotionTrackSchema } from "../../src/core/motion";
import { reviewAuthoring } from "../../src/core/authoring";
import { sampleNoise } from "../../src/core/noise";

const golden = JSON.parse(readFileSync(new URL("./fixtures/motion-golden.json", import.meta.url), "utf8")) as Record<string, { timeMs: number; state: object }[]>;
const motion = (tracks: unknown[], extra: object = {}) => ({ durationMs: 4000, speed: 1, tracks, ...extra });
const camera = (property: string, values: [number, number][], options: Record<string, unknown> = {}) =>
  ({ target: { kind: "camera" }, property, keyframes: values.map(([timeMs, value]) => ({ timeMs, value })), ...options });

describe("backward compatibility", () => {
  it.each(Object.keys(golden))("%s evaluates byte-identically to the pre-v2 engine", file => {
    const input = JSON.parse(readFileSync(file, "utf8")).definition.motion;
    expect(motionDuration(input)).toBeGreaterThanOrEqual(0);
    for (const { timeMs, state } of golden[file]) {
      const { issues, channels, ...current } = evaluateMotion(input, timeMs);
      expect(issues).toEqual([]);
      expect(channels).toEqual({});
      expect(current).toEqual(state);
    }
  });
  it("parses existing motion without adding fields", () => {
    const input = motion([camera("x", [[0, 0], [4000, 100]])]);
    expect(MotionSchema.parse(input)).toEqual({ ...input, tracks: [{ ...(input.tracks[0] as object), keyframes: [{ timeMs: 0, value: 0, easing: "cinematic" }, { timeMs: 4000, value: 100, easing: "cinematic" }] }] });
  });
});

describe("smooth paths", () => {
  const rail = camera("x", [[0, 0], [1000, 100], [2500, 150], [3000, 400], [4000, 420]], { interpolation: "smooth" });
  const at = (track: unknown, t: number) => evaluateMotion(motion([track]), t).camera.x!;
  it("passes through every waypoint at its time", () => {
    for (const [t, v] of [[0, 0], [1000, 100], [2500, 150], [3000, 400], [4000, 420]]) expect(at(rail, t)).toBeCloseTo(v, 9);
  });
  it("keeps velocity continuous through waypoints instead of stopping", () => {
    const velocity = (t: number) => (at(rail, t + 0.01) - at(rail, t - 0.01)) / 0.02;
    for (const waypoint of [1000, 2500, 3000]) {
      expect(Math.abs(velocity(waypoint - 1) - velocity(waypoint + 1))).toBeLessThan(0.01);
      expect(Math.abs(velocity(waypoint))).toBeGreaterThan(0.01);
    }
    // The segment model, by contrast, stops at every cinematic keyframe.
    const segments = camera("x", [[0, 0], [1000, 100], [2000, 300]]);
    expect(Math.abs(at(segments, 1000.01) - at(segments, 999.99))).toBeLessThan(1e-6);
  });
  it("never overshoots between monotonic waypoints", () => {
    for (let t = 0; t <= 4000; t += 10) {
      const value = at(rail, t);
      expect(value).toBeGreaterThanOrEqual(-1e-9);
      expect(value).toBeLessThanOrEqual(420 + 1e-9);
    }
  });
  it("applies one track ease across the whole span", () => {
    const eased = { ...rail, ease: "cinematic" };
    expect(at(eased, 0)).toBe(0);
    expect(at(eased, 4000)).toBe(420);
    expect(at(eased, 200)).toBeLessThan(at(rail, 200));
    expect(Math.abs(at(eased, 1) - at(eased, 0))).toBeLessThan(1e-4);
  });
  it("rejects a track ease on a segment track", () => {
    expect(MotionTrackSchema.safeParse({ ...camera("x", [[0, 0], [10, 1]]), ease: "cinematic" }).success).toBe(false);
  });
});

describe("lens animation, noise and channels", () => {
  it("animates camera perspective for a dolly zoom", () => {
    const state = evaluateMotion(motion([camera("perspective", [[0, 3800], [4000, 1400]], { interpolation: "smooth" })]), 4000);
    expect(state.camera.perspective).toBe(1400);
    expect(MotionTrackSchema.safeParse(camera("perspective", [[0, 50]])).success).toBe(false);
  });
  it("adds deterministic seeded noise to position and rotation tracks only", () => {
    const shaky = camera("x", [[0, 0], [4000, 0]], { noise: { amplitude: 10, frequency: 2, seed: 7 } });
    const a = evaluateMotion(motion([shaky]), 1234).camera.x!;
    expect(evaluateMotion(motion([shaky]), 1234).camera.x).toBe(a);
    expect(a).not.toBe(0);
    expect(Math.abs(a)).toBeLessThanOrEqual(10);
    const other = evaluateMotion(motion([{ ...shaky, noise: { amplitude: 10, frequency: 2, seed: 8 } }]), 1234).camera.x;
    expect(other).not.toBe(a);
    expect(sampleNoise({ amplitude: 1, seed: 3 }, 0)).toBe(sampleNoise({ amplitude: 1, seed: 3 }, 0));
    for (const property of ["opacity", "scale", "blur"])
      expect(MotionTrackSchema.safeParse({ target: { kind: "surface", id: "s" }, property, keyframes: [{ timeMs: 0, value: 0.5 }], noise: { amplitude: 1 } }).success).toBe(false);
  });
  it("evaluates channel tracks for component state", () => {
    const counter = { target: { kind: "channel", id: "revenue" }, property: "value", keyframes: [{ timeMs: 0, value: 0, easing: "expo.out" }, { timeMs: 4000, value: 12840 }] };
    expect(evaluateMotion(motion([counter]), 4000).channels).toEqual({ revenue: 12840 });
    expect(evaluateMotion(motion([counter]), 2000).channels.revenue).toBeGreaterThan(12000);
    expect(MotionSchema.safeParse(motion([counter, counter])).success).toBe(false);
    expect(MotionTrackSchema.safeParse({ ...counter, property: "x" }).success).toBe(false);
  });
  it("validates content-leaf visual properties", () => {
    const surface = (property: string, value: number) => ({ target: { kind: "surface", id: "s" }, property, keyframes: [{ timeMs: 0, value }] });
    for (const [property, value] of [["blur", 12], ["clipRight", 100], ["clipRadius", 75], ["opacity", 0.5]] as const)
      expect(MotionTrackSchema.safeParse(surface(property, value)).success, property).toBe(true);
    for (const [property, value] of [["blur", -1], ["clipLeft", 120], ["clipRadius", 200]] as const)
      expect(MotionTrackSchema.safeParse(surface(property, value)).success, property).toBe(false);
  });
});

describe("loops and advice", () => {
  const scene = { nodes: [{ id: "page" }] };
  it("measures the loop seam", () => {
    expect(loopSeam(motion([camera("rotateY", [[0, -8], [2000, 8], [4000, -8]], { interpolation: "smooth" })], { loop: true }))).toBe(0);
    expect(loopSeam(motion([camera("x", [[0, 0], [4000, 30]])]))).toBe(30);
  });
  it("advises on a broken loop, camera overshoot and ignored smooth easing", () => {
    const codes = (input: object) => reviewAuthoring({ scene, motion: input }).advice.map(advice => advice.code);
    expect(codes(motion([camera("x", [[0, 0], [4000, 30]])], { loop: true }))).toContain("loop-seam");
    expect(codes(motion([camera("x", [[0, 0], [4000, 0]])], { loop: true }))).not.toContain("loop-seam");
    expect(codes(motion([{ ...camera("x", [[0, 0], [4000, 30]]), keyframes: [{ timeMs: 0, value: 0, easing: "back.out" }, { timeMs: 4000, value: 30 }] }]))).toContain("camera-overshoot");
    expect(codes(motion([{ ...camera("x", [[0, 0], [4000, 30]], { interpolation: "smooth" }), keyframes: [{ timeMs: 0, value: 0, easing: "linear" }, { timeMs: 4000, value: 30 }] }]))).toContain("smooth-easing-ignored");
  });
});
