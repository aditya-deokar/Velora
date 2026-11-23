import { describe, expect, it } from "vitest";
import { applyEdits, EditOpSchema, type EditOp } from "../../src/core/edit";
import { CompositionSchema, compositionSourceRanges } from "../../src/core/composition";
import { planCompositionSnap } from "../../src/core/composition-edit";
import { frameAt, layersAt, timeAtFrame, timelineFromComposition, validateTimeline } from "../../src/core/timeline";
import { formatJsonDocument } from "../../src/core/json";

const document = {
  version: 1, id: "launch", title: "Launch", width: 640, height: 360, fps: 30,
  scenes: [
    { id: "a", recipe: "one", startMs: 0, durationMs: 2000, inMs: 300 },
    { id: "b", recipe: "two", startMs: 2000, durationMs: 2000, inMs: 300 },
    { id: "c", recipe: "three", startMs: 4000, durationMs: 2000 },
  ],
};
const apply = (base: unknown, ops: unknown) => applyEdits(base, ops, { target: "composition" });
function edit(base: unknown, ...ops: EditOp[]) {
  const result = apply(base, ops);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { ...result, parsed: CompositionSchema.parse(result.composition) };
}

describe("composition EditOps", () => {
  it("ripples both edges and removes a shot while keeping downstream shots joined", () => {
    const out = edit(document, { op: "segment.trim", id: "a", edge: "out", deltaMs: -100, mode: "ripple" }).parsed;
    expect(out.scenes.map(clip => [clip.startMs, clip.durationMs])).toEqual([[0, 1900], [1900, 2000], [3900, 2000]]);
    const start = edit(document, { op: "segment.trim", id: "b", edge: "in", deltaMs: 200, mode: "ripple" }).parsed;
    expect(start.scenes.map(clip => [clip.startMs, clip.durationMs, clip.inMs])).toEqual([[0, 2000, 300], [2000, 1800, 500], [3800, 2000, undefined]]);
    const shortened = edit(document, { op: "segment.remove", id: "b", ripple: true }).parsed;
    expect(shortened.scenes.map(clip => [clip.id, clip.startMs])).toEqual([["a", 0], ["c", 2000]]);
  });
  it("rolls a shared cut without changing its span and slips by changing only the source in", () => {
    const roll = edit(document, { op: "segment.roll", leftId: "a", rightId: "b", deltaMs: -125 }).parsed;
    expect(roll.scenes.map(clip => [clip.startMs, clip.durationMs, clip.inMs])).toEqual([[0, 1875, 300], [1875, 2125, 175], [4000, 2000, undefined]]);
    expect(edit(document, { op: "segment.slip", id: "b", deltaMs: 225 }).parsed.scenes[1]).toEqual({ ...document.scenes[1], inMs: 525 });
  });
  it("splits a slipped shot into spans with identical source times, including the cut frame", () => {
    const before = timelineFromComposition(CompositionSchema.parse(document));
    const split = edit(document, { op: "segment.split", id: "a", atMs: timeAtFrame(21, 30), newId: "a-2" });
    const after = timelineFromComposition(split.parsed);
    for (let frame = 0; frame < frameAt(before.durationMs, 30); frame++) {
      const time = timeAtFrame(frame, 30);
      expect(layersAt(after, time).segments.map(entry => [entry.segment.recipe, Math.round(entry.localMs * 1e8)]))
        .toEqual(layersAt(before, time).segments.map(entry => [entry.segment.recipe, Math.round(entry.localMs * 1e8)]));
    }
    expect(edit(split.composition, ...split.inverse).composition).toEqual(document);
  });
  it("reuses transition validation for a three-way blend and a window the size of the shot", () => {
    const first = edit(document, { op: "transition.set", segmentId: "b", type: "crossfade", durationMs: 1200, mode: "overlap" });
    const threeWay = apply(first.composition, [{ op: "transition.set", segmentId: "c", type: "wipe", durationMs: 1200, mode: "overlap" }]);
    expect(threeWay).toMatchObject({ ok: false, issues: [{ code: "ERR_TIMELINE_OVERLAP", path: "composition.scenes.2", message: expect.stringContaining("three segments") }] });
    expect(apply(document, [{ op: "transition.set", segmentId: "b", type: "crossfade", durationMs: 2000 }])).toMatchObject({ ok: false, issues: [{ code: "ERR_TIMELINE_OVERLAP" }] });
    expect(apply(first.composition, [{ op: "segment.move", id: "b", atMs: 2000 }])).toMatchObject({ ok: false, issues: expect.arrayContaining([{ code: "ERR_TIMELINE_OVERLAP", message: expect.any(String), path: "composition.scenes.1" }]) });
    expect(edit(first.composition, { op: "transition.remove", segmentId: "b" }).composition).toEqual(document);
  });
  it("accepts fractional frame edits and applies a whole beat snap with a single exact inverse", () => {
    const doc = { ...document, markers: [{ kind: "beat", atMs: 1960 }, { kind: "downbeat", atMs: 3900 }] };
    const plan = planCompositionSnap(CompositionSchema.parse(doc));
    const result = edit(doc, ...plan.ops);
    expect(result.parsed.scenes.map(clip => clip.startMs)).toEqual([0, 1960, 3900]);
    expect(result.inverse).toHaveLength(1);
    expect(edit({ ...result.composition, title: "External title" }, ...result.inverse).composition).toEqual({ ...doc, title: "External title" });
    const trimmed = edit(document, { op: "segment.trim", id: "b", edge: "out", deltaMs: -1000 / 30, mode: "ripple" });
    expect(validateTimeline(timelineFromComposition(trimmed.parsed)).valid).toBe(true);
  });
  it("round-trips mixed overlay, audio, marker, caption and look edits with exact sparse JSON", () => {
    const ops: EditOp[] = [
      { op: "segment.add", recipe: "last", atMs: 6100, durationMs: 900 }, { op: "segment.reorder", id: "last", beforeId: "a" },
      { op: "overlay.add", recipe: "one", id: "badge", atMs: 50, durationMs: 950 }, { op: "overlay.move", id: "badge", atMs: 80 },
      { op: "overlay.trim", id: "badge", edge: "in", deltaMs: 80 }, { op: "overlay.set", id: "badge", opacity: 0.5, blend: "multiply" },
      { op: "audio.add", id: "music", assetId: "tone", startMs: 100 }, { op: "audio.move", id: "music", atMs: 200 },
      { op: "audio.trim", id: "music", edge: "out", deltaMs: -400, endMs: 1800 }, { op: "audio.trim", id: "music", edge: "in", deltaMs: 100 },
      { op: "audio.set", id: "music", gain: 0.8, fadeInMs: 100, fadeOutMs: 200 },
      { op: "marker.add", atMs: 100, label: "Verse", kind: "section" }, { op: "marker.move", index: 0, atMs: 150, fromMs: 100 },
      { op: "captions.set", captions: { file: "subs.srt", style: "karaoke" } }, { op: "look.set", look: { preset: "noir" } },
    ];
    expect(ops.every(op => EditOpSchema.safeParse(op).success)).toBe(true);
    const result = edit(document, ...ops);
    expect(result.parsed.audio[0]).toMatchObject({ startMs: 300, offsetMs: 100, durationMs: 1100, gain: 0.8 });
    expect(result.parsed.overlays[0]).toMatchObject({ startMs: 160, inMs: 80, opacity: 0.5 });
    expect(edit(result.composition, ...result.inverse).composition).toEqual(document);
    const removed = edit(result.composition, { op: "overlay.remove", id: "badge" }, { op: "audio.remove", id: "music" }, { op: "marker.remove", index: 0 });
    expect(removed.parsed).toMatchObject({ overlays: [], audio: [], markers: [] });
    const text = "\ufeff" + JSON.stringify(document, null, 2).replaceAll("\n", "\r\n") + "\r\n";
    expect(formatJsonDocument(text, edit(document).composition)).toBe(text);
    expect(applyEdits(document, ops)).toMatchObject({ ok: false, issues: [{ code: "ERR_EDIT_TARGET" }] });
  });
  it("warns for a shortened moving source and permits stills", () => {
    const composition = CompositionSchema.parse(document);
    const scenes = ["one", "two"].map((id, index) => ({ id, definition: { width: 640, height: 360, scene: { nodes: [] },
      ...(index ? {} : { motion: { durationMs: 2000, speed: 1, tracks: [] } }) } })) as never;
    expect(compositionSourceRanges(composition, { scenes })).toMatchObject([{ code: "ERR_COMPOSITION_SOURCE_RANGE", path: "composition.scenes.0" }]);
  });
});
