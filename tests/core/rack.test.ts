import { expect, it } from "vitest";
import { applyEdits, buildRackFocus, evaluateMotion, MotionSchema, rackReport, withCameraAdditive } from "../../src/core";

const pull = { from: { depth: 7700 }, to: { depth: 8200 }, atMs: 250, durationMs: 800, breathing: { amount: 0.018, direction: "in" as const } };

it("synchronizes focus and additive breathing, preserves authored zoom, and lands sharp", () => {
  const clip = buildRackFocus(pull);
  expect(buildRackFocus(pull)).toEqual(clip);
  const focus = clip.tracks![0].keyframes;
  const zoom = clip.clips![0].tracks![0].keyframes;
  expect(zoom.map(({ timeMs, easing }) => [timeMs, easing])).toEqual(focus.map(({ timeMs, easing }) => [timeMs, easing]));
  const motion = { durationMs: 1050, speed: 1, clips: [clip], tracks: [{ target: { kind: "camera" }, property: "zoom", keyframes: [{ timeMs: 0, value: 1.3 }] }] };
  expect(MotionSchema.safeParse(motion).success).toBe(true);
  const halfway = evaluateMotion(motion, 650);
  expect(halfway.focus.distance).toBeCloseTo(7950);
  expect(withCameraAdditive(halfway.camera, halfway.additive?.camera).zoom).toBeCloseTo(1.291);
  const proof = rackReport(clip, { focalLength: 1001, fStop: 1.4, maxBlur: 14 }, 1.3);
  expect(proof).toMatchObject({ pass: true, start: { sharpBlur: 0 }, end: { sharpBlur: 0 } });
  expect(proof.breathing).toBeCloseTo(0.018, 12);
  expect(proof.start.otherBlur).toBeGreaterThan(2);
  expect(proof.end.otherBlur).toBeGreaterThan(2);
});

it("compiles rack.add into an undoable clip and keeps existing keys outside the pull", () => {
  const recipe = { version: 1, id: "demo", title: "Demo", definition: { scene: { nodes: [], focus: { distance: 7700 } },
    motion: { durationMs: 1600, speed: 1, tracks: [{ target: { kind: "focus" }, property: "distance", keyframes: [{ timeMs: 0, value: 7600 }, { timeMs: 1600, value: 7800 }] }] } } };
  const edited = applyEdits(recipe, [{ op: "rack.add", ...pull }]);
  if (!edited.ok) throw Error(JSON.stringify(edited.issues));
  expect(edited.recipe).toMatchObject({ definition: { motion: { tracks: [], clips: [{ source: { rack: "focus", version: 1 }, tracks: [{ keyframes: [
    { timeMs: 0, value: 7600 }, { timeMs: 250, value: 7700 }, { timeMs: 1050, value: 8200 }, { timeMs: 1600, value: 7800 },
  ] }] }] } } });
  expect(applyEdits(edited.recipe, edited.inverse)).toMatchObject({ ok: true, recipe });
  const reapplied = applyEdits(edited.recipe, [{ op: "rack.add", ...pull, durationMs: 700, hold: 100 }]);
  expect(reapplied).toMatchObject({ ok: true, recipe: { definition: { motion: { clips: [{ tracks: [{ keyframes: [
    { timeMs: 0, value: 7600 }, { timeMs: 250, value: 7700 }, { timeMs: 950, value: 8200 }, { timeMs: 1050, value: 8200 }, { timeMs: 1600, value: 7800 },
  ] }] }] } } } });
});
