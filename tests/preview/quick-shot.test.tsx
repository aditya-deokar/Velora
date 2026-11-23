// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { quickShotCommands, readQuickShot } from "../../src/core";
import { ProjectPreview, quickShotSearch } from "../../src/preview";

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (window as { __VELORA_CAPTURE__?: unknown }).__VELORA_CAPTURE__; });
const flush = () => act(() => { const pending = frames; frames = []; for (const callback of pending) callback(performance.now()); });
const open = (search: string) => {
  window.history.replaceState({}, "", "/app" + search);
  return render(<ProjectPreview projectId="host" enabled><button>Live app</button></ProjectPreview>);
};

it("slots the live app into the template subject with a capture bridge and no source files", () => {
  open(quickShotSearch({ template: "hero-push", aspect: "16:9", overrides: {} }, "?utm=1"));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Quick shot · The precise push-in");
  expect(document.querySelector('[data-velora-capture="scene"]')?.contains(screen.getByRole("button", { name: "Live app" }))).toBe(true);
  expect((window as { __VELORA_CAPTURE__?: { durationMs: number } }).__VELORA_CAPTURE__?.durationMs).toBe(6000);
  // The settings panel is studio chrome, never captured.
  const panel = screen.getByRole("complementary", { name: "Shot settings" });
  expect(panel.closest("[data-velora-preview-chrome]")).not.toBeNull();
  expect(document.querySelector('[data-velora-capture="scene"]')?.contains(panel)).toBe(false);
  expect(location.search).toContain("utm=1");
});

it("writes param edits into the URL once per frame without remounting the app", () => {
  open(quickShotSearch({ template: "hero-push", aspect: "16:9", overrides: {} }));
  const app = screen.getByRole("button", { name: "Live app" });
  fireEvent.change(screen.getByRole("slider", { name: "lens" }), { target: { value: "35" } });
  fireEvent.change(screen.getByRole("combobox", { name: "intensity" }), { target: { value: "dramatic" } });
  expect(frames).toHaveLength(1);
  flush();
  const shot = readQuickShot(new URLSearchParams(location.search))!;
  expect(shot.overrides).toEqual({ lens: 35, intensity: "dramatic" });
  expect(screen.getByRole("button", { name: "Live app" })).toBe(app);
  expect(screen.getByTestId("scaffold-command").textContent).toBe(quickShotCommands(shot, location.href).scaffold);
  fireEvent.change(screen.getByRole("combobox", { name: "Aspect" }), { target: { value: "9:16" } });
  flush();
  expect(readQuickShot(new URLSearchParams(location.search))!.aspect).toBe("9:16");
  expect(screen.getByRole("button", { name: "Live app" })).toBe(app);
});

it("shows diagnostics for invalid params and disables copy actions", () => {
  open("?velora-preview=1&velora-quick=hero-push&velora-params=" + Buffer.from('{"lens":999}').toString("base64url"));
  expect(screen.getByRole("alert").textContent).toContain("lens must be a number from 24 to 200");
  for (const name of ["Copy export command", "Copy scaffold command", "Copy agent prompt"])
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  expect((window as { __VELORA_CAPTURE__?: unknown }).__VELORA_CAPTURE__).toBeUndefined();
});

it("copies the exact export command for the current URL", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  open(quickShotSearch({ template: "orbit-reveal", route: "/pricing", aspect: "1:1", overrides: {} }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy export command" })); });
  expect(writeText).toHaveBeenCalledWith(quickShotCommands({ template: "orbit-reveal", route: "/pricing", aspect: "1:1", overrides: {} }, location.href).export);
  expect(writeText.mock.calls[0][0]).toContain("--width 1080 --height 1080");
  // Route shots frame the page in a same-origin RouteFrame, not the host children.
  expect(document.querySelector("iframe")?.getAttribute("src")).toBe(location.origin + "/pricing");
});

it("frames a route when the host passes no children (Next studio)", () => {
  window.history.replaceState({}, "", "/velora" + quickShotSearch({ template: "hero-push", aspect: "16:9", overrides: {} }));
  render(<ProjectPreview projectId="host" enabled active/>);
  expect((screen.getByRole("textbox", { name: "Route" }) as HTMLInputElement).value).toBe("/");
  expect(document.querySelector("iframe")?.getAttribute("src")).toBe(location.origin + "/");
});
