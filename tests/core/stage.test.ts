import { describe, expect, it } from "vitest";
import { applyEdits, CameraSchema, fitStage, presentPreview, resolutionBudget, reviewAuthoring, StageSchema, STAGE_PRESETS, stageFromSpec, stageFromViewport } from "../../src/core";
import { resolveFinishing, stageLineage } from "../../src/core/export";

describe("app stage", () => {
  it("validates named presets and arbitrary authored sizes, with no implicit recipe stage", () => {
    expect(STAGE_PRESETS).toEqual({
      "laptop-14": { width: 1512, height: 982, dpr: 2, physicalWidthMm: 302 },
      "laptop-13": { width: 1440, height: 900, dpr: 2, physicalWidthMm: 286 },
      "laptop-16": { width: 1728, height: 1117, dpr: 2, physicalWidthMm: 346 },
      "desktop-1080": { width: 1920, height: 1080, dpr: 1, physicalWidthMm: 531 },
    });
    expect(StageSchema.safeParse({ ...stageFromSpec("laptop-14"), width: 1513 }).success).toBe(false);
    expect(stageFromSpec("1536x730@1.25")).toEqual({ preset: "custom", width: 1536, height: 730, dpr: 1.25 });
    expect(stageFromSpec("user-native")).toBeUndefined();
    expect(stageFromSpec("319x730@1.25")).toBeUndefined();
    expect(presentPreview({ scene: { nodes: [] } })).not.toHaveProperty("definition.stage");
  });

  it.each([[1512, 982, 2, 2], [1470, 956, 2, 2], [1366, 768, 1, 1], [1280, 800, 1.5, 1.5],
    [1536, 730, 1.25, 1.25], [1536, 730, 1.33, 1.25], [1536, 730, 2.2, 2]])("detects %ix%i @%d as DPR %d", (width, height, raw, dpr) => {
    const metrics = { innerWidth: width, innerHeight: height, screenWidth: 4800, screenHeight: 1500, devicePixelRatio: raw, atIso: "2026-11-21T00:00:00Z" };
    expect(stageFromViewport(metrics)).toMatchObject({ width, height, dpr, preset: "user-native", detected: { ...metrics, basis: "window" } });
    expect(stageFromViewport(metrics, { basis: "screen" })).toMatchObject({ width: 3840, height: 1500, dpr, detected: { basis: "screen" } });
  });

  it("fits a stage inside the frame, preserving its aspect", () => {
    expect(fitStage({ width: 1600, height: 1000 }, { width: 1920, height: 1080 }, 0.5)).toMatchObject({
      width: 864, height: 540, left: 528, top: 270, scale: 0.54,
    });
  });

  it("reports the peak raster demand at the sampled focus point", () => {
    const camera = CameraSchema.parse({ perspective: 1000 });
    const frame = { width: 1920, height: 1080 };
    const samples = [{ timeMs: 0, camera, target: [0, 0, 0] }, { timeMs: 400, camera, target: [0, 0, 750], scale: 0.5 }];
    expect(resolutionBudget({ frame, samples, effectiveDpr: 2 })).toEqual({
      timeMs: 400, pixelsPerCssPixel: 2, effectiveDpr: 2, undersampled: false,
    });
    expect(resolutionBudget({ frame, samples, effectiveDpr: 1.75 }).undersampled).toBe(true);
  });

  it("surfaces a raster advisory when the close-up exceeds the stage DPR", () => {
    const review = reviewAuthoring({ stage: stageFromSpec("laptop-14"), width: 1920, height: 1080,
      scene: { nodes: [{ id: "subject" }], camera: { perspective: 1000, z: -800 } },
      motion: { durationMs: 1000, tracks: [] } });
    expect(review.advice).toContainEqual(expect.objectContaining({ code: "stage-undersampled", path: "definition.stage" }));
  });

  it("adds and exactly undoes the authored stage", () => {
    const recipe = { version: 1, id: "demo", title: "Demo", definition: { scene: { nodes: [] } } };
    const stage = stageFromSpec("laptop-13")!;
    const edit = applyEdits(recipe, [{ op: "stage.set", ...stage }]);
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.recipe).toHaveProperty("definition.stage", stage);
    expect(applyEdits(edit.recipe, edit.inverse)).toMatchObject({ ok: true, recipe });
    const undo = applyEdits(edit.recipe, edit.inverse);
    if (undo.ok) expect(undo.recipe).toEqual(recipe);
  });
});

describe("stage capture", () => {
  it("applies the DPR floor, honors overrides and records the 4K cap", () => {
    const stage = stageFromSpec("laptop-14")!;
    const hd = { width: 1920, height: 1080 };
    expect(resolveFinishing({}, hd, stage).supersample).toBe(2);
    expect(resolveFinishing({ stageDpr: 1.25 }, hd, stage).supersample).toBe(1.25);
    expect(resolveFinishing({ quality: "master", stageDpr: 1.25 }, hd, stage).supersample).toBe(2);
    expect(resolveFinishing({ quality: "draft", stageDpr: 3 }, hd, stage).supersample).toBe(0.5);
    const capped = resolveFinishing({}, { width: 3840, height: 2160 }, stage);
    expect(stageLineage(stage, capped)).toEqual({ preset: "laptop-14", width: 1512, height: 982, dpr: 2, effectiveDpr: 1, dprCapped: true });
    expect(resolveFinishing({}, hd).supersample).toBe(1);
  });
});
