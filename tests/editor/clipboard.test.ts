import { describe, expect, it } from "vitest";
import { applyEdits } from "../../src/core";
import { CLIPBOARD_TYPE, copyKeyframes, parseClipboard, pasteOps } from "../../src/editor/timeline/clipboard";

const doc = { version: 1, id: "demo", title: "Demo", definition: { scene: { nodes: [{ id: "headline" }, { id: "caption" }] }, motion: { durationMs: 6000, speed: 1, tracks: [
  { target: { kind: "surface", id: "headline" }, property: "y", keyframes: [{ timeMs: 500, value: 40, easing: "expo.out" }, { timeMs: 1300, value: 0 }] }] } } };
const headlineY = { target: { kind: "surface" as const, id: "headline" }, property: "y" };
describe("keyframe clipboard", () => {
  it("copies relative timing and pastes at the playhead as one batch", () => {
    const payload = copyKeyframes(doc, [{ track: headlineY, atMs: 500 }, { track: headlineY, atMs: 1300 }])!;
    expect(payload).toEqual({ type: CLIPBOARD_TYPE, version: 1, tracks: [{ ...headlineY, keyframes: [{ offsetMs: 0, value: 40, easing: "expo.out" }, { offsetMs: 800, value: 0 }] }] });
    expect(parseClipboard(JSON.stringify(payload))).toEqual(payload);
    expect(parseClipboard("{}")).toBeUndefined();
    const pasted = pasteOps(payload, 3000, { kind: "surface", id: "caption" });
    expect(pasted.ok && pasted.ops).toEqual([
      { op: "key.set", track: { target: { kind: "surface", id: "caption" }, property: "y" }, atMs: 3000, value: 40, easing: "expo.out" },
      { op: "key.set", track: { target: { kind: "surface", id: "caption" }, property: "y" }, atMs: 3800, value: 0 }]);
    const result = applyEdits(doc, pasted.ok ? pasted.ops : []);
    expect(result.ok).toBe(true);
  });
  it("refuses incompatible targets", () => {
    const payload = copyKeyframes(doc, [{ track: headlineY, atMs: 500 }])!;
    expect(pasteOps(payload, 0, { kind: "camera" })).toMatchObject({ ok: false });
  });
});
