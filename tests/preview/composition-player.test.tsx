// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSceneTime } from "../../src/react";
import { timelineFromComposition } from "../../src/core";
import { SceneLibrary } from "../../src/preview";
import { AUDIO_RESYNC_MS, activeCue, audioStateAt, playerFrame, syncMedia, type MediaLike } from "../../src/preview/player";
import { transportTarget } from "../../src/preview/transport";

const timeline = timelineFromComposition({ fps: 30, scenes: [
  { id: "a", recipe: "one", startMs: 0, durationMs: 2000 },
  { id: "b", recipe: "two", startMs: 3000, durationMs: 1000 },
] });

describe("cursor mapping", () => {
  it("maps the cursor to the active segment, its local time and the segment to preload, with gaps as void", () => {
    expect(playerFrame(timeline, 500)).toMatchObject({ segment: { id: "a" }, localMs: 500, next: { id: "b" } });
    const gap = playerFrame(timeline, 2500);
    expect(gap.segment).toBeUndefined();
    expect(gap.next?.id).toBe("b");
    expect(playerFrame(timeline, 3250)).toMatchObject({ segment: { id: "b" }, localMs: 250 });
    expect(playerFrame(timeline, 3250).next).toBeUndefined();
    // The final instant holds the last frame instead of dropping to black.
    expect(playerFrame(timeline, 4000)).toMatchObject({ segment: { id: "b" }, localMs: 1000 });
  });
  it("finds the active caption cue", () => {
    const cues = [{ startMs: 0, endMs: 1000, text: "Hello" }, { startMs: 1500, endMs: 2000, text: "World" }];
    expect(activeCue(cues, 999)?.text).toBe("Hello");
    expect(activeCue(cues, 1200)).toBeUndefined();
    expect(activeCue(cues, 1500)?.text).toBe("World");
  });
});

describe("audio follows the cursor", () => {
  const track = { startMs: 1000, offsetMs: 200, gain: 0.8, fadeInMs: 1000, fadeOutMs: 500 };
  it("computes placement, offset and fades deterministically", () => {
    expect(audioStateAt(track, 500, 4000)).toEqual({ active: false, mediaMs: 200, gain: 0 });
    expect(audioStateAt(track, 1500, 4000)).toEqual({ active: true, mediaMs: 700, gain: 0.4 });
    expect(audioStateAt(track, 2500, 4000)).toEqual({ active: true, mediaMs: 1700, gain: 0.8 });
    expect(audioStateAt(track, 3750, 4000).gain).toBeCloseTo(0.4);
    expect(audioStateAt(track, 4000, 4000).active).toBe(false);
  });
  it("resyncs only beyond the drift budget and plays only forward at 1x", () => {
    const media: MediaLike & { plays: number } = { currentTime: 1, volume: 1, paused: true, playbackRate: 1, plays: 0,
      play() { this.paused = false; this.plays++; }, pause() { this.paused = true; } };
    expect(syncMedia(media, { active: true, mediaMs: 1000 + AUDIO_RESYNC_MS - 1, gain: 0.5 }, true, 1)).toBe("ok");
    expect(media.currentTime).toBe(1);
    expect(media.paused).toBe(false);
    expect(media.volume).toBe(0.5);
    expect(syncMedia(media, { active: true, mediaMs: 1000 + AUDIO_RESYNC_MS + 1, gain: 0.5 }, true, 1)).toBe("resync");
    expect(media.currentTime * 1000).toBeCloseTo(1000 + AUDIO_RESYNC_MS + 1);
    syncMedia(media, { active: true, mediaMs: media.currentTime * 1000, gain: 0.5 }, true, 2);
    expect(media.paused).toBe(true);
    syncMedia(media, { active: false, mediaMs: media.currentTime * 1000, gain: 0 }, true, 1);
    expect(media.paused).toBe(true);
    expect(media.plays).toBe(1);
  });
});

