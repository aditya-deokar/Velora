import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeFramesRender } from "../../src/export/commands";
import { executeRecipeCommand } from "../../src/project/recipes";
import { contactSheet, openCapture, parsePng, voidPng } from "../../src/export/services";
vi.mock("../../src/project/recipes", () => ({ executeRecipeCommand: vi.fn() }));
vi.mock("../../src/export/services", async (original) => ({ ...await original<typeof import("../../src/export/services")>(), openCapture: vi.fn() }));

// A contact sheet is one storyboard image of every extracted frame, in order.
describe("contact sheet", () => {
  it("tiles frames in order with gaps and box-filtered thumbnails", () => {
    const black = voidPng(64, 36);
    const sheet = parsePng(contactSheet([black, black, black], { columns: 2, thumbWidth: 32 }));
    expect([sheet.width, sheet.height]).toEqual([2 * 32 + 3 * 8, 2 * 18 + 3 * 8]);
    const at = (x: number, y: number) => sheet.pixels[(y * sheet.width + x) * 4];
    expect(at(2, 2)).toBe(18);
    expect(at(8 + 5, 8 + 5)).toBe(0);
    expect(at(8 + 32 + 8 + 5, 8 + 18 + 8 + 5)).toBe(18);
    expect(contactSheet([black, black], { columns: 2 }).equals(contactSheet([black, black], { columns: 2 }))).toBe(true);
  });
  describe("velora frames --contact-sheet", () => {
    let root: string;
    const png = "data:image/png;base64," + voidPng(128, 96).toString("base64");
    beforeEach(async () => {
      vi.clearAllMocks();
      root = await mkdtemp(path.join(tmpdir(), "velora-sheet-"));
      await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
      const recipe = { version: 1, id: "demo", title: "Demo", definition: { width: 128, height: 96, scene: { nodes: [] } } };
      await writeFile(path.join(root, "src/velora/scenes/demo.scene.json"), JSON.stringify(recipe));
      await writeFile(path.join(root, "src/velora/scenes/demo.tsx"), "export default function Demo() { return null; }");
      await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({ version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 1, scenes: [{ id: "s1", recipe: "demo", startMs: 0, durationMs: 1000 }], assets: [] }));
      vi.mocked(executeRecipeCommand).mockResolvedValue({ success: true, data: { scenes: [], issues: [], selected: { ...recipe, source: "src/velora/scenes/demo.scene.json", binding: "src/velora/scenes/demo.tsx" }, url: "http://127.0.0.1:9/demo" } } as never);
      vi.mocked(openCapture).mockResolvedValue({ close: vi.fn(), manifest: async () => ({ version: 1, durationMs: 1000, selector: '[data-velora-capture="scene"]' }), snapshot: vi.fn(async () => png), encode: vi.fn() } as Awaited<ReturnType<typeof openCapture>>);
    });
    afterEach(async () => { await rm(root, { recursive: true, force: true }); });
    it("writes contact-sheet.png beside the frames", async () => {
      const result = await executeFramesRender({ composition: "teaser.composition.json", out: "stills", every: 10, contactSheet: true, columns: 3 }, { root });
      expect(result).toMatchObject({ success: true, data: { total: 3, contactSheet: "stills/contact-sheet.png" } });
      const sheet = parsePng(await readFile(path.join(root, "stills/contact-sheet.png")));
      expect(sheet.width).toBe(3 * 128 + 4 * 8);
      expect(await executeFramesRender({ composition: "teaser.composition.json", out: "other", columns: 3 }, { root })).toMatchObject({ success: false });
    });
  });
});
