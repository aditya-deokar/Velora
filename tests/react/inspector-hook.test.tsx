// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scene, Surface, createSceneInspector, useAnimatable, useSceneInspector, type SceneInspector } from "../../src/react";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Counter() { useAnimatable("hero-counter", { value: { type: "number", default: 0 } }); return null; }
function Panel({ inspector }: { inspector: SceneInspector }) {
  const snapshot = useSceneInspector(inspector);
  return <output data-testid="panel">{snapshot ? `${snapshot.bindings.map(binding => binding.id + (binding.parentId ? "<" + binding.parentId : "")).join(",")}|${snapshot.animatables.map(entry => entry.id + "@" + entry.owner).join(",")}|${snapshot.timeMs}` : "none"}</output>;
}
describe("useSceneInspector", () => {
  it("publishes bindings, parents, animatables, evaluated nodes and motion as frozen plain data", () => {
    const inspector = createSceneInspector();
    const motion = { durationMs: 1000, speed: 1, tracks: [{ target: { kind: "surface", id: "card" }, property: "x", keyframes: [{ timeMs: 0, value: 0, easing: "linear" }, { timeMs: 1000, value: 100 }] }] } as const;
    const view = render(<><Scene inspector={inspector} motion={motion as never} timeMs={500}><Surface id="group"><Surface id="card"><Counter/></Surface></Surface></Scene><Panel inspector={inspector}/></>);
    // Bindings follow registration order (children register first); parents are explicit.
    expect(view.getByTestId("panel").textContent).toBe("card<group,group|hero-counter@card|500");
    const snapshot = inspector.snapshot()!;
    expect(snapshot.motion.surfaces.card.x).toBe(50);
    expect(snapshot.nodes.map(node => node.id).sort()).toEqual(["card", "group"]);
    expect(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.bindings[0])).toBe(true);
    // No React instances or DOM nodes: the snapshot is JSON-serializable data.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
  it("notifies subscribers only when the snapshot changes", () => {
    const inspector = createSceneInspector();
    const listener = vi.fn();
    inspector.subscribe(listener);
    const view = render(<Scene inspector={inspector} timeMs={0}><Surface id="a"/></Scene>);
    const count = listener.mock.calls.length;
    view.rerender(<Scene inspector={inspector} timeMs={0}><Surface id="a"/></Scene>);
    expect(listener.mock.calls.length).toBe(count);
    act(() => { view.rerender(<Scene inspector={inspector} timeMs={0}><Surface id="b"/></Scene>); });
    expect(listener.mock.calls.length).toBeGreaterThan(count);
  });
});
