import { describe, expect, it } from "vitest";
import { MotionSchema } from "../../src/core/motion";
import { TRANSITION_CATALOG, buildTransition, describeTransition, type TransitionType } from "../../src/core/transitions";

const durationMs = 2000;
function valid(type: TransitionType, surfaceIds: string[], extra: Record<string, number> = {}) {
  const built = buildTransition(type, { surfaceIds, durationMs, ...extra });
  expect(MotionSchema.safeParse({ durationMs, tracks: built.tracks }).success, JSON.stringify(built.tracks)).toBe(true);
  return built;
}
describe("transition catalog", () => {
  it("covers eight catalogued transitions with leaf requirements", () => {
    expect(TRANSITION_CATALOG.map((t) => t.type)).toEqual(["cut", "dissolve", "slide-push", "wipe-mask", "iris-mask", "depth-dolly", "focus-pull", "cascade-handoff"]);
    expect(describeTransition("dissolve")).toMatchObject({ needsLeaves: true });
    expect(describeTransition("cut")).toMatchObject({ needsLeaves: false });
    expect(() => describeTransition("wipe" as TransitionType)).toThrow();
  });
  it("compiles every transition to valid motion deterministically", () => {
    for (const entry of TRANSITION_CATALOG) {
      const first = valid(entry.type, ["main", "side"]);
      expect(valid(entry.type, ["main", "side"])).toEqual(first);
    }
    expect(valid("cut", []).tracks).toEqual([]);
    expect(valid("cut", []).warnings).toEqual([]);
  });
  it("emits entering-side entrances on the right targets", () => {
    expect(valid("dissolve", ["a"]).tracks.every((t) => t.property === "opacity")).toBe(true);
    expect(valid("slide-push", ["a"], { distance: 300 }).tracks.find((t) => t.property === "x")?.keyframes[0].value).toBe(300);
    expect(valid("depth-dolly", [], { depth: 250 }).tracks).toMatchObject([{ target: { kind: "camera" }, property: "z" }]);
    const pull = valid("focus-pull", [], { focusFrom: 2200, focusTo: 1400 });
    expect(pull.tracks).toMatchObject([{ target: { kind: "focus" }, property: "distance" }]);
    expect(pull.tracks[0].keyframes.map((k) => k.value)).toEqual([2200, 1400]);
    // Wipe and iris are true masks on the entering leaves, not travel/fade approximations.
    const iris = valid("iris-mask", ["a"]);
    expect(iris.tracks).toMatchObject([{ target: { kind: "surface", id: "a" }, property: "clipRadius" }]);
    expect(iris.tracks[0].keyframes.map((k) => k.value)).toEqual([0, 75]);
    const wipe = valid("wipe-mask", ["a"]);
    expect(wipe.tracks).toMatchObject([{ property: "clipRight" }]);
    expect(wipe.tracks[0].keyframes.map((k) => k.value)).toEqual([100, 0]);
    expect([...iris.warnings, ...wipe.warnings]).toEqual([]);
  });
  it("fits cascades inside the duration and rejects bad input", () => {
    const cascade = valid("cascade-handoff", ["a", "b", "c"]);
    for (const track of cascade.tracks)
      for (const keyframe of track.keyframes) expect(keyframe.timeMs).toBeLessThanOrEqual(durationMs);
    expect(() => buildTransition("dissolve", { surfaceIds: ["a"], durationMs: 0 })).toThrow();
    expect(() => buildTransition("dissolve", { surfaceIds: ["a", "a"], durationMs })).toThrow();
  });
});
