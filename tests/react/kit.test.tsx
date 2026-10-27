// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scene, Surface, useCaptureSettle, useSceneCapture } from "../../src/react";
import { RouteFrame, ScrollFrame, SlotPlaceholder } from "../../src/kit";
import { RouteSchema } from "../../src/core/templates";
import type { CaptureBridge } from "../../src/core/export";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const scrollMotion = { durationMs: 1000, speed: 1, tracks: [{ target: { kind: "channel" as const, id: "subject-scroll" }, property: "value" as const, keyframes: [{ timeMs: 0, value: 0, easing: "linear" as const }, { timeMs: 1000, value: 800 }] }] };

describe("route validation", () => {
  it.each(["/", "/pricing", "/docs/getting-started?tab=react#install"])("accepts same-origin path %s", route => expect(RouteSchema.safeParse(route).success).toBe(true));
  it.each(["//evil.com", "https://evil.com", "pricing", "/\\evil", "/a b", "javascript:alert(1)", ""])("rejects %s", route => expect(RouteSchema.safeParse(route).success).toBe(false));
});

describe("kit components", () => {
  it("RouteFrame frames a same-origin route at a fixed viewport", () => {
    const { container } = render(<Scene focus={{ maxBlur: 0 }}><Surface id="subject" style={{ width: 1440, height: 900 }}><RouteFrame route="/pricing" width={1440} height={900} /></Surface></Scene>);
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(new URL("/pricing", location.origin).href);
    expect(frame.style.width).toBe("1440px");
    expect(frame.style.pointerEvents).toBe("none");
  });
  it("RouteFrame refuses an invalid route and marks capture invalid", () => {
    const { container } = render(<Scene focus={{ maxBlur: 0 }}><Surface id="subject" style={{ width: 400, height: 300 }}><RouteFrame route="https://evil.com" width={400} height={300} /></Surface></Scene>);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector('[data-velora-valid="false"][data-velora-route-frame="blocked"]')?.textContent).toMatch(/same-origin route/);
  });
  it("ScrollFrame scrolls its content from a channel", () => {
    const { container } = render(<Scene motion={scrollMotion} timeMs={500} focus={{ maxBlur: 0 }}><Surface id="subject" style={{ width: 400, height: 300 }}><ScrollFrame channel="subject-scroll" width={400} height={300}><div style={{ height: 3000 }}>page</div></ScrollFrame></Surface></Scene>);
    expect(container.querySelector<HTMLDivElement>('[style*="translateY"]')!.style.transform).toBe("translateY(-400px)");
  });
  it("SlotPlaceholder names its slot", () => {
    const { container } = render(<SlotPlaceholder name="subject" width={400} height={300} />);
    expect(container.querySelector('[data-velora-placeholder="subject"]')?.textContent).toContain("Slot: subject");
  });
});

describe("capture settle", () => {
  function Bridge({ settle }: { settle?: () => Promise<void> }) {
    useSceneCapture({ durationMs: 1000, seek: () => {} });
    return settle ? <Settler settle={settle} /> : null;
  }
  function Settler({ settle }: { settle: () => Promise<void> }) { useCaptureSettle(settle); return null; }
  const bridge = () => (window as unknown as { __VELORA_CAPTURE__: CaptureBridge }).__VELORA_CAPTURE__;
  it("keeps seeks synchronous without settlers", () => {
    render(<Bridge />);
    expect(bridge().seek(10)).toBeUndefined();
  });
  it("awaits registered settle work after each seek", async () => {
    let finished = false;
    render(<Bridge settle={() => new Promise<void>(done => setTimeout(() => { finished = true; done(); }, 5))} />);
    const result = bridge().seek(10);
    expect(result).toBeInstanceOf(Promise);
    expect(finished).toBe(false);
    await result;
    expect(finished).toBe(true);
  });
});
