// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { usePreviewSession, type PreviewTimeline } from "../../src/preview/session";
import type { PreviewDefinitionInput } from "../../src";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const definition: PreviewDefinitionInput = {
  width: 1000, height: 600,
  scene: { nodes: [{ id: "host" }] },
  motion: { durationMs: 2000, speed: 1, tracks: [] },
};
function Probe({ timeline }: { timeline?: PreviewTimeline }) {
  const session = usePreviewSession(definition, 1, timeline);
  return (<>
    <output data-testid="time">{session.timeMs}</output>
    <output data-testid="duration">{session.durationMs}</output>
    <output data-testid="jumps">{session.seekNext && session.seekPrev ? "jumps" : "none"}</output>
    <button onClick={() => session.seek(9999)}>seek-end</button>
    <button onClick={() => session.seekNext?.()}>next</button>
    <button onClick={() => session.seekPrev?.()}>prev</button>
  </>);
}
const time = () => Number(screen.getByTestId("time").textContent);

it("keeps single-scene behavior identical without a timeline", () => {
  render(<Probe />);
  expect(screen.getByTestId("duration").textContent).toBe("2000");
  expect(screen.getByTestId("jumps").textContent).toBe("none");
  act(() => { screen.getByText("seek-end").click(); });
  expect(time()).toBe(2000);
});
it("rescales the single cursor and jumps across segment boundaries", () => {
  render(<Probe timeline={{ durationMs: 6000, boundaries: [2000, 4000] }} />);
  expect(screen.getByTestId("duration").textContent).toBe("6000");
  expect(screen.getByTestId("jumps").textContent).toBe("jumps");
  act(() => { screen.getByText("seek-end").click(); });
  expect(time()).toBe(6000);
  act(() => { screen.getByText("prev").click(); });
  expect(time()).toBe(4000);
  act(() => { screen.getByText("prev").click(); });
  expect(time()).toBe(2000);
  act(() => { screen.getByText("next").click(); });
  expect(time()).toBe(4000);
  act(() => { screen.getByText("next").click(); });
  expect(time()).toBe(4000);
  act(() => { screen.getByText("next").click(); });
  expect(time()).toBe(4000);
});
