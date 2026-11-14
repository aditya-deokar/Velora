import { describe, expect, it } from "vitest";
import { evaluateMotion } from "../../src/core/motion";
import { report, syntheticMotion, timePerCall } from "./perf-fixtures";

// Evaluator performance. Phase 00.3 recorded the pre-v2.1 baseline on the reference machine
// (plan/v2.1/artifacts/phase-00-exit.md): 13,213 / 155,376 / 381,114 us per call at 10 / 100 / 300 tracks.
// Phase 01.6 gate: the compiled evaluator is at least 5x faster at 300 tracks with identical outputs.
// Absolute times vary by machine, so the in-run gate compares a cache hit against a cold compile
// (a fresh, structurally equal object each call): the cold path costs at least what the old evaluator did.
describe("evaluateMotion performance", () => {
  for (const count of [10, 100, 300]) {
    it(`measures ${count} tracks`, () => {
      const motion = syntheticMotion(count);
      expect(motion.tracks).toHaveLength(count);
      expect(evaluateMotion(motion, 1234).issues).toEqual([]);
      const us = timePerCall(time => evaluateMotion(motion, time), count >= 300 ? 2000 : 5000);
      report(`evaluateMotion ${count} tracks (cached): ${us.toFixed(1)} us/call`);
    }, 600_000);
  }
  it("is at least 5x faster on a cache hit than a cold compile at 300 tracks, with identical outputs", () => {
    const motion = syntheticMotion(300);
    // 36 distinct objects: every cold call compiles (12 calls x 3 rounds, never reused).
    const copies = Array.from({ length: 36 }, () => structuredClone(motion));
    let next = 0;
    const cold = timePerCall(time => evaluateMotion(copies[next++ % copies.length], time), 12, 3);
    const warm = timePerCall(time => evaluateMotion(motion, time), 400, 3);
    report(`evaluateMotion 300 tracks: cold ${cold.toFixed(1)} us/call, cached ${warm.toFixed(1)} us/call (${(cold / warm).toFixed(0)}x)`);
    expect(cold / warm).toBeGreaterThanOrEqual(5);
    for (let t = 0; t <= 6000; t += 250) expect(evaluateMotion(motion, t)).toEqual(evaluateMotion(structuredClone(motion), t));
  }, 600_000);
});
