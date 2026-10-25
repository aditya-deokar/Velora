// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scene, Surface, useChannel } from "../../src/react";
import type { MotionInput } from "../../src/core/motion";

// Motion v2 visual properties style the content leaf (never the spatial node), and channel
// tracks reach components through useChannel on the same clock.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return parseFloat(this.style.width) || 400; });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return parseFloat(this.style.height) || 300; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const leaf = (id: string) => document.querySelector<HTMLDivElement>(`[data-velora-id="${id}"] > [data-velora-content]`)!;
const spatial = (id: string) => document.querySelector<HTMLDivElement>(`[data-velora-id="${id}"]`)!;
const surface = (property: string, from: number, to: number) =>
  ({ target: { kind: "surface" as const, id: "card" }, property, keyframes: [{ timeMs: 0, value: from, easing: "linear" as const }, { timeMs: 1000, value: to }] });
function Counter() {
  return <output data-testid="counter">{Math.round(useChannel("revenue", -1))}</output>;
}

describe("content-leaf visuals", () => {
  it("applies opacity, inset clip and artistic blur without touching the spatial transform", () => {
    const motion = { durationMs: 1000, speed: 1, tracks: [surface("opacity", 0, 1), surface("clipRight", 100, 0), surface("blur", 8, 0), surface("x", 0, 100)] } as MotionInput;
    render(<Scene motion={motion} timeMs={500} focus={{ maxBlur: 0 }}><Surface id="card" style={{ width: 400, height: 300 }}>card</Surface></Scene>);
    expect(leaf("card").style.opacity).toBe("0.5");
    expect(leaf("card").style.clipPath).toBe("inset(0% 50% 0% 0%)");
    expect(leaf("card").style.filter).toBe("blur(4px)");
    expect(spatial("card").style.transform).toContain("translate3d(50px");
    expect(spatial("card").style.transform).not.toMatch(/blur|clip|opacity/);
  });
  it("prefers an iris circle over inset clips", () => {
    const motion = { durationMs: 1000, speed: 1, tracks: [surface("clipRadius", 0, 75), surface("clipTop", 10, 10)] } as MotionInput;
    render(<Scene motion={motion} timeMs={1000} focus={{ maxBlur: 0 }}><Surface id="card" style={{ width: 400, height: 300 }}>card</Surface></Scene>);
    expect(leaf("card").style.clipPath).toBe("circle(75% at 50% 50%)");
  });
  it("leaves unanimated leaves unclipped and unfiltered", () => {
    render(<Scene focus={{ maxBlur: 0 }}><Surface id="card" style={{ width: 400, height: 300 }}>card</Surface></Scene>);
    expect(leaf("card").style.clipPath).toBe("");
    expect(leaf("card").style.filter).toBe("none");
  });
});

describe("useChannel", () => {
  it("reads the channel value at scene time and falls back when absent", () => {
    const motion = { durationMs: 1000, speed: 1, tracks: [{ target: { kind: "channel" as const, id: "revenue" }, property: "value" as const, keyframes: [{ timeMs: 0, value: 0, easing: "linear" as const }, { timeMs: 1000, value: 12840 }] }] };
    const { getByTestId, rerender } = render(<Scene motion={motion} timeMs={250} focus={{ maxBlur: 0 }}><Surface id="card" style={{ width: 400, height: 300 }}><Counter /></Surface></Scene>);
    expect(getByTestId("counter").textContent).toBe("3210");
    rerender(<Scene motion={motion} timeMs={1000} focus={{ maxBlur: 0 }}><Surface id="card" style={{ width: 400, height: 300 }}><Counter /></Surface></Scene>);
    expect(getByTestId("counter").textContent).toBe("12840");
    rerender(<Scene focus={{ maxBlur: 0 }}><Surface id="card" style={{ width: 400, height: 300 }}><Counter /></Surface></Scene>);
    expect(getByTestId("counter").textContent).toBe("-1");
  });
  it("requires a Scene", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Counter />)).toThrow(/useChannel requires a Velora Scene/);
  });
});
