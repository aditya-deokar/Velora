// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scene, Surface } from "../../src/react";
import type { MotionInput } from "../../src/core";
import { report, syntheticMotion } from "../core/perf-fixtures";

// Scene render + evaluation per scrub step with 60 Surfaces and 300 tracks (v2.1 Phase 00.3 baseline).
// jsdom has no layout or paint: this isolates React reconciliation plus core evaluation.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Stage({ motion, timeMs }: { motion: MotionInput; timeMs: number }) {
  return <Scene motion={motion} timeMs={timeMs} focus={{ maxBlur: 0 }}>
    {Array.from({ length: 60 }, (_, i) => <Surface key={i} id={`surface-${i}`} style={{ width: 200, height: 100 }}><div>{i}</div></Surface>)}
  </Scene>;
}
describe("Scene scrub performance", () => {
  it("measures render plus evaluation per scrub step (60 surfaces, 300 tracks)", () => {
    // 300 tracks over surfaces 0..37 plus channels and camera; surfaces beyond that are static.
    const motion = syntheticMotion(300);
    const view = render(<Stage motion={motion} timeMs={0} />);
    expect(document.querySelectorAll("[data-velora-id]")).toHaveLength(60);
    const steps = 6, samples: number[] = [];
    for (let round = 0; round < 3; round++) {
      const start = performance.now();
      for (let i = 0; i < steps; i++) view.rerender(<Stage motion={motion} timeMs={(i * 6000) / steps} />);
      samples.push((performance.now() - start) / steps);
    }
    samples.sort((a, b) => a - b);
    report(`Scene scrub 60 surfaces / 300 tracks (jsdom): ${samples[1].toFixed(2)} ms/step`);
  }, 600_000);
});
