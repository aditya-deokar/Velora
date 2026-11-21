import { describe, expect, it } from "vitest";
import { applyEdits, CameraSchema, cameraMatrix, classifyDepth, evaluateDepthLayers, evaluateMotion, hashDepthLayers, projectWorld,
  applyPoint, type DepthConfig, type DepthSnapshotNode } from "../../src/core";

const config: DepthConfig = { mode: "auto" };
const style: DepthSnapshotNode["style"] = { position: "static", zIndex: 0, display: "block", visibility: "visible", backgroundAlpha: 0,
  boxShadow: "none", borderWidth: 0, radius: 0, overflow: "visible", opacity: 1, filter: "none", clipPath: "none", mask: "none",
  isolation: "auto", mixBlendMode: "normal", contain: "none" };
const rect = { x: 5, y: 6, width: 200, height: 120 };
function node(order: number, properties: Partial<Omit<DepthSnapshotNode, "style">> & { style?: Partial<DepthSnapshotNode["style"]> } = {}): DepthSnapshotNode {
  return { order, tag: "div", rect, ...properties, style: { ...style, ...properties.style } };
}
const snap = (...nodes: DepthSnapshotNode[]) => ({ width: 800, height: 500, nodes });

describe("depth classification", () => {
  it("applies markup, ordered recipe rules, and automatic tiers", () => {
    const nodes = [node(0, { tag: "aside" }), node(1, { tag: "canvas" }), node(2, { role: "dialog" }), node(3, { tier: "cursor" }),
      node(4, { style: { radius: 15, borderWidth: 1 } }), node(5, { tier: "20px", anchor: "a" }), node(6, { anchor: "b" }),
      node(7, { tier: "none", tag: "input" }), node(8, { tag: "button", selectors: [".action"] }), node(9, { style: { position: "fixed", zIndex: 1 } }),
      node(10, { tier: "flat" }), node(11, { parent: 10, tag: "canvas" })];
    const rules: DepthConfig["rules"] = [{ match: { anchor: "a" }, tier: "floating" }, { match: { anchor: "b" }, z: 32 },
      { match: { selector: ".action" }, tier: "card" }, { match: { tier: "control" }, tier: "container" }];
    expect(classifyDepth(snap(...nodes), { ...config, rules }).map(({ order, tier, z }) => [order, tier, z])).toEqual([
      [0, "container", 8], [1, "container", 8], [2, "floating", 96], [3, "cursor", 120], [4, "card", 24], [5, "container", 20],
      [6, "card", 32], [8, "card", 24], [9, "floating", 96],
    ]);
    expect(classifyDepth(snap(...nodes), { mode: "rules", rules, maxLayers: 1 })[0].order).toBe(3);
    expect(classifyDepth(snap(...nodes), { mode: "off" })).toEqual([]);
  });
  it("ranks by tier and area, preserves relative nesting, and reports grouping ancestors", () => {
    const snap1 = snap(node(0, { tier: "card", style: { overflow: "hidden" } }), node(1, { parent: 0, tag: "button" }), node(2, { parent: 0, tag: "aside" }));
    const layers = classifyDepth(snap1, config);
    expect(layers.map(layer => [layer.z, layer.localZ])).toEqual([[24, 24], [40, 16], [24, 0]]);
    expect(layers[1].flattened).toEqual({ order: 0, property: "overflow" });
    expect(classifyDepth(snap(node(0, { tag: "button", rect: { ...rect, width: 30 } }), node(1, { tag: "button" }), node(2, { tag: "button" })), { ...config, maxLayers: 1 })[0].order).toBe(1);
  });
  it("classifies 1,000 seeded trees deterministically", { timeout: 30000 }, () => {
    let seed = 21;
    const next = (size: number) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % size;
    for (let iteration = 0; iteration < 1000; iteration++) {
      const nodes = Array.from({ length: 32 }, (_, order) => node(order, { parent: order ? next(order) : undefined,
        tag: ["aside", "button", "canvas", "dialog", "div"][next(5)], rect: { ...rect, width: 10 + next(300), height: 10 + next(200) } }));
      const data = snap(...nodes);
      expect(classifyDepth(data, config)).toEqual(classifyDepth(JSON.parse(JSON.stringify(data)), config));
    }
  });
});

describe("depth math and edits", () => {
  it("projects the raised center back onto the parent plane and moves the sheen with the camera", () => {
    const layers = classifyDepth(snap(node(0, { tier: "card" }), node(1, { parent: 0, tier: "control" })), config);
    const frames = [-20, 0, 20].map(rotateY => {
      const camera = CameraSchema.parse({ rotateY, perspective: 1450 });
      const evaluated = evaluateDepthLayers(cameraMatrix(camera), layers, camera, { azimuthDeg: 0, elevationDeg: 45 });
      const [parent, child] = evaluated;
      expect(child.shadow.x).toBeCloseTo(16);
      expect(child.shadow.z).toBe(24);
      const parentCenter = [layers[0].rect.x + rect.width / 2, layers[0].rect.y + rect.height / 2];
      const u = parentCenter[0] + parent.projected.x + child.projected.x * parent.projected.scale;
      const v = parentCenter[1] + parent.projected.y + child.projected.y * parent.projected.scale;
      const expected = projectWorld(camera, { width: 0, height: 0 }, child.world, "view")!;
      const mapped = projectWorld(camera, { width: 0, height: 0 }, applyPoint(cameraMatrix(camera), [u, v, 0]), "view")!;
      expect(mapped.x).toBeCloseTo(expected.x, 7);
      expect(mapped.y).toBeCloseTo(expected.y, 7);
      expect(evaluateDepthLayers(cameraMatrix(camera), layers, camera, undefined, "subtle", 0.5)[1].z).toBe(10);
      return child.sheen.u;
    });
    expect(frames[0]).toBeGreaterThan(frames[1]);
    expect(frames[1]).toBeGreaterThan(frames[2]);
  });
  it("bakes with a verified hash, moves elevation on the motion clock, and undoes exactly", () => {
    const recipe = { version: 1, id: "demo", title: "Demo", definition: { scene: { nodes: [{ id: "subject" }] } } };
    const layers = [{ match: { anchor: "revenue" }, tier: "card" as const, z: 24 }];
    const resolved = { layers, hash: hashDepthLayers(layers) };
    const edit = applyEdits(recipe, [{ op: "depth.set", surface: "subject", config },
      { op: "depth.rule.add", surface: "subject", rule: { match: { tier: "container" }, z: 11 } },
      { op: "depth.rule.remove", surface: "subject", index: 0 }, { op: "depth.resolve", surface: "subject", resolved }]);
    expect(edit).toMatchObject({ ok: true, recipe: { definition: { depth: { subject: { resolved } } } } });
    if (edit.ok) expect(applyEdits(edit.recipe, edit.inverse)).toMatchObject({ ok: true, recipe });
    expect(evaluateMotion({ durationMs: 1000, speed: 1, tracks: [{ target: { kind: "surface", id: "subject" }, property: "elevation", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1 }] }] }, 500).surfaces.subject.elevation).toBeCloseTo(0.5);
  });
});
