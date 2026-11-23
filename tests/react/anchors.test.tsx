// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { measureAnchors, bindTargetDepth } from "../../src/react/anchors";
import { evaluateScene } from "../../src/core/spatial";
import { elementKey } from "../../src/core/targets";

afterEach(() => document.body.replaceChildren());

it("measures scrolled offsets and live elevation independently of camera transforms", () => {
  document.body.innerHTML = '<div data-velora-id="subject"><section><button id="price" data-velora-anchor="price">Price</button></section></div>';
  const surface = document.body.firstElementChild as HTMLDivElement;
  const scroller = surface.firstElementChild as HTMLElement;
  const button = scroller.firstElementChild as HTMLElement;
  const box = (node: HTMLElement, parent: HTMLElement | null, x: number, y: number, width: number, height: number) => {
    for (const [name, value] of Object.entries({ offsetParent: parent, offsetLeft: x, offsetTop: y, offsetWidth: width, offsetHeight: height }))
      Object.defineProperty(node, name, { value, configurable: true });
  };
  box(surface, null, 0, 0, 300, 180);
  box(scroller, surface, 20, 40, 220, 80);
  box(button, scroller, 50, 30, 60, 20);
  scroller.scrollTop = 12;
  Object.defineProperty(scroller, "clientTop", { value: 3 });
  const detach = bindTargetDepth(surface, () => [{ element: scroller, z: 70, base: 10, tier: "card" }]);
  const token = Symbol();
  const bindings = new Map([[token, { token, id: "subject", element: surface }]]);
  const target = { surface: "subject", anchor: "price" };
  const selector = { surface: "subject", selector: "#price" };
  const factors = new Map([["subject", 0.5]]);
  const measured = () => measureAnchors(bindings, [], [target, selector], factors);
  const first = measured();
  expect(first.matches[elementKey(selector)]).toMatchObject([{ rect: { x: -80, y: -29, width: 60, height: 20 }, elevation: 35, baseElevation: 5 }]);
  surface.style.transform = "perspective(1400px) rotateY(35deg)";
  expect(measured()).toEqual(first);
  const copy = button.cloneNode(true) as HTMLElement;
  scroller.append(copy);
  box(copy, scroller, 90, 30, 60, 20);
  const evaluate = () => evaluateScene({ nodes: [{ id: "subject" }], constraints: [{ kind: "focusFollow", target }] }, {}, { elements: measured() });
  expect(evaluate().issues).toContainEqual(expect.objectContaining({ code: "target-ambiguous" }));
  copy.remove();
  button.remove();
  expect(evaluate().issues).toContainEqual(expect.objectContaining({ code: "target-missing" }));
  detach();
});
