// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { usePreviewSession, type PreviewTimeline } from "../../src/preview/session";
import type { PreviewDefinitionInput } from "../../src";

// A looping scene wraps the one presentation cursor instead of stopping; timelines never wrap.
// Frames carry timestamps relative to the real clock at play time (React's scheduler needs a
// live performance.now), so assertions allow a few milliseconds of effect latency.
let base = 0, elapsed = 0;
let pending: FrameRequestCallback[] = [];
const advance = (ms: number) => act(() => {
  elapsed += ms;
  const callbacks = pending;
  pending = [];
  for (const callback of callbacks) callback(base + elapsed);
});
const play = () => { base = performance.now(); elapsed = 0; act(() => { screen.getByText("toggle").click(); }); };
beforeEach(() => {
  pending = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { pending.push(callback); return pending.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { pending = []; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
// Stable inputs, as a real recipe would be: a new object per render would reset the session.
const makeDefinition = (loop: boolean): PreviewDefinitionInput => ({
  width: 1000, height: 600,
  scene: { nodes: [{ id: "host" }] },
  motion: { durationMs: 1000, speed: 1, loop, tracks: [{ target: { kind: "camera" }, property: "x", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 500, value: 40 }, { timeMs: 1000, value: 0 }] }] },
});
const looping = makeDefinition(true), once = makeDefinition(false);
function Probe({ loop, timeline }: { loop: boolean; timeline?: PreviewTimeline }) {
  const session = usePreviewSession(loop ? looping : once, 1, timeline);
  return (<>
    <output data-testid="time">{session.timeMs}</output>
    <output data-testid="playing">{String(session.playing)}</output>
    <button onClick={session.toggle}>toggle</button>
  </>);
}
const time = () => Number(screen.getByTestId("time").textContent);
const playing = () => screen.getByTestId("playing").textContent;

it("wraps a looping scene and keeps playing", () => {
  render(<Probe loop />);
  play();
  advance(0);
  advance(1250);
  expect(time()).toBeGreaterThan(200);
  expect(time()).toBeLessThanOrEqual(250);
  expect(playing()).toBe("true");
});
it("stops a non-looping scene at its end", () => {
  render(<Probe loop={false} />);
  play();
  advance(0);
  advance(1250);
  expect(time()).toBe(1000);
  expect(playing()).toBe("false");
});
const timeline: PreviewTimeline = { durationMs: 1000, boundaries: [] };
it("never wraps a composition timeline", () => {
  render(<Probe loop timeline={timeline} />);
  play();
  advance(0);
  advance(1250);
  expect(time()).toBe(1000);
  expect(playing()).toBe("false");
});
