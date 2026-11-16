import { describe, expect, it } from "vitest";
import { snapTime, quantize } from "../../src/editor/timeline/snap";
import { timeAtFrame, frameAt } from "../../src/core";

describe("timeline snapping", () => {
  const options = { fps: 60, pxPerMs: 0.5, enabled: true };
  it("quantizes with the core frame math", () => {
    for (const time of [0, 7.9, 16.7, 1000.4, 2345.6]) expect(quantize(time, 60)).toBe(timeAtFrame(frameAt(time, 60), 60));
    expect(snapTime(1003, { ...options, candidates: [] })).toEqual({ timeMs: quantize(1003, 60), kind: "frame" });
  });
  it("snaps to the nearest candidate inside the pixel threshold, priority on ties", () => {
    const candidates = [{ timeMs: 1000, kind: "keyframe" as const }, { timeMs: 1010, kind: "marker" as const }];
    expect(snapTime(1009, { ...options, candidates }).kind).toBe("marker");
    expect(snapTime(1005, { ...options, candidates: [{ timeMs: 1000, kind: "marker" }, { timeMs: 1010, kind: "playhead" }] }).kind).toBe("playhead");
    expect(snapTime(1050, { ...options, candidates }).kind).toBe("frame");
  });
  it("converts the threshold per zoom and suspends when disabled", () => {
    const candidates = [{ timeMs: 1000, kind: "keyframe" as const }];
    expect(snapTime(1030, { ...options, pxPerMs: 0.1, candidates }).kind).toBe("keyframe");
    expect(snapTime(1030, { ...options, pxPerMs: 1, candidates }).kind).toBe("frame");
    expect(snapTime(1002, { ...options, enabled: false, candidates }).kind).toBe("frame");
  });
});
