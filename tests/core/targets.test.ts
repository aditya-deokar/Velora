import { describe, expect, it } from "vitest";
import { ElementTargetSchema, elementKey, parseElementTarget, resolveTarget, type AnchorMeasurement, type AnchorMeasurements } from "../../src/core/targets";
import { evaluateScene, matrixFor } from "../../src/core/spatial";
import { TransformSchema, type SceneConstraintInput } from "../../src/core/scene";
import { buildRackFocus, liveRacks, rackTargetFromText, ShotInputSchema } from "../../src/core/shots";

const target = { surface: "dashboard", anchor: "revenue-card" };
const anchor: AnchorMeasurement = { target, rect: { x: -40, y: -20, width: 80, height: 40 }, elevation: 60, baseElevation: 5, tier: "card" };
const anchors: AnchorMeasurements = { entries: [anchor], matches: { [elementKey(target)]: [anchor] } };
const frame = { width: 800, height: 400 };

describe("element targets", () => {
  it("parses bounded, exclusive selectors and local points", () => {
    expect(parseElementTarget("dashboard:revenue-card@.25,0.6")).toEqual({ ...target, at: [0.25, 0.6] });
    expect(parseElementTarget("dashboard:css(section :is(#revenue,.card))@1,0")).toEqual({ surface: "dashboard", selector: "section :is(#revenue,.card)", at: [1, 0] });
    expect(parseElementTarget("revenue-card", "dashboard")).toEqual(target);
    expect(parseElementTarget("dashboard:revenue-card@1.01,0")).toBeUndefined();
    expect(ElementTargetSchema.safeParse({ ...target, selector: "#card" }).success).toBe(false);
    expect(ElementTargetSchema.safeParse({ surface: "dashboard", selector: "a".repeat(257) }).success).toBe(false);
    expect(ShotInputSchema.safeParse({ kind: "orbit", focusTarget: target, focusRegion: { x: 0, y: 0, width: 10, height: 10 } }).success).toBe(false);
    expect(rackTargetFromText("depth:600")).toEqual({ depth: 600 });
    expect(rackTargetFromText("layer:chart")).toEqual({ layer: "chart" });
  });

  it("uses the Surface world matrix and the selected elevation", () => {
    const evaluation = { nodes: [{ id: target.surface, world: matrixFor(TransformSchema.parse({ x: 10, z: 50, scale: 2 })) }] };
    expect(resolveTarget({ ...target, at: [1, 0] }, anchors, evaluation)).toMatchObject({ ok: true, point: [90, -40, 170] });
    expect(resolveTarget({ ...target, plane: "base" }, anchors, evaluation)).toMatchObject({ ok: true, point: [10, 0, 60] });
    expect(resolveTarget({ ...target, anchor: "missing" }, anchors, evaluation)).toEqual({ ok: false, code: "target-missing" });
  });

  it("frames first, composes second, and focuses on the final depth", () => {
    const constraints: SceneConstraintInput[] = [
      { kind: "focusFollow", target },
      { kind: "lookAt", target, compose: [33, 55] },
      { kind: "frame", target, fill: 0.4 },
    ];
    const result = evaluateScene({ nodes: [{ id: target.surface }], camera: { perspective: 4000, zoom: 1.2 }, constraints },
      { [target.surface]: { width: 400, height: 200 } }, { elements: anchors, frame });
    expect(result.issues).toEqual([]);
    const report = result.targets![0];
    expect(report.projected!.width / frame.width).toBeCloseTo(0.4, 2);
    expect(report.point![0]).toBeCloseTo(264, 5);
    expect(report.point![1]).toBeCloseTo(220, 5);
    expect(result.focus!.distance).toBeCloseTo(report.depth, 8);
    expect(report.blur).toBeLessThan(0.5);
    const conflict = evaluateScene({ nodes: [{ id: target.surface }], constraints: [...constraints, constraints[2]] }, {},
      { elements: anchors, frame });
    expect(conflict.issues).toContainEqual(expect.objectContaining({ code: "target-frame-conflict" }));
  });

  it("reevaluates a live focus rack without storing measured depths", () => {
    const clip = buildRackFocus({ from: target, to: { depth: 2000 }, atMs: 0, durationMs: 600, breathing: { amount: 0.018, direction: "in" } });
    expect(clip.source).toMatchObject({ rack: "element", params: { from: target, to: { depth: 2000 } } });
    expect(clip.source?.params).not.toHaveProperty("depths");
    const rack = liveRacks({ durationMs: 600, tracks: [], clips: [clip] })[0];
    const sample = (elevation: number) => evaluateScene({ nodes: [{ id: target.surface }], camera: { perspective: 3000 } }, {},
      { elements: { ...anchors, matches: { [elementKey(target)]: [{ ...anchor, elevation }] } }, frame, rack: { ...rack, progress: 0.5 } });
    expect(sample(50).focus!.distance - sample(250).focus!.distance).toBeCloseTo(100, 7);
  });

  it("resolves a classified layer as the other live rack endpoint", () => {
    const layer = { layer: "chart", surface: target.surface };
    const chart: AnchorMeasurement = { ...anchor, target: { surface: target.surface, selector: "#chart" }, layerMatch: { selector: "#chart" }, elevation: 25 };
    const clip = buildRackFocus({ from: target, to: layer, atMs: 0, durationMs: 600 });
    const [rack] = liveRacks({ durationMs: 600, tracks: [], clips: [clip] });
    const options = { rack: { ...rack, progress: 1 }, frame };
    const scene = { nodes: [{ id: target.surface }], camera: { perspective: 3000 } };
    const result = evaluateScene(scene, {}, { ...options, elements: { ...anchors, entries: [anchor, chart] } });
    expect(result.issues).toEqual([]);
    expect(result.focus?.distance).toBeCloseTo(2975);
    expect(evaluateScene(scene, {}, { ...options, elements: anchors }).issues).toContainEqual(expect.objectContaining({ code: "target-missing", path: "motion.rack.to" }));
  });
});
