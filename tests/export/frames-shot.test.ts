import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeFramesRender, executeShotRender } from "../../src/export/commands";
import { executeRecipeCommand } from "../../src/project/recipes";
import { openCapture } from "../../src/export/services";
import { RenderManifestSchema } from "../../src/core/export";
vi.mock("../../src/project/recipes", () => ({ executeRecipeCommand: vi.fn() }));
vi.mock("../../src/export/services", async (original) => ({ ...await original<typeof import("../../src/export/services")>(), openCapture: vi.fn() }));

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPdwAAAAASUVORK5CYII=";
const recipeDoc = (id: string) => ({ version: 1, id, title: id, definition: { width: 128, height: 96, scene: { nodes: [] } } });
let root: string;
const snapshot = vi.fn();
async function setup() {
  root = await mkdtemp(path.join(tmpdir(), "flute-stills-"));
  await mkdir(path.join(root, "src/flute/scenes"), { recursive: true });
  for (const id of ["demo-a", "demo-b"]) {
    await writeFile(path.join(root, `src/flute/scenes/${id}.scene.json`), JSON.stringify(recipeDoc(id)));
    await writeFile(path.join(root, `src/flute/scenes/${id}.tsx`), "export default function S() { return null; }");
  }
  await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({
    version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 0,
    scenes: [
      { id: "s1", recipe: "demo-a", startMs: 0, durationMs: 100 },
      { id: "s2", recipe: "demo-b", startMs: 100, durationMs: 100 },
    ], assets: [],
  }));
}
beforeEach(async () => {
  vi.clearAllMocks();
  await setup();
  vi.mocked(executeRecipeCommand).mockImplementation(async (_op, input: unknown) => ({
    success: true, data: { url: `http://127.0.0.1:9/${(input as { sceneId: string }).sceneId}` },
  }) as never);
  snapshot.mockResolvedValue(png);
  vi.mocked(openCapture).mockResolvedValue({ close: vi.fn(), manifest: async () => ({ version: 1, durationMs: 100, selector: '[data-flute-capture="scene"]' }), snapshot, encode: vi.fn() } as Awaited<ReturnType<typeof openCapture>>);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("frames extraction", () => {
  it("writes every-Nth frames plus a manifest", async () => {
    const result = await executeFramesRender({ composition: "teaser.composition.json", out: "stills", every: 2 }, { root, url: "http://127.0.0.1:9" });
    expect(result).toMatchObject({ success: true, data: { out: "stills", manifest: "stills/manifest.json", total: 3 } });
    expect((await readdir(path.join(root, "stills"))).sort()).toEqual(["frame-00000.png", "frame-00002.png", "frame-00004.png", "manifest.json"]);
    const manifest = JSON.parse(await readFile(path.join(root, "stills/manifest.json"), "utf8"));
    expect(RenderManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({ kind: "frames" });
    expect(manifest.frames[0]).toMatchObject({ frame: 0, file: "frame-00000.png" });
    expect(manifest.frames.every((f: { sha: string }) => /^[0-9a-f]{64}$/.test(f.sha))).toBe(true);
  });
  it("selects explicit times and defaults to one frame per second", async () => {
    const at = await executeFramesRender({ composition: "teaser.composition.json", out: "picked", at: [10, 150] }, { root, url: "http://127.0.0.1:9" });
    expect(at).toMatchObject({ success: true, data: { total: 2 } });
    expect((await readdir(path.join(root, "picked"))).sort()).toEqual(["frame-00000.png", "frame-00005.png", "manifest.json"]);
    const perSecond = await executeFramesRender({ composition: "teaser.composition.json", out: "secondly" }, { root, url: "http://127.0.0.1:9" });
    expect(perSecond).toMatchObject({ success: true, data: { total: 1 } });
  });
  it("fails closed on out-of-range times and existing manifests", async () => {
    expect(await executeFramesRender({ composition: "teaser.composition.json", out: "bad", at: [5000] }, { root, url: "http://127.0.0.1:9" }))
      .toMatchObject({ success: false, issues: [{ code: "ERR_FRAME_OUT_OF_RANGE" }] });
    expect(openCapture).not.toHaveBeenCalled();
    await executeFramesRender({ composition: "teaser.composition.json", out: "twice", every: 6 }, { root, url: "http://127.0.0.1:9" });
    expect(await executeFramesRender({ composition: "teaser.composition.json", out: "twice", every: 6 }, { root, url: "http://127.0.0.1:9" }))
      .toMatchObject({ success: false, issues: [{ code: "output-exists" }] });
  });
});

describe("shot capture", () => {
  it("captures single scenes with clamping and codes", async () => {
    vi.mocked(executeRecipeCommand).mockResolvedValue({ success: true, data: { selected: { id: "demo-a", definition: recipeDoc("demo-a").definition }, url: "http://127.0.0.1:9/demo-a" } } as never);
    const result = await executeShotRender({ scene: "demo-a", timeMs: 40, out: "shot.png" }, { root, url: "http://127.0.0.1:9" });
    expect(result).toMatchObject({ success: true, data: { out: "shot.png", sceneId: "demo-a", timeMs: 40 } });
    expect(snapshot).toHaveBeenCalledOnce();
    expect(snapshot.mock.calls[0][0]).toBe(40);
    const clamped = await executeShotRender({ scene: "demo-a", timeMs: 500, out: "late.png" }, { root, url: "http://127.0.0.1:9" });
    expect(clamped).toMatchObject({ success: true, data: { clamped: true } });
    expect(snapshot.mock.calls[1][0]).toBe(100);
    vi.mocked(executeRecipeCommand).mockResolvedValue({ success: false, issues: [{ path: "sceneId", message: "Gone." }] });
    expect(await executeShotRender({ scene: "ghost", timeMs: 10, out: "gone.png" }, { root, url: "http://127.0.0.1:9" }))
      .toMatchObject({ success: false, issues: [{ code: "ERR_SCENE_INVALID" }] });
  });
});
