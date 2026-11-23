// @vitest-environment jsdom
import { StrictMode, useLayoutEffect } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createStyleLedger } from "../../src/react/depth/ledger";

describe("style ledger", () => {
  it("restores raw declarations and priorities, including the absence of an attribute", () => {
    const box = document.createElement("div"), bare = document.createElement("div");
    const original = "transform: rotate(5deg) !important;  color: red;";
    box.setAttribute("style", original);
    const ledger = createStyleLedger(document);
    ledger.apply(box, { transform: { prepend: "translateZ(12px)" }, "transform-style": "preserve-3d" });
    ledger.apply(bare, { "backface-visibility": "hidden" });
    expect(box.style.transform).toBe("translateZ(12px) rotate(5deg)");
    expect(ledger.audit()).toEqual([box, bare]);
    ledger.revert();
    expect(box.getAttribute("style")).toBe(original);
    expect(bare.hasAttribute("style")).toBe(false);
    expect(ledger.audit()).toEqual([]);
  });
  it("corrects repeated host writes before capture and preserves the latest host intent on revert", () => {
    const box = document.createElement("div"), conflicts: string[] = [];
    const ledger = createStyleLedger(document, (_element, name) => conflicts.push(name));
    ledger.apply(box, { transform: { prepend: "translateZ(8px)" } });
    for (let i = 1; i <= 3; i++) {
      box.style.transform = `rotate(${i}deg)`;
      ledger.settle();
      expect(box.style.transform).toBe(`translateZ(8px) rotate(${i}deg)`);
    }
    expect(conflicts).toEqual(["transform"]);
    window.dispatchEvent(new Event("pagehide"));
    expect(box.style.transform).toBe("rotate(3deg)");
  });
  it("is clean after StrictMode remount and React unmount", async () => {
    const mounted = document.createElement("div"), host = document.createElement("div");
    host.setAttribute("style", "color: lime !important");
    const ledger = createStyleLedger(document);
    function Depth() {
      useLayoutEffect(() => {
        ledger.apply(host, { "transform-style": "preserve-3d" });
        return ledger.revert;
      }, []);
      return null;
    }
    const root = createRoot(mounted);
    await act(() => root.render(<StrictMode><Depth/></StrictMode>));
    expect(host.style.transformStyle).toBe("preserve-3d");
    await act(() => root.unmount());
    expect(host.getAttribute("style")).toBe("color: lime !important");
    expect(ledger.audit()).toEqual([]);
  });
});
