import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeFrameRender } from "../../src/export/commands";
import { executeRecipeCommand } from "../../src/project/recipes";
import { hostFingerprint, openCapture } from "../../src/export/services";
vi.mock("../../src/project/recipes", () => ({ executeRecipeCommand: vi.fn() }));
vi.mock("../../src/export/services", async (original) => ({ ...await original<typeof import("../../src/export/services")>(), openCapture: vi.fn() }));

// Bindings import host components the cache key cannot see, so host edits must
// invalidate cached frames while render outputs and timeline edits must not.
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPdwAAAAASUVORK5CYII=";
const recipeDoc = { version: 1, id: "demo", title: "Demo", definition: { width: 128, height: 96, scene: { nodes: [] } } };
const composition = { version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 7, scenes: [{ id: "s1", recipe: "demo", startMs: 0, durationMs: 100 }], assets: [] };
const snapshot = vi.fn();
let root: string;
async function put(file: string, text: string | Buffer) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
async function touch(file: string, seconds: number) {
  const when = new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
  await utimes(path.join(root, file), when, when);
}
const render = (out: string) => executeFrameRender({ composition: "teaser.composition.json", frame: 1, out }, { root });
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(path.join(tmpdir(), "velora-cache-"));
  await put("src/velora/scenes/demo.scene.json", JSON.stringify(recipeDoc));
  await put("src/velora/scenes/demo.tsx", "import { Dashboard } from '../../components/Dashboard';\nexport default function Demo() { return <Dashboard />; }");
  await put("src/components/Dashboard.tsx", "export function Dashboard() { return <h1>Revenue</h1>; }");
  await put("src/styles.css", "h1 { color: white; }");
  await put("package-lock.json", '{"lockfileVersion":3}');
  await put("teaser.composition.json", JSON.stringify(composition));
  vi.mocked(executeRecipeCommand).mockResolvedValue({ success: true, data: { scenes: [], issues: [], selected: { ...recipeDoc, source: "src/velora/scenes/demo.scene.json", binding: "src/velora/scenes/demo.tsx" }, url: "http://127.0.0.1:5173/?velora-scene=demo" } } as never);
  snapshot.mockResolvedValue(png);
  vi.mocked(openCapture).mockResolvedValue({ close: vi.fn(), manifest: async () => ({ version: 1, durationMs: 100, selector: '[data-velora-capture="scene"]' }), snapshot, encode: vi.fn() } as Awaited<ReturnType<typeof openCapture>>);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("frame cache host invalidation", () => {
  it.each([
    ["an imported host component", "src/components/Dashboard.tsx", "export function Dashboard() { return <h1>Revenue up</h1>; }"],
    ["a host stylesheet", "src/styles.css", "h1 { color: gold; }"],
    ["a source image", "public/hero.png", Buffer.from([137, 80, 78, 71])],
    ["the lockfile", "package-lock.json", '{"lockfileVersion":3,"packages":{}}'],
  ])("re-renders after editing %s", async (_label, file, text) => {
    expect(await render("first.png")).toMatchObject({ success: true, data: { cached: false } });
    expect(await render("second.png")).toMatchObject({ success: true, data: { cached: true } });
    await put(file, text);
    expect(await render("third.png")).toMatchObject({ success: true, data: { cached: false } });
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
  it("stays cached across render outputs, manifests and composition edits", async () => {
    expect((await render("first.png")).success).toBe(true);
    await put("stills/manifest.json", "{}");
    await put("stills/frame-000001.png", Buffer.from([137, 80, 78, 71]));
    await put("teaser.composition.json", JSON.stringify({ ...composition, title: "Retitled" }));
    expect(await render("second.png")).toMatchObject({ success: true, data: { cached: true } });
    expect(snapshot).toHaveBeenCalledOnce();
  });
});

describe("hostFingerprint", () => {
  it("is stable for an unchanged tree and ignores dependency and build output", async () => {
    await touch("src/components/Dashboard.tsx", 1);
    const first = await hostFingerprint(root);
    await put("node_modules/react/index.js", "module.exports = {};");
    await put("dist/assets/index.js", "console.log(1);");
    await put(".git/HEAD", "ref: refs/heads/main");
    expect(await hostFingerprint(root)).toBe(first);
    await touch("src/components/Dashboard.tsx", 2);
    expect(await hostFingerprint(root)).not.toBe(first);
  });
  it("leaves per-scene files to the scene's own cache key", async () => {
    const first = await hostFingerprint(root);
    await put("src/velora/scenes/demo.tsx", "export default function Changed() { return null; }");
    expect(await hostFingerprint(root)).toBe(first);
  });
});
