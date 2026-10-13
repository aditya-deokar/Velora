import { describe, expect, it } from "vitest";
import {
  frameAt, localTime, nextBoundary, prevBoundary, segmentAt,
  timeAtFrame, timelineDuration, timelineFromComposition, validateTimeline,
} from "../../src/core/timeline";

describe("canonical frame clock", () => {
  it.each([30, 60, 120])("round-trips frame<->time at %i fps", (fps) => {
    for (const frame of [0, 1, 29, 30, 179, 180, 3600]) {
      const timeMs = timeAtFrame(frame, fps);
      expect(frameAt(timeMs, fps)).toBe(frame);
    }
  });
  it("documents rounding once: halves round up to the later frame", () => {
    expect(frameAt(50, 30)).toBe(2);
    expect(timeAtFrame(2, 30)).toBeCloseTo(66.6667, 3);
  });
  it("rejects non-finite, negative and non-integer inputs", () => {
    for (const fn of [() => frameAt(NaN, 30), () => frameAt(-1, 30), () => timeAtFrame(1.5, 30), () => timeAtFrame(0, 0), () => frameAt(0, 24.5)])
      expect(fn).toThrow();
  });
});

describe("segment resolution", () => {
  const timeline = { durationMs: 9000, segments: [
    { id: "a", recipe: "alpha", startMs: 0, durationMs: 3000 },
    { id: "b", recipe: "beta", startMs: 5000, durationMs: 4000 },
  ] };
  it("owns its half-open interval and reports gaps as undefined", () => {
    expect(segmentAt(timeline, 0)?.id).toBe("a");
    expect(segmentAt(timeline, 2999.99)?.id).toBe("a");
    expect(segmentAt(timeline, 3000)).toBeUndefined();
    expect(segmentAt(timeline, 4000)).toBeUndefined();
    expect(segmentAt(timeline, 5000)?.id).toBe("b");
    expect(segmentAt(timeline, 9000)).toBeUndefined();
  });
  it("maps global time to scene-local time with trim offset", () => {
    expect(localTime({ startMs: 5000 }, 6000)).toBe(1000);
    expect(localTime({ startMs: 5000, inMs: 250 }, 6000)).toBe(1250);
  });
  it("jumps to segment boundaries for CLI-driven agents", () => {
    expect(nextBoundary({ ...timeline }, 0)).toBe(3000);
    expect(nextBoundary({ ...timeline }, 3000)).toBe(9000);
    expect(nextBoundary({ ...timeline }, 9000)).toBeUndefined();
    expect(prevBoundary(timeline, 9000)).toBe(5000);
    expect(prevBoundary(timeline, 5000)).toBe(0);
    expect(prevBoundary(timeline, 0)).toBeUndefined();
  });
  it("derives duration from the span", () => {
    expect(timelineDuration(timeline.segments)).toBe(9000);
    expect(timelineDuration([])).toBe(0);
  });
});

describe("timeline validation", () => {
  it("accepts butt-joined timelines with explicit gaps", () => {
    expect(validateTimeline({ version: 1, fps: 30, durationMs: 9000, segments: [
      { id: "a", recipe: "alpha", startMs: 0, durationMs: 3000 },
      { id: "b", recipe: "beta", startMs: 5000, durationMs: 4000 },
    ] })).toEqual({ valid: true, issues: [] });
  });
  it("rejects overlaps and span mismatches with stable codes", () => {
    const overlap = validateTimeline({ version: 1, fps: 30, durationMs: 6000, segments: [
      { id: "a", recipe: "alpha", startMs: 0, durationMs: 4000 },
      { id: "b", recipe: "beta", startMs: 3000, durationMs: 3000 },
    ] });
    expect(overlap.valid).toBe(false);
    expect(overlap.issues[0].code).toBe("ERR_TIMELINE_OVERLAP");
    const span = validateTimeline({ version: 1, fps: 30, durationMs: 1000, segments: [{ id: "a", recipe: "alpha", startMs: 0, durationMs: 4000 }] });
    expect(span.valid).toBe(false);
    const shape = validateTimeline({ version: 1, fps: 24, durationMs: 0, segments: [] });
    expect(shape.valid).toBe(false);
    expect(shape.issues[0].code).toBe("ERR_TIMELINE_INVALID");
  });
  it("builds timelines from validated compositions", () => {
    const timeline = timelineFromComposition({ fps: 60, scenes: [
      { id: "s1", recipe: "r1", startMs: 0, durationMs: 1000 },
      { id: "s2", recipe: "r2", startMs: 1000, durationMs: 2000 },
    ] });
    expect(timeline).toMatchObject({ version: 1, fps: 60, durationMs: 3000 });
    expect(validateTimeline(timeline).valid).toBe(true);
  });
});
