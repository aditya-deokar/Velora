import { describe, expect, it } from "vitest";
import { EASING_NAMES, EasingSchema, applyEasing, easingOvershoots, type Easing } from "../../src/core/easing";
import { cinematicProgress } from "../../src/core/motion";

const samples = Array.from({ length: 101 }, (_, i) => i / 100);
const parametric: Easing[] = [
  { cubicBezier: [0.25, 0.1, 0.25, 1] },
  { spring: { stiffness: 170, damping: 26, mass: 1 } },
  { spring: { stiffness: 100, damping: 20, mass: 1 } },
  { spring: { stiffness: 100, damping: 40, mass: 1 } },
  { steps: 4, jump: "end" },
  { steps: 4, jump: "start" },
];

describe("easing evaluator", () => {
  it.each([...EASING_NAMES, ...parametric.map(e => JSON.stringify(e))])("%s is exact at the endpoints and finite", name => {
    const easing = (name.startsWith("{") ? JSON.parse(name) : name) as Easing;
    expect(applyEasing(easing, 0)).toBe(0);
    expect(applyEasing(easing, 1)).toBe(1);
    expect(applyEasing(easing, -3)).toBe(0);
    expect(applyEasing(easing, 7)).toBe(1);
    for (const p of samples) expect(Number.isFinite(applyEasing(easing, p))).toBe(true);
  });
  it("keeps the legacy curves byte-identical", () => {
    for (const p of samples) {
      expect(applyEasing("linear", p)).toBe(p);
      expect(applyEasing("easeInOut", p)).toBe(p === 1 ? 1 : p * p * (3 - 2 * p));
      expect(applyEasing("cinematic", p)).toBe(p === 1 ? 1 : p * p * p * (p * (p * 6 - 15) + 10));
      expect(cinematicProgress(p)).toBe(applyEasing("cinematic", p));
    }
  });
  it("matches reference values for named families (GSAP / easings.net parity)", () => {
    expect(applyEasing("cubic.out", 0.5)).toBeCloseTo(0.875, 12);
    expect(applyEasing("quad.in", 0.5)).toBeCloseTo(0.25, 12);
    expect(applyEasing("expo.out", 0.5)).toBeCloseTo(0.96875, 12);
    expect(applyEasing("back.out", 0.5)).toBeCloseTo(1.0876975, 6);
    expect(applyEasing("sine.inOut", 0.5)).toBeCloseTo(0.5, 12);
    expect(applyEasing("bounce.out", 1 / 2.75)).toBeCloseTo(1, 12);
    expect(applyEasing("elastic.out", 0.5)).toBeCloseTo(1 + 2 ** -5 * Math.sin((5 - 0.75) * (2 * Math.PI / 3)), 12);
  });
  it("monotonic families never reverse", () => {
    for (const family of ["sine", "quad", "cubic", "quart", "quint", "expo", "circ"])
      for (const direction of ["in", "out", "inOut"]) {
        const values = samples.map(p => applyEasing(`${family}.${direction}` as Easing, p));
        for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] - 1e-12);
      }
  });
  it("solves cubic-bezier like CSS", () => {
    // CSS `ease` at x = 0.5 and the symmetric `ease-in-out`.
    expect(applyEasing({ cubicBezier: [0.25, 0.1, 0.25, 1] }, 0.5)).toBeCloseTo(0.8024033877, 5);
    expect(applyEasing({ cubicBezier: [0.42, 0, 0.58, 1] }, 0.5)).toBeCloseTo(0.5, 6);
    expect(applyEasing({ cubicBezier: [0.42, 0, 0.58, 1] }, 0.25) + applyEasing({ cubicBezier: [0.42, 0, 0.58, 1] }, 0.75)).toBeCloseTo(1, 6);
    expect(applyEasing({ cubicBezier: [0, 0, 1, 1] }, 0.3)).toBeCloseTo(0.3, 6);
  });
  it("springs overshoot only when under-damped and settle by the segment end", () => {
    const peak = (spring: Easing) => Math.max(...samples.map(p => applyEasing(spring, p)));
    expect(peak({ spring: { stiffness: 100, damping: 8, mass: 1 } })).toBeGreaterThan(1.1);
    expect(peak({ spring: { stiffness: 100, damping: 20, mass: 1 } })).toBeLessThanOrEqual(1);
    expect(peak({ spring: { stiffness: 100, damping: 40, mass: 1 } })).toBeLessThanOrEqual(1);
    for (const damping of [8, 20, 40]) expect(Math.abs(1 - applyEasing({ spring: { stiffness: 100, damping, mass: 1 } }, 0.999))).toBeLessThan(0.01);
  });
  it("steps and hold quantize progress", () => {
    expect(applyEasing({ steps: 4, jump: "end" }, 0.3)).toBe(0.25);
    expect(applyEasing({ steps: 4, jump: "start" }, 0.3)).toBe(0.5);
    expect(applyEasing("hold", 0.99)).toBe(0);
  });
  it("validates easing values and defaults spring parameters", () => {
    expect(EasingSchema.parse({ spring: {} })).toEqual({ spring: { stiffness: 170, damping: 26, mass: 1 } });
    expect(EasingSchema.parse({ steps: 3 })).toEqual({ steps: 3, jump: "end" });
    for (const bad of ["springy", { cubicBezier: [1.2, 0, 0.5, 1] }, { spring: { damping: 0 } }, { steps: 0 }, { cubicBezier: [0, 0, 1] }])
      expect(EasingSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it("flags overshooting curves", () => {
    expect(easingOvershoots("back.out")).toBe(true);
    expect(easingOvershoots("elastic.inOut")).toBe(true);
    expect(easingOvershoots({ cubicBezier: [0.3, 1.6, 0.6, 1] })).toBe(true);
    expect(easingOvershoots({ spring: { stiffness: 100, damping: 8, mass: 1 } })).toBe(true);
    expect(easingOvershoots("cinematic")).toBe(false);
    expect(easingOvershoots({ spring: { stiffness: 100, damping: 20, mass: 1 } })).toBe(false);
  });
});
