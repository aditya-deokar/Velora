import { expect, it } from "vitest";
import { velocityBlurAt, type RigDefinition } from "../../src/core";

const definition: RigDefinition = { width: 960, height: 540,
  scene: { nodes: [], camera: { perspective: 1800 }, focus: { distance: 2300 } },
  motion: { durationMs: 1000, speed: 1, tracks: [] }, look: { velocityBlur: { shutterMs: 20.8, maxPx: 24 } },
};
const bend = (degrees: number): RigDefinition => ({ ...definition, motion: { ...definition.motion, tracks: [
  { target: { kind: "camera" }, property: "rotateY", keyframes: [{ timeMs: 0, value: 0, easing: "linear" }, { timeMs: 1000, value: degrees }] },
] } });

it("derives a capped directional blur from elapsed shutter time at any FPS", () => {
  expect(velocityBlurAt(definition, 500)).toEqual({ x: 0, y: 0 });
  expect(velocityBlurAt(bend(200), 500, { accumulate: true })).toEqual({ x: 0, y: 0 });
  expect(velocityBlurAt(bend(200), 500)).toEqual({ x: 24, y: 0 });
  expect(velocityBlurAt(bend(12), 500).x / velocityBlurAt(bend(6), 500).x).toBeCloseTo(2, 2);
  expect([24, 30, 60].map(fps => velocityBlurAt(bend(8), (fps / 2) * 1000 / fps))).toEqual(Array(3).fill(velocityBlurAt(bend(8), 500)));
});

it("ignores focal-plane radial magnification", () => {
  const dolly: RigDefinition = { ...definition, motion: { ...definition.motion, tracks: [
    { target: { kind: "camera" }, property: "z", keyframes: [{ timeMs: 0, value: 0, easing: "linear" }, { timeMs: 1000, value: 300 }] },
  ] } };
  expect(velocityBlurAt(dolly, 500, { targetPoint: [160, 120, 20] })).toEqual({ x: 0, y: 0 });
});
