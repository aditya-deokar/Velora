import { describe, expect, it } from "vitest";
import { RHYTHM_SAMPLE_RATE, analyzeRhythm, snapToBeats } from "../../src/core/rhythm";

// A click track: short decaying 1.5 kHz clicks on every beat (accented downbeats), optional pad noise.
function clicks(bpm: number, seconds: number, offsetMs = 120, noise = 0): Float32Array {
  const rate = RHYTHM_SAMPLE_RATE, out = new Float32Array(Math.round(seconds * rate));
  let seed = 7;
  for (let i = 0; i < out.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; out[i] = noise * ((seed / 2 ** 32) * 2 - 1); }
  const period = 60_000 / bpm;
  for (let k = 0; offsetMs + k * period < seconds * 1000; k++) {
    const start = Math.round(((offsetMs + k * period) / 1000) * rate), gain = k % 4 === 0 ? 1 : 0.6;
    for (let s = 0; s < 0.03 * rate && start + s < out.length; s++) out[start + s] += gain * Math.sin((2 * Math.PI * 1500 * s) / rate) * Math.exp(-s / (0.006 * rate));
  }
  return out;
}
describe("rhythm", () => {
  it.each([90, 120, 150])("finds %i BPM within 1 BPM and beats within 15 ms", bpm => {
    const report = analyzeRhythm(clicks(bpm, 12, 120, 0.02));
    expect(Math.abs(report.bpm - bpm)).toBeLessThanOrEqual(1);
    const period = 60_000 / bpm;
    for (let k = 0; k < 8; k++) {
      const truth = 120 + k * period;
      const nearest = report.beats.reduce((a, b) => Math.abs(b - truth) < Math.abs(a - truth) ? b : a, Infinity);
      expect(Math.abs(nearest - truth), `beat ${k}`).toBeLessThanOrEqual(15);
    }
    expect(report.downbeats.length).toBeGreaterThan(0);
    expect(Math.abs(report.downbeats[0] - 120) % (period * 4)).toBeLessThan(15);
    expect(report.confidence).toBeGreaterThan(0.1);
  });
  it("is deterministic and reports silence honestly", () => {
    const track = clicks(128, 8);
    expect(analyzeRhythm(track)).toEqual(analyzeRhythm(track));
    expect(analyzeRhythm(new Float32Array(RHYTHM_SAMPLE_RATE * 3))).toMatchObject({ bpm: 0, beats: [] });
  });
  it("plans snapping cuts to beats within tolerance, keeping segments joined", () => {
    const beats = [0, 500, 1000, 1500, 2000, 2500, 3000];
    const plan = snapToBeats([{ id: "a", startMs: 0, durationMs: 1040 }, { id: "b", startMs: 1040, durationMs: 1000 }, { id: "c", startMs: 2040, durationMs: 1000 }, { id: "d", startMs: 3040, durationMs: 500, overlapMs: 0 }], beats, 60);
    expect(plan.changes).toEqual([
      { id: "a", field: "durationMs", from: 1040, to: 1000, beatMs: 1000 },
      { id: "b", field: "startMs", from: 1040, to: 1000, beatMs: 1000 },
      { id: "c", field: "startMs", from: 2040, to: 2000, beatMs: 2000 },
      { id: "d", field: "startMs", from: 3040, to: 3000, beatMs: 3000 },
    ]);
    expect(plan.unsnapped).toEqual([]);
    expect(snapToBeats([{ id: "a", startMs: 0, durationMs: 1250 }, { id: "b", startMs: 1250, durationMs: 500 }], beats, 60).unsnapped).toEqual(["b"]);
  });
});
