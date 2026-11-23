// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Surface } from "../../src/react";
import { ScenePreview, exportUrl, usePreviewHost } from "../../src/preview";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const definition = { scene: { nodes: [{ id: "a" }] }, motion: { durationMs: 1000, tracks: [] } };
function HostProbe() { const host = usePreviewHost(); return <span data-testid="host">{host ? `${host.fps}:${host.session.durationMs}` : "none"}</span>; }
describe("ScenePreview editor slots", () => {
  it("renders the unchanged preview without slots (no editor grid, no host context, no Edit link)", () => {
    const view = render(<ScenePreview definition={definition}><Surface id="a"/></ScenePreview>);
    const main = view.container.querySelector("main")!;
    expect(main.hasAttribute("data-velora-layout")).toBe(false);
    expect(view.container.querySelector(".velora-editor-grid")).toBeNull();
    expect(view.container.querySelector("[data-velora-edit-link]")).toBeNull();
    expect(view.container.querySelector("footer.velora-footer")).not.toBeNull();
    const withLink = render(<ScenePreview definition={definition} editHref="/?velora-edit=1"><Surface id="a"/></ScenePreview>);
    expect(withLink.container.querySelector("[data-velora-edit-link]")?.getAttribute("href")).toBe("/?velora-edit=1");
  });
  it("renders chrome-marked editor slots around the viewport and provides the host", () => {
    const view = render(<ScenePreview definition={definition} layout="editor" slots={{ left: <HostProbe/>, right: <i>right</i>, bottom: <i>bottom</i>, toolbar: <i>tools</i> }}><Surface id="a"/></ScenePreview>);
    expect(view.container.querySelector("main")!.getAttribute("data-velora-layout")).toBe("editor");
    for (const selector of [".velora-editor-left", ".velora-editor-right", ".velora-editor-bottom", ".velora-editor-top"])
      expect(view.container.querySelector(selector)!.hasAttribute("data-velora-preview-chrome")).toBe(true);
    expect(view.getByTestId("host").textContent).toBe("60:2000");
  });
  it("strips Edit mode and the fragment from the export URL", () => {
    expect(exportUrl("http://127.0.0.1:5173/?velora-preview=1&velora-scene=a&velora-edit=1#velora-bridge=1.x")).toBe("http://127.0.0.1:5173/?velora-preview=1&velora-scene=a");
    expect(exportUrl("http://127.0.0.1:5173/?velora-preview=1#keep")).toBe("http://127.0.0.1:5173/?velora-preview=1#keep");
  });
});
