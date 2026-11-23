import { describe, expect, it } from "vitest";
import { applyEdits, evaluateMotion, type EditOp } from "../../src/core";
import { bakeDeviation, groupOps } from "../../src/editor/group";
import { sequenceOps } from "../../src/editor/MotionDesign";
import type { Doc, Selection } from "../../src/editor/store";

const address = (id: string) => ({ target: { kind: "surface" as const, id }, property: "x" });
const base = () => ({ version: 1, id: "design", title: "Design", definition: {
  scene: { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] },
  motion: { durationMs: 2200, speed: 1, tracks: ["a", "b", "c"].map(id => ({ ...address(id), keyframes: [
    { timeMs: 125, value: 0, easing: "cubic.out" }, { timeMs: 525, value: 100, easing: "linear" }, { timeMs: 925, value: 150 },
  ] })) },
} });
const selection: Selection = { layers: ["a", "b", "c"], clips: [], keys: [], tracks: [] };
function edit(doc: Doc, ops: EditOp[]) {
  const result = applyEdits(doc, ops);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result;
}
const value = (doc: Doc, atMs: number) => evaluateMotion(doc.definition.motion, atMs).surfaces.a?.x;

describe("Phase 7 group and timing tools", () => {
  it("groups three layers at the first key, keeps rendering unchanged and supports exact undo and ungroup", () => {
    const start = base();
    const { id, ops } = groupOps(start, selection)!;
    const grouped = edit(start, ops);
    const doc = grouped.recipe as Doc;
    expect(doc.definition.motion.clips[0]).toMatchObject({ id, startMs: 125, tracks: Array(3).fill(expect.objectContaining({ keyframes: [expect.objectContaining({ timeMs: 0 }), expect.objectContaining({ timeMs: 400 }), expect.objectContaining({ timeMs: 800 })] })) });
    for (const time of [0, 125, 300, 525, 924, 925, 1500]) expect(value(doc, time)).toBeCloseTo(value(start, time)!, 8);
    expect(edit(doc, grouped.inverse).recipe).toEqual(start);
    expect(edit(doc, [{ op: "clip.dissolve", id }]).recipe).toMatchObject(start);
  });

  it("uses the keys' tracks when grouping and dissolves linear speed and representable trim exactly", () => {
    const start = base();
    const { id, ops } = groupOps(start, { ...selection, keys: [{ track: address("a"), atMs: 525 }] })!;
    const doc = edit(start, [...ops, { op: "clip.update", id, ease: "linear", speed: 1.5, inMs: 400 }]).recipe as Doc;
    const exact = bakeDeviation(doc, id);
    expect(exact).toMatchObject({ ok: true, exact: true, maxDeviation: 0 });
    const dissolved = edit(doc, [{ op: "clip.dissolve", id }]).recipe as Doc;
    for (const time of [0, 125, 200, 300, 500, 600]) expect(value(doc, time)).toBeCloseTo(value(dissolved, time)!, 8);
  });

  it("requires confirmation for nonlinear easing and reports the bake deviation", () => {
    const start = base();
    const { id, ops } = groupOps(start, selection)!;
    const doc = edit(start, [...ops, { op: "clip.update", id, ease: "cubic.out" }]).recipe as Doc;
    expect(applyEdits(doc, [{ op: "clip.dissolve", id }]).ok).toBe(false);
    const preview = bakeDeviation(doc, id);
    expect(preview).toMatchObject({ ok: true, exact: false });
    if (preview.ok) { expect(preview.maxDeviation).toBeGreaterThan(0); expect(preview.property).toMatch(/^[abc]\.x$/); }
    expect(edit(doc, [{ op: "clip.dissolve", id, bake: { samplesPerSecond: 30 } }]).recipe).toMatchObject({ definition: { motion: { clips: [] } } });
  });

  it("sequences layers in selection order with overlap and retimes selected keys atomically", () => {
    const start = base();
    const sequence = edit(start, sequenceOps(start, ["b", "a", "c"], 50, "%")).recipe as Doc;
    expect(sequence.definition.motion.tracks.map((track: Doc) => track.keyframes[0].timeMs)).toEqual([525, 125, 925]);
    const moved = edit(start, [{ op: "keys.retime", refs: [{ track: address("a"), atMs: 125, toMs: 525 }, { track: address("a"), atMs: 525, toMs: 600 }] }]);
    const track = (moved.recipe as Doc).definition.motion.tracks[0];
    expect(track.keyframes.slice(0, 2)).toEqual([{ timeMs: 525, value: 0, easing: "cubic.out" }, { timeMs: 600, value: 100, easing: "linear" }]);
    expect(edit(moved.recipe as Doc, moved.inverse).recipe).toEqual(start);
  });
});
