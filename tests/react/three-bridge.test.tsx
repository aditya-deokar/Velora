// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { WebGLSurface } from "../../src/react/three-bridge";
import type { SceneIssue } from "../../src/core/scene";

afterEach(cleanup);
function diagnostics() {
  const issues: SceneIssue[][] = [];
  return { issues, onDiagnostics: (found: SceneIssue[]) => { issues.push(found); } };
}
it("reports ERR_WEBGL_CONTEXT with fallback when no context exists", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const probe = diagnostics();
  render(<WebGLSurface timeMs={100} render={() => { throw new Error("must not run"); }} fallback={<span>Static poster</span>} onDiagnostics={probe.onDiagnostics} />);
  expect(screen.getByText("Static poster")).toBeDefined();
  expect(probe.issues.flat().map((i) => i.path)).toContain("canvas");
  expect(probe.issues.flat()[0].message).toContain("ERR_WEBGL_CONTEXT");
});
it("drives rendering purely from timeMs and validates scene bounds", () => {
  const calls: { t: number; seed: number }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ __fake: true } as never);
  const probe = diagnostics();
  const view = render(<WebGLSurface scene={{ seed: 9 }} timeMs={250} render={(_gl, time) => { calls.push({ t: time.t, seed: time.seed }); }} onDiagnostics={probe.onDiagnostics} />);
  expect(calls).toEqual([{ t: 250, seed: 9 }]);
  act(() => { view.rerender(<WebGLSurface scene={{ seed: 9 }} timeMs={250} render={(_gl, time) => { calls.push({ t: time.t, seed: time.seed }); }} onDiagnostics={probe.onDiagnostics} />); });
  expect(calls).toEqual([{ t: 250, seed: 9 }, { t: 250, seed: 9 }]);
  const bad = diagnostics();
  render(<WebGLSurface scene={{ pixelRatioCap: 9 }} timeMs={0} render={() => {}} onDiagnostics={bad.onDiagnostics} />);
  expect(bad.issues.flat()[0].path).toContain("scene");
});
