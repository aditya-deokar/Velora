// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scene, Surface, useAnimatable, useAnimatableState } from "../../src/react";
import { Counter, Cursor, ScrollFrame, Title } from "../../src/kit";
import type { MotionInput, SceneIssue } from "../../src/core";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const linear = (from: number | string, to: number | string) => [{ timeMs: 0, value: from, easing: "linear" }, { timeMs: 1000, value: to }];
const channel = (id: string, from: number | string, to: number | string) => ({ target: { kind: "channel", id }, property: "value", keyframes: linear(from, to) });
const motion = (...tracks: unknown[]) => ({ durationMs: 1000, speed: 1, tracks }) as MotionInput;

function HeroCounter() {
  const { value } = useAnimatable("hero-counter", { value: { type: "number", default: 0, max: 1280 } });
  return <span data-testid="counter">{Math.round(value)}</span>;
}
function Badge({ id = "badge" }: { id?: string }) {
  const { fill, visible, mode } = useAnimatable(id, {
    fill: { type: "color", default: "#3b82f6" }, visible: { type: "boolean", default: true }, mode: { type: "enum", options: ["compact", "full"], default: "compact" },
  });
  return <span data-testid={id} data-fill={fill} data-visible={String(visible)} data-mode={mode} />;
}
describe("useAnimatable", () => {
  it("animates a counter from a recipe channel track with only the hook", () => {
    const view = render(<Scene motion={motion(channel("hero-counter.value", 0, 2000))} timeMs={250}><Surface id="card"><HeroCounter /></Surface></Scene>);
    expect(view.getByTestId("counter").textContent).toBe("500");
    view.rerender(<Scene motion={motion(channel("hero-counter.value", 0, 2000))} timeMs={1000}><Surface id="card"><HeroCounter /></Surface></Scene>);
    expect(view.getByTestId("counter").textContent).toBe("1280"); // clamped to max
  });
  it("returns spec defaults without tracks and typed values with them", () => {
    const view = render(<Scene><Surface id="card"><Badge /></Surface></Scene>);
    const badge = view.getByTestId("badge");
    expect([badge.dataset.fill, badge.dataset.visible, badge.dataset.mode]).toEqual(["#3b82f6", "true", "compact"]);
    cleanup();
    const animated = render(<Scene motion={motion(channel("badge.fill", "#000000", "#ffffff"), channel("badge.visible", 1, 0), channel("badge.mode", 0, 1))} timeMs={1000}>
      <Surface id="card"><Badge /></Surface></Scene>);
    const next = animated.getByTestId("badge");
    expect([next.dataset.fill, next.dataset.visible, next.dataset.mode]).toEqual(["rgb(255 255 255 / 1)", "false", "full"]);
  });
  it("reads aliased channels so existing channel names keep working", () => {
    function Aliased() {
      const state = useAnimatableState("pointer", { x: { type: "number", default: 0 } }, { channels: { x: "cursor-x" } });
      return <span data-testid="x" data-animated={String(state.animated.has("x"))}>{state.values.x}</span>;
    }
    const view = render(<Scene motion={motion(channel("cursor-x", 0, 100))} timeMs={500}><Surface id="c"><Aliased /></Surface></Scene>);
    expect(view.getByTestId("x").textContent).toBe("50");
    expect(view.getByTestId("x").dataset.animated).toBe("true");
  });
  it("registers id, spec and owning Surface, and diagnoses conflicting specs", () => {
    function Probe() {
      const { on } = useAnimatable("probe", { on: { type: "boolean", default: false } });
      return <span>{String(on)}</span>;
    }
    const reports: SceneIssue[][] = [];
    function Conflict() {
      useAnimatable("hero-counter", { value: { type: "number", default: 5 } });
      return null;
    }
    render(<Scene onDiagnostics={issues => reports.push(issues)}>
      <Surface id="card"><HeroCounter /><Probe /></Surface>
      <Surface id="other"><Conflict /></Surface>
    </Scene>);
    const last = reports.at(-1) ?? [];
    expect(last.some(issue => issue.path === "animatable.hero-counter" && /different specs/.test(issue.message))).toBe(true);
  });
  it("exposes declared animatables in the registry without component instances", async () => {
    const { createRegistry } = await import("../../src/react/registry");
    const registry = createRegistry();
    const owner = Symbol("surface");
    registry.declareAnimatable(Symbol("a"), { id: "hero", spec: { value: { type: "number", default: 0 } }, key: "k", owner });
    expect([...registry.animatables.values()]).toEqual([{ id: "hero", spec: { value: { type: "number", default: 0 } } }]);
    expect(registry.animatableIssues).toEqual([]);
    registry.declareAnimatable(Symbol("b"), { id: "hero", spec: { value: { type: "number", default: 1 } }, key: "k2" });
    expect(registry.animatableIssues).toHaveLength(1);
  });
});
describe("kit adoption", () => {
  it("keeps cursor and scroll channel ids byte-identical", () => {
    const view = render(<Scene motion={motion(channel("cursor-x", 0, 100), channel("cursor-press", 0, 2), channel("subject-scroll", 0, 400))} timeMs={500}>
      <Surface id="a"><Cursor /><ScrollFrame channel="subject-scroll" width={100} height={100}><div>tall</div></ScrollFrame></Surface>
    </Scene>);
    const cursor = view.container.querySelector<HTMLElement>("[data-velora-cursor]")!;
    expect(cursor.style.transform).toBe("translate(50px, 0px)");
    expect(view.container.innerHTML).toContain("translateY(-200px)");
    cleanup();
    // Prop coordinates still win, and press stays clamped to 0..1.
    const fixed = render(<Scene motion={motion(channel("cursor-x", 0, 100))} timeMs={500}><Surface id="a"><Cursor x={7} y={9} /></Surface></Scene>);
    expect(fixed.container.querySelector<HTMLElement>("[data-velora-cursor]")!.style.transform).toBe("translate(7px, 9px)");
  });
  it("lets an <id>.reveal track override a counter's and a title's prop timing", () => {
    const at = (timeMs: number, tracks: unknown[] = []) => render(<Scene motion={motion(...tracks)} timeMs={timeMs}>
      <Surface id="a"><Counter id="stat" to={100} startMs={0} durationMs={1000} easing="linear" /><Title id="headline" text="One two" /></Surface>
    </Scene>);
    const counter = (view: ReturnType<typeof render>) => view.container.querySelector("[data-velora-counter]")!.textContent;
    expect(counter(at(0))).toBe("0");
    cleanup();
    expect(counter(at(0, [channel("stat.reveal", 1, 1)]))).toBe("100");
    cleanup();
    const titled = at(0, [channel("headline.reveal", 1, 1)]);
    const units = [...titled.container.querySelectorAll<HTMLElement>("[data-velora-unit] > span")];
    expect(units.map(unit => unit.style.transform)).toEqual(["translateY(0.00%)", "translateY(0.00%)"]);
  });
});
