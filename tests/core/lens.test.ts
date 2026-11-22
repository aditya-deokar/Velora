import { describe, expect, it } from "vitest";
import { applyLens, focalLengthForPerspective, framingDistance, lensFor, lensPreset, perspectiveForFocalLength } from "../../src/core/lens";
import { ASPECT_FRAMES, applyEdits, certifyTemplate, resolveTemplateParams, STAGE_PRESETS, TEMPLATE_CATALOG } from "../../src/core";

describe("lens language", () => {
  it("maps full-frame millimetres to CSS perspective", () => {
    expect(perspectiveForFocalLength(50, 1080)).toBe(2250);
    expect(perspectiveForFocalLength(24, 980)).toBe(980);
    expect(perspectiveForFocalLength(85, 1080)).toBeCloseTo(3825, 9);
    // Field of view check: half the frame height subtends atan(12 / mm) at the projection distance.
    const p = perspectiveForFocalLength(35, 1080);
    expect(Math.atan(540 / p)).toBeCloseTo(Math.atan(12 / 35), 12);
  });
  it("round-trips and pairs field of view with depth-of-field focal length", () => {
    for (const mm of [24, 35, 50, 85, 135]) expect(focalLengthForPerspective(perspectiveForFocalLength(mm, 1080), 1080)).toBeCloseTo(mm, 9);
    expect(lensFor(50, 1080)).toEqual({ perspective: 2250, focus: { focalLength: 50 } });
  });
  it("rejects lenses the camera cannot represent", () => {
    expect(() => perspectiveForFocalLength(1000, 1080)).toThrow(/outside/);
    expect(() => perspectiveForFocalLength(1, 1080)).toThrow(/outside/);
    expect(() => perspectiveForFocalLength(0, 1080)).toThrow(RangeError);
    expect(() => perspectiveForFocalLength(50, Number.NaN)).toThrow(RangeError);
  });
});

it("uses the stage's physical pixel density and accepts telephoto on each aspect", () => {
  for (const frame of Object.values(ASPECT_FRAMES)) {
    expect(lensPreset("200mm-telephoto", { frameHeight: frame.height }).perspective).toBe(frame.height * 200 / 24);
  }
  const lens = lensPreset("200mm-telephoto", { frameHeight: 1080, stage: STAGE_PRESETS["desktop-1080"] });
  expect(lens).toMatchObject({ perspective: 9000, focus: { fStop: 2.8, maxBlur: 14 }, breathing: 0.018 });
  expect(lens.focus.focalLength).toBeCloseTo(200 * 1920 / 531, 10);
  expect(() => lensFor(200, 1920)).toThrow(RangeError);
});

it("certifies the 200 mm override on vertical and portrait templates", () => {
  const failure = TEMPLATE_CATALOG.flatMap(template => (["4:5", "9:16"] as const).flatMap(aspect => {
    if (!template.aspects.includes(aspect)) return [];
    const { params, issues } = resolveTemplateParams(template, { lens: "200" });
    return [...issues, ...certifyTemplate(template, params, aspect)].slice(0, 1);
  }));
  expect(failure).toEqual([]);
});

it("holds framing or position and reverses the edit exactly", () => {
  const frame = { width: 1920, height: 1080 };
  const z = framingDistance(1080, frame, frame, 0.78);
  const definition = { ...frame, scene: { camera: { perspective: 1080, z }, focus: { distance: 1080 + z }, nodes: [{ id: "subject" }, { id: "back", transform: { z: -3500 } }] },
    motion: { durationMs: 500, tracks: [{ target: { kind: "camera" as const }, property: "z" as const, keyframes: [{ timeMs: 0, value: z }, { timeMs: 500, value: z * 2 }] }] } };
  const recipe = { version: 1, id: "demo", title: "Demo", definition };
  for (const hold of ["framing", "position"] as const) {
    const live = applyLens(definition, "200mm-telephoto", { hold });
    expect(live.issues).toContainEqual(expect.objectContaining({ code: "lens-compression" }));
    const result = applyEdits(recipe, [{ op: "lens.apply", preset: "200mm-telephoto", hold }]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(JSON.stringify(result.issues));
    const after = (result.recipe as typeof recipe & { definition: { scene: { camera: { zoom?: number } } } }).definition.scene.camera;
    expect(9000 / (9000 + after.z) * (after.zoom ?? 1)).toBeCloseTo(0.78, 10);
    if (hold === "position") expect(after.z).toBe(z);
    expect(applyEdits(result.recipe, result.inverse)).toMatchObject({ ok: true, recipe });
  }
});
