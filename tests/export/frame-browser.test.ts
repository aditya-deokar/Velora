import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { executeFrameRender } from "../../src/export/commands";
import { executeRecipeCommand } from "../../src/project/recipes";
import { parsePng } from "../../src/export/services";
vi.mock("../../src/project/recipes", () => ({ executeRecipeCommand: vi.fn() }));

let server: Server;
let root: string;
let url: string;
// Deterministic fixture scene: the box color flips at t=40 and slides with t.
// Same seek time must rasterize byte-identically on every run.
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-frame-live-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  await writeFile(path.join(root, "src/velora/scenes/demo.scene.json"),
    JSON.stringify({ version: 1, id: "demo", title: "Demo", definition: { width: 128, height: 96, scene: { nodes: [] } } }));
  await writeFile(path.join(root, "src/velora/scenes/demo.tsx"), "export default function Demo() { return null; }");
  await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({
    version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 7,
    scenes: [{ id: "s1", recipe: "demo", startMs: 0, durationMs: 100 }], assets: [],
  }));
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<style>body{margin:0}#scene{width:127px;height:95px;background:black}#box{width:32px;height:32px;background:red}</style><div id="scene" data-velora-capture="scene"><div id="box"></div></div><script>window.__VELORA_CAPTURE__={version:1,durationMs:100,selector:'[data-velora-capture="scene"]',seek(t){document.getElementById('box').style.background=t<40?'red':'blue';document.getElementById('box').style.transform='translateX('+t+'px)'}}</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.mocked(executeRecipeCommand).mockResolvedValue({ success: true, data: { scenes: [], issues: [], selected: { id: "demo" }, url: `${url}/?velora-scene=demo` } } as never);
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}, 30_000);

describe("live frame determinism", () => {
  it("renders the same frame byte-identically on consecutive runs", async () => {
    const first = await executeFrameRender({ composition: "teaser.composition.json", frame: 1, out: "a.png", noCache: true }, { root, url });
    const second = await executeFrameRender({ composition: "teaser.composition.json", frame: 1, out: "b.png", noCache: true }, { root, url });
    expect(first).toMatchObject({ success: true, data: { frame: 1, sceneId: "demo", cached: false } });
    expect(second).toMatchObject({ success: true, data: { frame: 1, sceneId: "demo", cached: false } });
    const [a, b] = await Promise.all([readFile(path.join(root, "a.png")), readFile(path.join(root, "b.png"))]);
    expect(a.equals(b)).toBe(true);
    expect(first.success && first.data.sha).toBe(second.success && second.data.sha);
    expect(first.success && first.data.sha).toBe(createHash("sha256").update(a).digest("hex"));
    // The seek actually moved scene content: frame 0 (red box) differs from frame 2 (blue box).
    const early = await executeFrameRender({ composition: "teaser.composition.json", frame: 0, out: "early.png", noCache: true }, { root, url });
    const late = await executeFrameRender({ composition: "teaser.composition.json", frame: 2, out: "late.png", noCache: true }, { root, url });
    expect(early.success && late.success).toBe(true);
    const [e, l] = await Promise.all([readFile(path.join(root, "early.png")), readFile(path.join(root, "late.png"))]);
    expect(e.equals(l)).toBe(false);
    const pixels = parsePng(l);
    expect(pixels.width).toBeGreaterThan(0);
    expect(pixels.height).toBeGreaterThan(0);
  }, 180_000);
});
