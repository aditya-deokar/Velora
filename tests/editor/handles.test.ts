import { describe, expect, it } from "vitest";
import { evaluateMotion } from "../../src/core";
import { bezierOf, endSlope, handlesOf, makeContinuous, startSlope, springStats, type Bezier } from "../../src/editor/graph/handles";
import { applyEasing } from "../../src/core";

describe("graph handles ↔ cubicBezier", () => {
  const segment = { t0: 1000, v0: 20, t1: 3000, v1: 220 };
  it("round-trips exactly", () => {
    for (const bezier of [[0.333, 0, 0.667, 1], [0.1, -0.4, 0.9, 1.6], [0, 0, 1, 1], [0.42, 0, 0.58, 1]] as Bezier[]) {
      const { out, in: into } = handlesOf(segment, bezier);
      bezierOf(segment, out, into).forEach((value, i) => expect(value).toBeCloseTo(bezier[i], 12));
    }
  });
  it("clamps x to [0, 1] and y to [-5, 5], and keeps y on flat segments", () => {
    expect(bezierOf(segment, { t: 0, v: 99999 }, { t: 99999, v: -99999 })).toEqual([0, 5, 1, -5]);
    expect(bezierOf({ t0: 0, v0: 5, t1: 100, v1: 5 }, { t: 30, v: 50 }, { t: 60, v: 9 }, [0.2, 0.1, 0.8, 0.9])).toEqual([0.3, 0.1, 0.6, 0.9]);
  });
  it("continuous mode makes the velocities equal across the keyframe", () => {
    const before = { segment: { t0: 0, v0: 0, t1: 1000, v1: 100 }, bezier: [0.3, 0.1, 0.6, 0.7] as Bezier };
    const after = { segment: { t0: 1000, v0: 100, t1: 2500, v1: 40 }, bezier: [0.25, 0.4, 0.7, 1] as Bezier };
    const result = makeContinuous(before, after);
    const a = endSlope(before.segment, result.before), b = startSlope(after.segment, result.after);
    expect(Math.abs(a - b) / Math.max(1e-9, Math.abs(a))).toBeLessThan(1e-6);
    // Finite differences on the canonical evaluator agree.
    const motion = { durationMs: 2500, speed: 1, tracks: [{ target: { kind: "channel", id: "v" }, property: "value", keyframes: [
      { timeMs: 0, value: 0, easing: { cubicBezier: result.before } }, { timeMs: 1000, value: 100, easing: { cubicBezier: result.after } }, { timeMs: 2500, value: 40 }] }] };
    const v = (t: number) => evaluateMotion(motion, t).channels.v;
    // One-sided differences with Richardson extrapolation (second-order accurate).
    const side = (h: number) => (v(1000 + h) - v(1000)) / h;
    const left = 2 * side(-0.05) - side(-0.1), right = 2 * side(0.05) - side(0.1);
    expect(Math.abs(left - right) / Math.abs(left)).toBeLessThan(1e-3);
  });
  it("reports spring settle time and overshoot from the canonical easing", () => {
    const bouncy = springStats(p => applyEasing({ spring: { stiffness: 200, damping: 12, mass: 1 } }, p), 1000);
    const heavy = springStats(p => applyEasing({ spring: { stiffness: 120, damping: 30, mass: 3 } }, p), 1000);
    expect(bouncy.overshoot).toBeGreaterThan(0.2);
    expect(heavy.overshoot).toBeLessThan(bouncy.overshoot);
    expect(bouncy.settleMs).toBeGreaterThan(0);
  });
});
