import { describe, expect, it } from "vitest";
import { MotionSchema, PresetSchema, applyPreset, evaluateMotion, presetFromClip, presetFromTracks, presetTargetKind } from "../../src/core";

const motionPreset = {
  version: 1, id: "soft-rise", title: "Soft rise", kind: "motion",
  body: { values: "relative", tracks: [
    { target: { kind: "surface", id: "$target" }, property: "y", keyframes: [{ timeMs: 0, value: 40 }, { timeMs: 800, value: 0 }] },
    { target: { kind: "surface", id: "$target" }, property: "opacity", keyframes: [{ timeMs: 0, value: -1 }, { timeMs: 800, value: 0 }] },
  ] },
};
describe("project presets", () => {
  it("reuses an eased clip and offsets its position path from the destination pose", () => {
    const preset = presetFromClip({ id: "original", startMs: 500, speed: 2, ease: "cubic.out", tracks: [{
      target: { kind: "surface", id: "source" }, property: "position",
      keyframes: [{ timeMs: 0, value: [10, 20, 30] }, { timeMs: 800, value: [30, 30, 20] }],
    }] }, { id: "glide", title: "Glide" });
    const result = applyPreset(preset, { surface: "destination" }, { atMs: 125, base: () => [100, 150, 50] });
    expect(result.ok && result.clip).toMatchObject({ id: "glide-destination", startMs: 125, clips: [{ id: "glide-destination-1", startMs: 0, speed: 2, ease: "cubic.out", tracks: [{
      target: { kind: "surface", id: "destination" }, keyframes: [{ value: [100, 150, 50] }, { value: [120, 160, 40] }],
    }] }] });
  });
  it("validates presets of each kind and rejects bad targets and ids", () => {
    expect(PresetSchema.safeParse(motionPreset).success).toBe(true);
    expect(PresetSchema.safeParse({ version: 1, id: "brand-curves", title: "Brand", kind: "easing", body: { curves: [{ name: "brand", easing: { cubicBezier: [0.2, 0, 0, 1] } }] } }).success).toBe(true);
    expect(PresetSchema.safeParse({ version: 1, id: "pop-in", title: "Pop", kind: "behavior", body: { behavior: "pop", params: { intensity: "standard" } } }).success).toBe(true);
    expect(PresetSchema.safeParse({ ...motionPreset, id: "Bad Id" }).success).toBe(false);
    const literal = { ...motionPreset, body: { ...motionPreset.body, tracks: [{ ...motionPreset.body.tracks[0], target: { kind: "surface", id: "headline" } }] } };
    expect(PresetSchema.safeParse(literal).success).toBe(false);
    expect(PresetSchema.safeParse({ version: 1, id: "x", title: "X", kind: "behavior", body: { behavior: "explode" } }).success).toBe(false);
    expect(PresetSchema.safeParse({ ...motionPreset, body: { ...motionPreset.body, tracks: [{ ...motionPreset.body.tracks[0], property: "warp" }] } }).success).toBe(false);
  });
  it("substitutes $target and applies relative values on top of the target's current value", () => {
    const result = applyPreset(motionPreset, { surface: "caption" }, { atMs: 1000, base: track => (track.property === "y" ? 300 : 1) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clip).toMatchObject({ id: "soft-rise-caption", startMs: 1000, source: { preset: "soft-rise", version: 1 } });
    expect(result.clip.tracks?.[0]).toMatchObject({ target: { kind: "surface", id: "caption" }, keyframes: [{ value: 340 }, { value: 300 }] });
    expect(result.clip.tracks?.[1]).toMatchObject({ keyframes: [{ value: 0 }, { value: 1 }] });
  });
  it("absolute values apply as stored", () => {
    const absolute = { ...motionPreset, body: { ...motionPreset.body, values: "absolute", tracks: [motionPreset.body.tracks[0]] } };
    const result = applyPreset(absolute, { surface: "caption" }, { base: () => 500 });
    expect(result.ok && result.clip.tracks?.[0].keyframes[0].value).toBe(40);
    // Absolute values are checked against property ranges (opacity −1 is only valid as a relative offset).
    expect(PresetSchema.safeParse({ ...motionPreset, body: { ...motionPreset.body, values: "absolute" } }).success).toBe(false);
  });
  it("a preset saved from one layer applies to another layer with identical relative motion", () => {
    const tracks = [{ target: { kind: "surface", id: "headline" }, property: "x", keyframes: [{ timeMs: 500, value: 100 }, { timeMs: 1500, value: 160 }, { timeMs: 2500, value: 130 }] }];
    const preset = presetFromTracks(tracks, { id: "nudge", title: "Nudge" });
    expect(preset.kind === "motion" && preset.body.tracks[0]).toMatchObject({ target: { kind: "surface", id: "$target" }, keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 60 }, { timeMs: 2000, value: 30 }] });
    const applied = applyPreset(preset, { surface: "card" }, { atMs: 0, base: () => -40 });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const a = MotionSchema.parse({ durationMs: 3000, speed: 1, tracks });
    const b = MotionSchema.parse({ durationMs: 3000, speed: 1, tracks: [], clips: [{ ...applied.clip, startMs: 500 }] });
    for (const t of [500, 800, 1200, 1900, 2500]) {
      const delta = (evaluateMotion(a, t).surfaces.headline.x as number) - 100;
      expect((evaluateMotion(b, t).surfaces.card.x as number) - -40).toBeCloseTo(delta, 6);
    }
  });
  it("refuses incompatible targets", () => {
    expect(applyPreset(motionPreset, { camera: true })).toMatchObject({ ok: false, code: "ERR_PRESET_TARGET" });
    expect(applyPreset({ version: 1, id: "c", title: "C", kind: "easing", body: { curves: [{ name: "x", easing: "linear" }] } }, { surface: "a" })).toMatchObject({ ok: false, code: "ERR_PRESET_TARGET" });
    expect(applyPreset({ version: 1, id: "n", title: "N", kind: "behavior", body: { behavior: "counter-up" } }, { surface: "a" })).toMatchObject({ ok: false, code: "ERR_PRESET_TARGET" });
    const camera = { version: 1, id: "drift", title: "Drift", kind: "motion", body: { values: "absolute", tracks: [{ target: { kind: "camera" }, property: "z", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: -200 }] }] } };
    expect(presetTargetKind(PresetSchema.parse(camera))).toBe("camera");
    expect(applyPreset(camera, { camera: true }).ok).toBe(true);
    expect(applyPreset(camera, { surface: "a" })).toMatchObject({ ok: false, code: "ERR_PRESET_TARGET" });
    expect(applyPreset({ nope: true }, { surface: "a" })).toMatchObject({ ok: false, code: "ERR_PRESET_INVALID" });
  });
  it("behavior presets build the behavior with the preset's provenance", () => {
    const result = applyPreset({ version: 1, id: "pop-in", title: "Pop", kind: "behavior", body: { behavior: "pop", params: { intensity: "standard" } } }, { surface: "card" }, { atMs: 200 });
    expect(result.ok && result.clip).toMatchObject({ startMs: 200, source: { preset: "pop-in" }, tracks: [{ property: "scale" }, { property: "opacity" }] });
  });
});
