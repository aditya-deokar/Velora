// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scene, Surface } from "../../src/react";
import {
  Backdrop, BrandMark, BrandProvider, BrowserFrame, Callout, CaptionTrack, Countdown, Counter, Cursor, Dust, GradientText, LaptopFrame, LightSweep, LookLayer,
  Marquee, Panel, PhoneFrame, Spotlight, TabletFrame, Title, Typewriter, WindowFrame, segmentText,
} from "../../src/kit";

beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const brand = { version: 1, name: "Acme", colors: { accent: "#ff3366", text: "#101010" }, motion: "crisp" };
const at = (timeMs: number, children: ReactNode, motion?: object) => render(
  <Scene timeMs={timeMs} focus={{ maxBlur: 0 }} {...(motion ? { motion: motion as never } : {})}>
    <BrandProvider brand={brand}><Surface id="subject" style={{ width: 800, height: 600 }}>{children}</Surface></BrandProvider>
  </Scene>).container;
const markup = (timeMs: number, children: ReactNode) => { const html = at(timeMs, children).innerHTML; cleanup(); return html; };

describe("kit determinism", () => {
  it.each([
    ["Title", <Title text="Hello brave world" />],
    ["Counter", <Counter to={1234.5} decimals={1} prefix="$" />],
    ["Typewriter", <Typewriter text="Typed 👋🏽 text" />],
    ["Dust", <Dust width={400} height={300} />],
    ["Backdrop", <Backdrop variant="aurora" width={400} height={300} />],
    ["Marquee", <Marquee items={["A", "B"]} width={400} />],
    ["Countdown", <Countdown from={3} />],
    ["LightSweep", <LightSweep startMs={0} durationMs={1000} />],
  ])("%s renders the same markup for the same time", (_name, element) => {
    expect(markup(450, element)).toBe(markup(450, element));
    expect(markup(450, element)).not.toBe(markup(1, element));
  });
});

describe("type", () => {
  it("Title masks every word and settles at the end, with the accent word in the brand accent", () => {
    const end = at(5000, <Title text="Build. Ship. Delight." accent="ship" />);
    const units = [...end.querySelectorAll<HTMLElement>("[data-velora-unit] > span")];
    expect(units.map(unit => unit.textContent)).toEqual(["Build.", "Ship.", "Delight."]);
    expect(units.every(unit => unit.style.transform === "translateY(0.00%)")).toBe(true);
    expect(units[1].style.color).toBe("rgb(255, 51, 102)");
    cleanup();
    const start = at(0, <Title text="Build. Ship." />);
    expect(start.querySelector<HTMLElement>("[data-velora-unit] > span")!.style.transform).toBe("translateY(110.00%)");
  });
  it("segments CJK by word or grapheme and keeps line breaks", () => {
    expect(segmentText("你好世界\nok", "grapheme")).toEqual([["你", "好", "世", "界"], ["o", "k"]]);
    expect(segmentText("a b", "line")).toEqual([["a b"]]);
  });
  it("Counter formats with tabular numerals and locale grouping at the end", () => {
    const end = at(9000, <Counter to={12480} suffix="+" locale="en-US" />);
    expect(end.querySelector("[data-velora-counter]")!.textContent).toBe("12,480+");
    expect((end.querySelector("[data-velora-counter]") as HTMLElement).style.fontVariantNumeric).toBe("tabular-nums");
  });
  it("Typewriter types whole graphemes at its rate", () => {
    expect(at(500, <Typewriter text="ab👋🏽cd" cps={6} caret={false} />).querySelector("[data-velora-typewriter]")!.textContent).toBe("ab👋🏽");
  });
  it("Countdown steps and CaptionTrack shows the active cue", () => {
    expect(at(1500, <Countdown from={3} />).querySelector("[data-velora-countdown]")!.textContent).toBe("2");
    cleanup();
    expect(at(3500, <Countdown from={3} />).querySelector("[data-velora-countdown]")).toBeNull();
    cleanup();
    const cues = [{ startMs: 0, endMs: 1000, text: "one two" }, { startMs: 1000, endMs: 2000, text: "three four" }];
    const karaoke = at(1600, <CaptionTrack cues={cues} variant="karaoke" />);
    const words = [...karaoke.querySelectorAll("[data-velora-caption] > span")] as HTMLElement[];
    expect(words.map(word => word.textContent?.trim())).toEqual(["three", "four"]);
    expect(words[0].style.color).toBe("rgb(255, 51, 102)");
  });
});

