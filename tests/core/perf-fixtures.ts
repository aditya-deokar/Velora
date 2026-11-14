import { appendFileSync } from "node:fs";
import type { MotionInput } from "../../src/core/motion";

/** Deterministic synthetic motion for evaluator benchmarks (Phase 00 baselines, Phase 01 speedup gate).
 * A realistic mix: eased segment tracks with 5 keyframes, smooth rails, noise and channels. */
const properties = ["x", "y", "z", "rotateX", "rotateY", "rotateZ", "scale", "opacity"] as const;
const easings = ["cinematic", "expo.out", "easeInOut", "linear", { cubicBezier: [0.2, 0, 0, 1] }, { spring: { stiffness: 170, damping: 26 } }] as const;
export function syntheticMotion(trackCount: number): MotionInput {
  const tracks: unknown[] = [];
  for (let i = 0; i < trackCount; i++) {
    const kind = i % 10;
    const keyframes = Array.from({ length: 5 }, (_, k) => ({
      timeMs: k * 1500,
      value: property(i) === "scale" ? 1 + 0.1 * ((i + k) % 3) : property(i) === "opacity" ? ((i + k) % 2) * 0.5 + 0.5 : ((i * 37 + k * 53) % 400) - 200,
      easing: easings[(i + k) % easings.length],
    }));
    if (kind === 9) tracks.push({ target: { kind: "channel", id: `channel-${i}` }, property: "value", keyframes });
    else if (kind === 8) tracks.push({ target: i < 30 ? { kind: "camera" } : { kind: "channel", id: `rail-${i}` }, property: i < 30 ? ["x", "y", "z"][Math.floor(i / 10)] : "value", keyframes: keyframes.map(({ timeMs, value }) => ({ timeMs, value })), interpolation: "smooth", ease: "cinematic", ...(i % 20 === 8 ? { noise: { amplitude: 4, seed: i } } : {}) });
    else tracks.push({ target: { kind: "surface", id: `surface-${Math.floor(i / properties.length)}` }, property: property(i), keyframes });
  }
  return { durationMs: 6000, speed: 1, tracks: tracks as MotionInput["tracks"] };
}
function property(i: number) {
  return properties[i % properties.length];
}
/** Median microseconds per call over `rounds`, scrubbing across the timeline. */
export function timePerCall(run: (timeMs: number) => void, calls: number, rounds = 7): number {
  const results: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    for (let i = 0; i < calls; i++) run((i * 6000) / calls);
    results.push(((performance.now() - start) * 1000) / calls);
  }
  results.sort((a, b) => a - b);
  return results[Math.floor(results.length / 2)];
}
/** Print a measurement and, when VELORA_PERF_OUT names a file, append it there (exit-report evidence). */
export function report(line: string) {
  console.info(`[perf] ${line}`);
  if (process.env.VELORA_PERF_OUT) appendFileSync(process.env.VELORA_PERF_OUT, `${line}
`);
}
