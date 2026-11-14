import { describe, expect, it } from "vitest";
import { ANIMATABLE_ID_PATTERN, AnimatableSpecSchema, animatableChannel, coerceAnimatable } from "../../src/core/animatable";

const spec = AnimatableSpecSchema.parse({
  value: { type: "number", default: 0, min: 0, max: 1280, label: "Value" },
  fill: { type: "color", default: "#3b82f6" },
  on: { type: "boolean", default: false },
  mode: { type: "enum", options: ["a", "b", "c"], default: "a" },
});
describe("animatable specs", () => {
  it("validates prop specs", () => {
    for (const bad of [{}, { "bad-name": { type: "number", default: 0 } }, { x: { type: "number", default: 5, max: 1 } }, { x: { type: "number", default: 0, min: 2, max: 1 } },
      { x: { type: "color", default: "red" } }, { x: { type: "enum", options: ["a"], default: "b" } }, { x: { type: "enum", options: ["a", "a"], default: "a" } },
      { x: { type: "enum", options: Array.from({ length: 33 }, (_, i) => `o${i}`), default: "o0" } }, { x: { type: "string", default: "" } },
      Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`p${i}`, { type: "boolean", default: true }]))])
      expect(AnimatableSpecSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false);
  });
  it("coerces channel values: clamp, switch, hold, passthrough, defaults", () => {
    expect(coerceAnimatable(spec, "value", 2000)).toBe(1280);
    expect(coerceAnimatable(spec, "value", -5)).toBe(0);
    expect(coerceAnimatable(spec, "value", undefined)).toBe(0);
    expect(coerceAnimatable(spec, "on", 0.49)).toBe(false);
    expect(coerceAnimatable(spec, "on", 0.5)).toBe(true);
    expect(coerceAnimatable(spec, "mode", 0.49)).toBe("a");
    expect(coerceAnimatable(spec, "mode", 1.5)).toBe("c");
    expect(coerceAnimatable(spec, "mode", 9)).toBe("c");
    expect(coerceAnimatable(spec, "mode", -3)).toBe("a");
    expect(coerceAnimatable(spec, "fill", "rgb(1 2 3 / 1)")).toBe("rgb(1 2 3 / 1)");
    expect(coerceAnimatable(spec, "fill", 3)).toBe("#3b82f6");
    expect(coerceAnimatable(spec, "value", "x")).toBe(0);
    expect(() => coerceAnimatable(spec, "missing", 1)).toThrow(RangeError);
  });
  it("names channels <id>.<prop> and validates ids", () => {
    expect(animatableChannel("hero-counter", "value")).toBe("hero-counter.value");
    for (const id of ["hero", "hero-counter", "a.b-c", "0x"]) expect(ANIMATABLE_ID_PATTERN.test(id)).toBe(true);
    for (const id of ["Hero", "-a", "a..b", "a.", "", "a b"]) expect(ANIMATABLE_ID_PATTERN.test(id)).toBe(false);
  });
});
