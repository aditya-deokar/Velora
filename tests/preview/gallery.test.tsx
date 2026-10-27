// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG, BLUEPRINT_CATALOG } from "../../src/core";
import { SceneLibrary, TemplateGallery } from "../../src/preview";

beforeEach(() => {
  window.history.replaceState({}, "", "/app?velora-preview=1&velora-tab=templates");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("renders every template as a schematic storyboard card with zero live previews when idle", () => {
  const view = render(<TemplateGallery/>);
  const cards = view.container.querySelectorAll("[data-template]");
  expect(cards).toHaveLength(TEMPLATE_CATALOG.length);
  expect(view.container.querySelectorAll("svg[data-storyboard]")).toHaveLength(TEMPLATE_CATALOG.length);
  expect(view.container.querySelectorAll("[data-live-preview]")).toHaveLength(0);
  expect(view.container.querySelectorAll("[data-blueprint]")).toHaveLength(BLUEPRINT_CATALOG.length);
  // Storyboard quads are real projected geometry, not placeholders.
  expect(view.container.querySelector('svg[data-storyboard="hero-push"] path')?.getAttribute("d")).toMatch(/^M[\d.-]+ [\d.-]+L/);
});

it("runs exactly one live preview, following hover and focus", () => {
  const view = render(<TemplateGallery/>);
  const card = (id: string) => view.container.querySelector(`[data-template="${id}"]`)!;
  fireEvent.mouseEnter(card("hero-push"));
  expect(view.container.querySelectorAll("[data-live-preview]")).toHaveLength(1);
  expect(card("hero-push").querySelector("[data-live-preview]")).not.toBeNull();
  fireEvent.mouseEnter(card("orbit-reveal"));
  expect(view.container.querySelectorAll("[data-live-preview]")).toHaveLength(1);
  expect(card("orbit-reveal").querySelector("[data-live-preview]")).not.toBeNull();
  fireEvent.mouseLeave(card("orbit-reveal"));
  expect(view.container.querySelectorAll("[data-live-preview]")).toHaveLength(0);
  fireEvent.focus(within(card("dolly-zoom") as HTMLElement).getByRole("link"));
  expect(card("dolly-zoom").querySelector("[data-live-preview]")).not.toBeNull();
});

it("filters by tag and aspect, and links each card to its quick-shot URL", () => {
  const view = render(<TemplateGallery/>);
  fireEvent.click(screen.getByRole("button", { name: "loop" }));
  const loops = TEMPLATE_CATALOG.filter(entry => (entry.tags as string[]).includes("loop")).map(entry => entry.id);
  expect([...view.container.querySelectorAll("[data-template]")].map(card => card.getAttribute("data-template"))).toEqual(loops);
  expect(view.container.querySelectorAll("[data-blueprint]")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Aspect" }), { target: { value: "9:16" } });
  const link = view.container.querySelector('[data-template="hero-push"] a')!.getAttribute("href")!;
  const params = new URLSearchParams(link);
  expect(params.get("velora-quick")).toBe("hero-push");
  expect(params.get("velora-tab")).toBeNull();
  expect(JSON.parse(Buffer.from(params.get("velora-params")!, "base64url").toString())).toEqual({ aspect: "9:16" });
});

it("keeps library tabs in the URL so back and forward restore the view", () => {
  window.history.replaceState({}, "", "/app?velora-preview=1");
  render(<SceneLibrary/>);
  expect(screen.getByRole("link", { name: "Scenes" }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(screen.getByRole("link", { name: "Templates" }));
  expect(location.search).toContain("velora-tab=templates");
  expect(screen.getByRole("region", { name: "Templates" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Compositions" }));
  expect(screen.getByRole("region", { name: "Compositions" }).textContent).toContain("No compositions yet");
  act(() => { window.history.replaceState({}, "", "/app?velora-preview=1&velora-tab=templates"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(screen.getByRole("region", { name: "Templates" })).toBeTruthy();
});
