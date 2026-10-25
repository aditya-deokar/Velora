import { describe, expect, it } from "vitest";
import { MotionSchema } from "../../src/core/motion";
import { MAX_KINETIC_SURFACES, TextStyleSchema, buildKineticTracks, type KineticPreset } from "../../src/core/typography";

const durationMs = 2000;
function valid(preset: KineticPreset, surfaceIds: string[], options: { distance?: number } = {}) {
  const built = buildKineticTracks(preset, { surfaceIds, durationMs, ...options });
  expect(MotionSchema.safeParse({ durationMs, tracks: built.tracks }).success, JSON.stringify(built.tracks)).toBe(true);
  return built;
}
describe("kinetic presets", () => {
  it.each(["fade-slide", "word-cascade", "mask-reveal", "typewriter-timed"] as const)("compiles %s to valid motion deterministically", (preset) => {
    const ids = preset === "typewriter-timed" ? ["t-w0", "t-w1", "t-w2"] : ["title"];
    const first = valid(preset, ids);
    const second = valid(preset, ids);
    expect(second).toEqual(first);
    expect(first.warnings).toEqual([]);
  });
  it("cascades words with staggered depth and opacity", () => {
    const { tracks } = valid("word-cascade", ["w0", "w1"]);
    expect(tracks.some((t) => t.target.kind === "surface" && t.property === "z")).toBe(true);
    expect(tracks.filter((t) => t.property === "opacity")).toHaveLength(2);
  });
  it("steps typewriter words and warns on single surfaces and over-budget casts", () => {
    const single = valid("typewriter-timed", ["only"]);
    expect(single.warnings.map((w) => w.code)).toContain("kinetic-single");
    const big = valid("fade-slide", Array.from({ length: MAX_KINETIC_SURFACES + 1 }, (_, i) => `s${i}`));
    expect(big.warnings.map((w) => w.code)).toContain("kinetic-budget");
  });
  it("rejects empty and duplicate Surface IDs", () => {
    expect(() => buildKineticTracks("fade-slide", { surfaceIds: [], durationMs })).toThrow();
    expect(() => buildKineticTracks("fade-slide", { surfaceIds: ["a", "a"], durationMs })).toThrow();
    expect(() => buildKineticTracks("fade-slide", { surfaceIds: ["a"], durationMs: -5 })).toThrow();
  });
  it("reveals through a true mask while fades rise along y", () => {
    const wipe = valid("mask-reveal", ["m"], { distance: 300 });
    expect(wipe.tracks).toMatchObject([{ target: { kind: "surface", id: "m" }, property: "clipRight" }]);
    expect(wipe.tracks[0].keyframes.map((k) => k.value)).toEqual([100, 0]);
    const fade = valid("fade-slide", ["f"], { distance: 50 });
    expect(fade.tracks.find((t) => t.property === "y")?.keyframes[0].value).toBe(50);
  });
});
describe("text styles", () => {
  it("validates style contracts without restyling hosts", () => {
    expect(TextStyleSchema.safeParse({ family: "Inter", size: 64 }).success).toBe(true);
    expect(TextStyleSchema.safeParse({ family: "Inter", size: 64, color: "#ff0033", align: "left", kinetic: "fade-slide" }).success).toBe(true);
    for (const bad of [
      { family: "", size: 64 },
      { family: "Inter", size: 0 },
      { family: "Inter", size: 64, color: "red" },
      { family: "Inter", size: 64, kinetic: "spin" },
    ]) expect(TextStyleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