describe("keyboard transport", () => {
  const at = (timeMs: number, extra: Partial<{ playing: boolean; rate: number }> = {}) => ({ timeMs, durationMs: 10_000, playing: false, rate: 1, ...extra });
  it.each([24, 30, 60])("steps exactly one frame at %i fps and one second with shift", fps => {
    expect(transportTarget("ArrowRight", false, at(0), fps)).toEqual({ seek: 1000 / fps });
    expect(transportTarget("ArrowRight", false, at(1000), fps)).toEqual({ seek: 1000 + 1000 / fps });
    expect(transportTarget("ArrowLeft", false, at(1000), fps)).toEqual({ seek: 1000 - 1000 / fps });
    expect(transportTarget("ArrowLeft", false, at(0), fps)).toEqual({ seek: 0 });
    expect(transportTarget("ArrowRight", true, at(9500), fps)).toEqual({ seek: 10_000 });
    expect(transportTarget("ArrowLeft", true, at(1500), fps)).toEqual({ seek: 500 });
  });
  it("shuttles J/K/L with doubling rates capped at 4x", () => {
    expect(transportTarget("l", false, at(0), 30)).toEqual({ shuttle: 1 });
    expect(transportTarget("l", false, at(0, { playing: true, rate: 1 }), 30)).toEqual({ shuttle: 2 });
    expect(transportTarget("l", false, at(0, { playing: true, rate: 4 }), 30)).toEqual({ shuttle: 4 });
    expect(transportTarget("j", false, at(0, { playing: true, rate: 2 }), 30)).toEqual({ shuttle: -1 });
    expect(transportTarget("j", false, at(0, { playing: true, rate: -2 }), 30)).toEqual({ shuttle: -4 });
    expect(transportTarget("k", false, at(0, { playing: true }), 30)).toEqual({ shuttle: 0 });
    expect(transportTarget(" ", false, at(0), 30)).toEqual({ toggle: true });
    expect(transportTarget("Home", false, at(500), 30)).toEqual({ seek: 0 });
    expect(transportTarget("End", false, at(500), 30)).toEqual({ seek: 10_000 });
    expect(transportTarget("]", false, at(500), 30)).toEqual({ next: true });
    expect(transportTarget("x", false, at(500), 30)).toBeUndefined();
  });
});

describe("CompositionPlayer", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("fetch", vi.fn(async () => ({ text: async () => "1\n00:00:00,000 --> 00:00:01,000\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond scene\n" })));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const recipe = (id: string) => ({ version: 1, id, title: id.toUpperCase(), definition: { width: 640, height: 360, scene: { nodes: [{ id: "host" }] }, motion: { durationMs: 2000, speed: 1, tracks: [] } } });
  function Probe({ label }: { label: string }) { return <span data-testid={label}>{label}:{Math.round(useSceneTime())}</span>; }
  const bindings = { "src/velora/scenes/one.tsx": () => <Probe label="one"/>, "src/velora/scenes/two.tsx": () => <Probe label="two"/> };
  const sources = { "src/velora/scenes/one.scene.json": recipe("one"), "src/velora/scenes/two.scene.json": recipe("two") };
  const composition = { version: 1, id: "reel", title: "The reel", width: 640, height: 360, fps: 30,
    scenes: [{ id: "a", recipe: "one", startMs: 0, durationMs: 2000 }, { id: "b", recipe: "two", startMs: 3000, durationMs: 1000, transition: { type: "dissolve", durationMs: 300 } }],
    captions: { file: "captions/reel.srt" } };

  it("lists compositions, then plays one cursor through segments, gaps, captions and keyboard steps", async () => {
    window.history.replaceState({}, "", "/app?velora-preview=1&velora-tab=compositions");
    render(<SceneLibrary sources={sources} bindings={bindings} compositions={{ "/reel.composition.json": composition }} assetUrls={{ "/captions/reel.srt": "/captions/reel.srt" }}/>);
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: /^The reel/ })); });
    expect(location.search).toContain("velora-composition=%2Freel.composition.json");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The reel");
    // Segment one is active; segment two is preloaded but hidden.
    expect(document.querySelector('[data-segment="a"]')?.getAttribute("data-active")).toBe("true");
    expect(document.querySelector('[data-segment="b"]')?.getAttribute("data-active")).toBe("false");
    expect(document.querySelector(".velora-captions")?.textContent).toBe("Hello there");
    const slider = screen.getByRole("slider", { name: "Composition time" });
    fireEvent.change(slider, { target: { value: "2500" } });
    expect(document.querySelector('[data-segment="a"]')).toBeNull();
    expect(document.querySelector('[data-segment="b"]')?.getAttribute("data-active")).toBe("false");
    expect(document.querySelector(".velora-captions")).toBeNull();
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByTestId("composition-time").textContent).toMatch(/^0:03\.0/);
    expect(document.querySelector('[data-segment="b"]')?.getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("two").textContent).toBe("two:0");
    expect(document.querySelector(".velora-captions")?.textContent).toBe("Second scene");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("two").textContent).toBe("two:33");
    fireEvent.keyDown(window, { key: "End" });
    expect(screen.getByTestId("two").textContent).toBe("two:1000");
    // The strip marks the dissolve-in segment; transitions are markers only in the player.
    expect(screen.getByRole("button", { name: /◆ TWO/ }).getAttribute("title")).toBe("TWO (dissolve in)");
    fireEvent.click(screen.getByRole("button", { name: "ONE" }));
    expect(screen.getByTestId("one").textContent).toBe("one:0");
  });
  it("names missing recipes instead of rendering a broken cut", () => {
    window.history.replaceState({}, "", "/app?velora-preview=1&velora-tab=compositions&velora-composition=reel");
    render(<SceneLibrary sources={{ "src/velora/scenes/one.scene.json": recipe("one") }} bindings={bindings} compositions={{ "/reel.composition.json": composition }}/>);
    expect(screen.getByRole("alert").textContent).toContain('Scene recipe "two" was not found');
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
