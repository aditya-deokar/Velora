import { describe, expect, it } from "vitest";
import { SELECTOR_SHAPES, textAnimatorAt } from "../../src/core";
import { trimDash } from "../../src/kit/draw-path";
import { polygonPoints } from "../../src/kit/shape";

const weights = (count: number, selector: Parameters<typeof textAnimatorAt>[1]) => textAnimatorAt(count, selector, { opacity: 0 }).map(unit => Math.round(unit.weight * 1000) / 1000);
describe("text animator range selector", () => {
  it("endpoints are exact: full range selects every unit, an empty range none", () => {
    for (const shape of ["square"] as const) {
      expect(weights(5, { start: 0, end: 100, shape })).toEqual([1, 1, 1, 1, 1]);
      expect(weights(5, { start: 100, end: 100, shape })).toEqual([0, 0, 0, 0, 0]);
      expect(weights(5, { start: 40, end: 40, shape })).toEqual([0, 0, 0, 0, 0]);
    }
    const states = textAnimatorAt(4, { start: 0, end: 100 }, { opacity: 0, y: 30, scale: 0.5, tracking: 0.2 });
    expect(states[0]).toMatchObject({ opacity: 0, y: 30, scale: 0.5, tracking: 0.2, weight: 1 });
    expect(textAnimatorAt(4, { start: 100, end: 100 }, { opacity: 0, y: 30 })[3]).toMatchObject({ opacity: 1, y: 0, scale: 1 });
  });
  it("square covers units partially at the range edge (a reveal sweeps one unit at a time)", () => {
    expect(weights(4, { start: 0, end: 50 })).toEqual([1, 1, 0, 0]);
    expect(weights(4, { start: 0, end: 37.5 })).toEqual([1, 0.5, 0, 0]);
  });
  it("shapes weight units by position in the range", () => {
    expect(weights(5, { start: 0, end: 100, shape: "ramp-up" })).toEqual([0.1, 0.3, 0.5, 0.7, 0.9]);
    expect(weights(5, { start: 0, end: 100, shape: "ramp-down" })).toEqual([0.9, 0.7, 0.5, 0.3, 0.1]);
    expect(weights(5, { start: 0, end: 100, shape: "triangle" })).toEqual([0.2, 0.6, 1, 0.6, 0.2]);
    const round = weights(5, { start: 0, end: 100, shape: "round" });
    expect(round[2]).toBe(1);
    expect(round[0]).toBeCloseTo(0.6, 3);
    const smooth = weights(5, { start: 0, end: 100, shape: "smooth" });
    expect(smooth[2]).toBe(1);
    expect(smooth[0]).toBeLessThan(round[0]);
    expect(SELECTOR_SHAPES).toHaveLength(6);
    // ramp-up beyond the range end stays fully selected; ramp-down before the start too.
    expect(weights(4, { start: 0, end: 50, shape: "ramp-up" })[3]).toBe(1);
  });
  it("ease remaps intermediate weights only", () => {
    const linear = weights(5, { start: 0, end: 100, shape: "ramp-up" });
    const eased = weights(5, { start: 0, end: 100, shape: "ramp-up", ease: "cubic.in" });
    expect(eased[0]).toBeLessThan(linear[0]);
    expect(weights(3, { start: 0, end: 100, ease: "cubic.in" })).toEqual([1, 1, 1]);
  });
  it("offset shifts the range and wraps when asked", () => {
    expect(weights(4, { start: 0, end: 25, offset: 50 })).toEqual([0, 0, 1, 0]);
    expect(weights(4, { start: 0, end: 50, offset: 75 })).toEqual([0, 0, 0, 1]);
    expect(weights(4, { start: 0, end: 50, offset: 75, wrap: true })).toEqual([1, 0, 0, 1]);
    expect(weights(4, { start: 0, end: 50, offset: -25, wrap: true })).toEqual([1, 0, 0, 1]);
  });
  it("color mixes by weight", () => {
    const [unit] = textAnimatorAt(1, { start: 0, end: 100 }, { color: "#ff0000" });
    expect(unit).toMatchObject({ color: "#ff0000", colorMix: 1 });
  });
});
describe("DrawPath trim and Shape geometry", () => {
  it("trim endpoints: nothing drawn at end = start, everything at 0..1", () => {
    expect(trimDash(0, 0, 0).visible).toBe(0);
    expect(trimDash(0, 1, 0)).toEqual({ dasharray: "none", dashoffset: 0, visible: 1 });
    expect(trimDash(0.25, 0.75, 0)).toEqual({ dasharray: "0.5 0.5", dashoffset: -0.25, visible: 0.5 });
    expect(trimDash(0.5, 0.75, 0.75).dashoffset).toBeCloseTo(-0.25, 9);
  });
  it("regular polygons start at the top", () => {
    expect(polygonPoints(4, 100, 100)).toBe("50.000,0.000 100.000,50.000 50.000,100.000 0.000,50.000");
    expect(polygonPoints(2.4, 100, 100).split(" ")).toHaveLength(3);
  });
});
