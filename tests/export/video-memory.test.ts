import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeVideoRender } from "../../src/export/commands";
import { executeRecipeCommand } from "../../src/project/recipes";
import { encodeFrameBuffers, openCapture, spillFrame } from "../../src/export/services";
vi.mock("../../src/project/recipes", () => ({ executeRecipeCommand: vi.fn() }));
vi.mock("../../src/export/services", async (original) => {
  const actual = await original<typeof import("../../src/export/services")>();
  return { ...actual, openCapture: vi.fn(), spillFrame: vi.fn(actual.spillFrame), encodeFrameBuffers: vi.fn(actual.encodeFrameBuffers) };
});

// Long launch films must not hold every captured PNG in memory: video renders spill
// each frame to a project-scoped temporary sequence and stream it into the encoder.
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPdwAAAAASUVORK5CYII=";
let root: string;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(path.join(tmpdir(), "velora-video-memory-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  await writeFile(path.join(root, "src/velora/scenes/demo.scene.json"), JSON.stringify({ version: 1, id: "demo", title: "Demo", definition: { width: 128, height: 96, scene: { nodes: [] } } }));
  await writeFile(path.join(root, "src/velora/scenes/demo.tsx"), "export default function S() { return null; }");
  await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({
    version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 1,
    scenes: [{ id: "s1", recipe: "demo", startMs: 0, durationMs: 100 }, { id: "s2", recipe: "demo", startMs: 140, durationMs: 100 }], assets: [],
  }));
  vi.mocked(executeRecipeCommand).mockResolvedValue({ success: true, data: { url: "http://127.0.0.1:9/demo" } } as never);
  vi.mocked(openCapture).mockResolvedValue({ close: vi.fn(), manifest: async () => ({ version: 1, durationMs: 100, selector: '[data-velora-capture="scene"]' }), snapshot: vi.fn(async () => png), encode: vi.fn() } as Awaited<ReturnType<typeof openCapture>>);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("bounded-memory video render", () => {
  it("spills every frame, including gaps, and encodes from the sequence in order", async () => {
    const result = await executeVideoRender({ composition: "teaser.composition.json", out: "teaser.mp4", noCache: true }, { root });
    expect(result).toMatchObject({ success: true, data: { frames: 8 } });
    expect(vi.mocked(spillFrame).mock.calls.map(call => call[1]).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const source = vi.mocked(encodeFrameBuffers).mock.calls[0][0];
    expect(Array.isArray(source)).toBe(false);
    expect(source).toMatchObject({ count: 8 });
    const stream = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-of", "json", path.join(root, "teaser.mp4")], { encoding: "utf8" })).streams[0];
    expect(Number(stream.nb_read_frames)).toBe(8);
    expect((await readdir(root)).filter(name => name.startsWith(".velora-video-"))).toEqual([]);
  }, 120_000);
});
