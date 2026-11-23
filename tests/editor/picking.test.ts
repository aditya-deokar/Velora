import { describe, expect, it } from "vitest";
import { CameraSchema, evaluateScene } from "../../src/core";
import type { SceneSnapshot } from "../../src/react";
import { combineSelection, enterGroup, exitGroup, hitStack, marquee, pick, pickables, pointInQuad } from "../../src/editor/viewport/picking";

const frame = { width: 1400, height: 980 };
type Spec = { id: string; parentId?: string; transform?: Record<string, number>; width?: number; height?: number; offsetX?: number; offsetY?: number };
export function snapshotOf(specs: Spec[], camera: Record<string, number> = { perspective: 1800 }): SceneSnapshot {
  const measurements = Object.fromEntries(specs.map(spec => [spec.id, { width: spec.width ?? 200, height: spec.height ?? 120, offsetX: spec.offsetX ?? 0, offsetY: spec.offsetY ?? 0 }]));
  const evaluation = evaluateScene({ camera, nodes: specs.map(spec => ({ id: spec.id, ...(spec.parentId ? { parentId: spec.parentId } : {}), transform: spec.transform ?? {} })) }, measurements);
  return {
    revision: 1, timeMs: 0,
    bindings: specs.map(spec => ({ id: spec.id, ...(spec.parentId ? { parentId: spec.parentId } : {}), ...(spec.transform ? { transform: spec.transform } : {}), measurement: measurements[spec.id], mounted: true as const })),
    nodes: evaluation.nodes.map(node => ({ id: node.id, world: node.world, blur: node.blur, depth: node.worldPosition.z, width: node.width, height: node.height })),
    animatables: [], motion: { surfaces: {}, camera: {}, focus: {}, channels: {}, issues: [] }, issues: [],
    camera: evaluation.camera, focus: evaluation.focus,
  };
}
const camera = CameraSchema.parse({ perspective: 1800 });

describe("viewport picking", () => {
  it("orders hits by camera depth, nearest first", () => {
    const snapshot = snapshotOf([{ id: "back", transform: { z: -300 } }, { id: "front", transform: { z: 200 } }, { id: "middle" }]);
    const items = pickables(snapshot, camera, frame);
    expect(items.map(item => item.id)).toEqual(["front", "middle", "back"]);
    expect(hitStack(items, { x: 700, y: 490 })).toEqual(["front", "middle", "back"]);
    expect(pick(items, { x: 700, y: 490 })).toBe("front");
  });
  it("hits respect perspective: a far layer projects smaller", () => {
    const snapshot = snapshotOf([{ id: "far", transform: { z: -1800 }, width: 400, height: 400 }]);
    const [item] = pickables(snapshot, camera, frame);
    // At depth 3600 the 400 px layer projects to 200 px: 100 px from center is the edge.
    expect(pointInQuad({ x: 700 + 99, y: 490 }, item.quad)).toBe(true);
    expect(pointInQuad({ x: 700 + 101, y: 490 }, item.quad)).toBe(false);
  });
  it("Alt-click cycles the stack under the cursor", () => {
    const items = pickables(snapshotOf([{ id: "a", transform: { z: 10 } }, { id: "b" }, { id: "c", transform: { z: -10 } }]), camera, frame);
    const at = { x: 700, y: 490 };
    expect(pick(items, at, { cycle: true, current: "a" })).toBe("b");
    expect(pick(items, at, { cycle: true, current: "b" })).toBe("c");
    expect(pick(items, at, { cycle: true, current: "c" })).toBe("a");
  });
  it("skips locked and hidden layers (and the children of a locked group)", () => {
    const snapshot = snapshotOf([{ id: "top", transform: { z: 50 } }, { id: "group", width: 600, height: 400 }, { id: "child", parentId: "group", transform: { z: 20 } }, { id: "bottom", transform: { z: -50 } }]);
    const items = pickables(snapshot, camera, frame, { locked: ["top", "group"], hidden: ["bottom"] });
    expect(items.map(item => item.id)).toEqual([]);
    expect(pick(pickables(snapshot, camera, frame, { locked: ["top"] }), { x: 700, y: 490 })).toBe("group");
  });
  it("selects groups at the root, enters a group on double-click and goes up with Esc", () => {
    const snapshot = snapshotOf([{ id: "card", width: 600, height: 400 }, { id: "title", parentId: "card", transform: { z: 5 }, width: 300, height: 60, offsetY: -100 }, { id: "body", parentId: "card", transform: { z: 5 }, width: 300, height: 60, offsetY: 100 }]);
    const items = pickables(snapshot, camera, frame);
    const onTitle = { x: 700, y: 490 - 100 };
    expect(pick(items, onTitle)).toBe("card");
    const inside = enterGroup(items, onTitle, "card");
    expect(inside).toEqual({ scope: "card", selected: "title" });
    expect(pick(items, { x: 700, y: 490 + 100 }, { scope: "card" })).toBe("body");
    expect(exitGroup(items, "card")).toEqual({ scope: undefined, selected: "card" });
  });
  it("marquee selects intersecting layers at the scope; Shift adds and Ctrl toggles", () => {
    const items = pickables(snapshotOf([{ id: "left", offsetX: -400 }, { id: "right", offsetX: 400 }, { id: "low", offsetY: 400 }]), camera, frame);
    expect(marquee(items, { x: 100, y: 300 }, { x: 400, y: 600 }).sort()).toEqual(["left"]);
    expect(marquee(items, { x: 0, y: 0 }, { x: 1400, y: 600 }).sort()).toEqual(["left", "right"]);
    expect(combineSelection(["left"], ["right"], "add")).toEqual(["left", "right"]);
    expect(combineSelection(["left", "right"], ["right"], "toggle")).toEqual(["left"]);
    expect(combineSelection(["left"], ["low"], "replace")).toEqual(["low"]);
  });
});