describe("brand", () => {
  it("exposes tokens as CSS variables and renders the brand mark from the name", () => {
    const view = at(0, <><BrandMark size={40} /><Panel width={300} height={200} title="Card" /><GradientText>Hi</GradientText></>);
    const root = view.querySelector<HTMLElement>("[data-velora-brand]")!;
    expect(root.style.getPropertyValue("--velora-accent")).toBe("#ff3366");
    expect(root.style.display).toBe("contents");
    expect(view.querySelector("[data-velora-brand-mark]")!.textContent).toBe("Acme");
  });
  it("falls back to defaults and reports an invalid brand file", () => {
    const view = render(<BrandProvider brand={{ version: 2 }}><span>x</span></BrandProvider>).container;
    expect(view.querySelector("[data-velora-brand-invalid]")).not.toBeNull();
  });
});

describe("framing, interaction and atmosphere", () => {
  it("frames content without changing its size", () => {
    for (const Frame of [BrowserFrame, WindowFrame, PhoneFrame, TabletFrame, LaptopFrame]) {
      const view = render(<Frame width={320} height={200}><div data-testid="content" /></Frame>).container;
      const screen = view.querySelector('[data-testid="content"]')!.parentElement as HTMLElement;
      expect([screen.style.width, screen.style.height]).toEqual(["320px", "200px"]);
      cleanup();
    }
  });
  it("Cursor follows its channels and ripples on press", () => {
    const motion = { durationMs: 1000, speed: 1, tracks: [
      { target: { kind: "channel", id: "cursor-x" }, property: "value", keyframes: [{ timeMs: 0, value: 10, easing: "linear" }, { timeMs: 1000, value: 110 }] },
      { target: { kind: "channel", id: "cursor-y" }, property: "value", keyframes: [{ timeMs: 0, value: 20 }] },
      { target: { kind: "channel", id: "cursor-press" }, property: "value", keyframes: [{ timeMs: 0, value: 0, easing: "linear" }, { timeMs: 1000, value: 1 }] },
    ] };
    const view = at(500, <Cursor />, motion);
    const cursor = view.querySelector<HTMLElement>("[data-velora-cursor]")!;
    expect(cursor.style.transform).toBe("translate(60px, 20px)");
    expect(cursor.querySelector("span")).not.toBeNull();
  });
  it("Spotlight dims around its region and Callout draws a leader line", () => {
    const view = at(2000, <><Spotlight width={800} height={600} region={{ x: 100, y: 100, width: 200, height: 80 }} /><Callout label="New" x={400} y={300} toX={200} toY={140} /></>);
    expect(view.querySelector<HTMLElement>("[data-velora-spotlight]")!.style.background).toContain("radial-gradient");
    expect(view.querySelector("[data-velora-callout]")!.textContent).toBe("New");
    expect(view.querySelector("[data-velora-callout-line] line")!.getAttribute("stroke-dashoffset")).toBe("0");
  });
});

describe("LookLayer", () => {
  it("passes children through when the look has no browser layer", () => {
    const view = render(<LookLayer look={{ bloom: { intensity: 0.5 } }} timeMs={0} width={100} height={100}><span>x</span></LookLayer>).container;
    expect(view.querySelector("[data-velora-look]")).toBeNull();
    cleanup();
    const plain = render(<LookLayer look={{ grade: { saturation: 0.2 } }} timeMs={0} width={100} height={100}><span>x</span></LookLayer>).container;
    expect(plain.querySelector("feColorMatrix")!.getAttribute("values")).toMatch(/^1.15748 /);
  });
  it("draws grade, vignette, letterbox and per-frame grain deterministically", () => {
    const look = { preset: "film" as const, letterbox: { aspect: 2.39 } };
    const frame = (timeMs: number) => { const html = render(<LookLayer look={look} timeMs={timeMs} width={1920} height={1080} seed={2}><span /></LookLayer>).container.innerHTML.replace(/velora-look-[\w-]+/g, "id"); cleanup(); return html; };
    const view = render(<LookLayer look={look} timeMs={1000} width={1920} height={1080} seed={2}><span /></LookLayer>).container;
    expect(view.querySelector("feColorMatrix")).not.toBeNull();
    expect(view.querySelectorAll("feFuncR, feFuncG, feFuncB")).toHaveLength(3);
    expect(view.querySelector("[data-velora-vignette]")).not.toBeNull();
    expect((view.querySelector('[data-velora-letterbox="top"]') as HTMLElement).style.height).toBe("138px");
    expect(view.querySelector("[data-velora-grain]")!.getAttribute("data-velora-grain")).toBe("24");
    cleanup();
    expect(frame(1000)).toBe(frame(1000));
    expect(frame(1000)).not.toBe(frame(1050));
    expect(frame(1001)).toBe(frame(1010)); // same 24 fps grain frame
  });
});
