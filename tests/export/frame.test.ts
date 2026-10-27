import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { executeFrameRender } from "../../src/export/commands";
import { executeRecipeCommand } from "../../src/project/recipes";
import { openCapture } from "../../src/export/services";
import { RenderManifestSchema } from "../../src/core/export";
vi.mock("../../src/project/recipes", () => ({ executeRecipeCommand: vi.fn() }));
vi.mock("../../src/export/services", async (original) => ({ ...await original<typeof import("../../src/export/services")>(), openCapture: vi.fn() }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPdwAAAAASUVORK5CYII=";
let root: string;
const snapshot = vi.fn(), close = vi.fn();
const recipeDoc = { version: 1, id: "demo", title: "Demo", definition: { width: 128, height: 96, scene: { nodes: [] } } };
function compositionDoc(scenes: unknown = [{ id: "s1", recipe: "demo", startMs: 0, durationMs: 100 }]) {
  return { version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 7, scenes, assets: [] };
}
async function setup(scenes?: unknown) {
  root = await mkdtemp(path.join(tmpdir(), "velora-frame-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  await writeFile(path.join(root, "src/velora/scenes/demo.scene.json"), JSON.stringify(recipeDoc));
  await writeFile(path.join(root, "src/velora/scenes/demo.tsx"), "export default function Demo() { return null; }");
  await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify(compositionDoc(scenes)));
}
beforeEach(async () => {
  vi.clearAllMocks();
  await setup();
  vi.mocked(executeRecipeCommand).mockResolvedValue({ success: true, data: { scenes: [], issues: [], selected: { ...recipeDoc, source: "src/velora/scenes/demo.scene.json", binding: "src/velora/scenes/demo.tsx" }, url: "http://127.0.0.1:5173/?velora-scene=demo" } } as never);
  snapshot.mockResolvedValue(png);
  vi.mocked(openCapture).mockResolvedValue({ close, manifest: async () => ({ version: 1, durationMs: 100, selector: '[data-velora-capture="scene"]' }), snapshot, encode: vi.fn() } as Awaited<ReturnType<typeof openCapture>>);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const run = (input: object, context: object = {}) => executeFrameRender({ composition: "teaser.composition.json", frame: 1, out: "frame.png", ...input }, { root, ...context });
const shaOfBytes = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const writeComposition = (scenes: unknown) => writeFile(path.join(root, "teaser.composition.json"), JSON.stringify(compositionDoc(scenes)));

describe("frame render", () => {
  it("captures the exact frame with a valid manifest", async () => {
    const result = await run({});
    expect(result).toMatchObject({ success: true, data: { out: "frame.png", manifest: "frame.manifest.json", frame: 1, sceneId: "demo", segmentId: "s1", cached: false } });
    expect(result.success && result.data.timeMs).toBeCloseTo(100 / 3, 9);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(snapshot.mock.calls[0][0]).toBeCloseTo(100 / 3, 9);
    const bytes = await readFile(path.join(root, "frame.png"));
    expect(shaOfBytes(bytes)).toBe(result.success && result.data.sha);
    const manifest = JSON.parse(await readFile(path.join(root, "frame.manifest.json"), "utf8"));
    expect(RenderManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({ kind: "frame", compositionId: "teaser", seed: 7, fps: 30, width: 128, height: 96, veloraVersion: "development" });
    expect(manifest.frames[0]).toMatchObject({ frame: 1, sceneId: "demo", segmentId: "s1" });
    expect(manifest.frames[0].sha).toBe(shaOfBytes(bytes));
    expect(manifest.checks).toEqual([{ id: "bridge-present", pass: true, detail: expect.any(String) }]);
    expect(close).toHaveBeenCalledOnce();
  });
  it("resolves --time to its nearest frame before seeking", async () => {
    const result = await run({ frame: undefined, timeMs: 33 });
    expect(result).toMatchObject({ success: true, data: { frame: 1 } });
    expect(snapshot.mock.calls[0][0]).toBeCloseTo(100 / 3, 9);
  });
  it("serves identical repeats from the content-hash cache", async () => {
    expect((await run({})).success).toBe(true);
    expect(snapshot).toHaveBeenCalledOnce();
    const second = await run({ out: "again.png" });
    expect(second).toMatchObject({ success: true, data: { out: "again.png", cached: true } });
    expect(snapshot).toHaveBeenCalledOnce();
    expect(second.success && second.data.sha).toBeDefined();
    const bypassed = await executeFrameRender({ composition: "teaser.composition.json", frame: 1, out: "nocache.png", noCache: true }, { root });
    expect(bypassed).toMatchObject({ success: true, data: { cached: false } });
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
  it("invalidates the cache when scene source changes", async () => {
    expect((await run({})).success).toBe(true);
    await writeFile(path.join(root, "src/velora/scenes/demo.tsx"), "export default function Changed() { return null; }");
    const second = await run({ out: "changed.png" });
    expect(second).toMatchObject({ success: true, data: { cached: false } });
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
  it("holds the last scene frame when the segment outlasts the scene", async () => {
    await writeComposition([{ id: "s1", recipe: "demo", startMs: 0, durationMs: 6000 }]);
    const result = await run({ frame: 90 });
    expect(result).toMatchObject({ success: true, data: { frame: 90 } });
    expect(snapshot.mock.calls[0][0]).toBe(100);
    const manifest = JSON.parse(await readFile(path.join(root, "frame.manifest.json"), "utf8"));
    expect(manifest.frames[0].clamped).toBe(true);
  });
  it("renders timeline gaps as black void without a browser", async () => {
    await writeComposition([{ id: "s1", recipe: "demo", startMs: 0, durationMs: 30 }, { id: "s2", recipe: "demo", startMs: 70, durationMs: 30 }]);
    const result = await run({});
    expect(openCapture).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, data: { sceneId: "black-void", segmentId: "gap" } });
    const bytes = await readFile(path.join(root, "frame.png"));
    expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  });
  it("fails closed out of range without browser or file effects", async () => {
    const result = await run({ frame: 3 });
    expect(result).toMatchObject({ success: false, issues: [{ code: "ERR_FRAME_OUT_OF_RANGE" }] });
    expect(openCapture).not.toHaveBeenCalled();
    expect(await readdir(root)).not.toContain("frame.png");
  });
  it("rejects unknown recipes, bad compositions and overlaps before capture", async () => {
    await writeComposition([{ id: "s1", recipe: "ghost", startMs: 0, durationMs: 100 }]);
    expect(await run({})).toMatchObject({ success: false, issues: [{ code: "ERR_SCENE_NOT_FOUND" }] });
    await writeFile(path.join(root, "teaser.composition.json"), "{broken");
    expect(await run({})).toMatchObject({ success: false, issues: [{ code: "ERR_COMPOSITION_INVALID" }] });
    await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({ ...compositionDoc(), fps: 23 }));
    expect(await run({})).toMatchObject({ success: false, issues: [{ code: "ERR_COMPOSITION_INVALID", path: "composition.fps" }] });
    await writeComposition([{ id: "a", recipe: "demo", startMs: 0, durationMs: 80 }, { id: "b", recipe: "demo", startMs: 50, durationMs: 50 }]);
    expect(await run({})).toMatchObject({ success: false, issues: [{ code: "ERR_TIMELINE_OVERLAP" }] });
    expect(openCapture).not.toHaveBeenCalled();
  });
  it("refuses to overwrite outputs and propagates bridge failures with codes", async () => {
    await writeFile(path.join(root, "frame.png"), "keep");
    expect(await run({})).toMatchObject({ success: false, issues: [{ code: "output-exists" }] });
    expect(openCapture).not.toHaveBeenCalled();
    await rm(path.join(root, "frame.png"));
    vi.mocked(executeRecipeCommand).mockResolvedValue({ success: false, issues: [{ path: "url", message: "No server." }] });
    expect(await run({})).toMatchObject({ success: false, issues: [{ code: "ERR_SCENE_INVALID" }] });
    expect(await readdir(root)).not.toContain("frame.png");
  });
});
