import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeVideoRender } from "../../src/export/commands";
import { executeRecipeCommand } from "../../src/project/recipes";
import { openCapture } from "../../src/export/services";
import { RenderManifestSchema } from "../../src/core/export";
vi.mock("../../src/project/recipes", () => ({ executeRecipeCommand: vi.fn() }));
vi.mock("../../src/export/services", async (original) => ({ ...await original<typeof import("../../src/export/services")>(), openCapture: vi.fn() }));

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPdwAAAAASUVORK5CYII=";
function toneWav(): Buffer {
  const rate = 8000, samples = rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const recipeDoc = (id: string) => ({ version: 1, id, title: id, definition: { width: 128, height: 96, scene: { nodes: [] } } });
let root: string;
let seeks: { url: string; timeMs: number }[];
async function setup(files: Record<string, string | Buffer> = {}) {
  root = await mkdtemp(path.join(tmpdir(), "velora-video-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  for (const id of ["demo-a", "demo-b"]) {
    await writeFile(path.join(root, `src/velora/scenes/${id}.scene.json`), JSON.stringify(recipeDoc(id)));
    await writeFile(path.join(root, `src/velora/scenes/${id}.tsx`), "export default function S() { return null; }");
  }
  await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({
    version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 3,
    scenes: [
      { id: "s1", recipe: "demo-a", startMs: 0, durationMs: 100 },
      { id: "s2", recipe: "demo-b", startMs: 100, durationMs: 100 },
    ], assets: [],
  }));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
}
function ffprobe(file: string) {
  return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", path.join(root, file)], { encoding: "utf8" }).toString()).streams;
}
beforeEach(async () => {
  vi.clearAllMocks();
  seeks = [];
  await setup();
  vi.mocked(executeRecipeCommand).mockImplementation(async (_op, input: unknown) => ({
    success: true, data: { url: `http://127.0.0.1:9/${(input as { sceneId: string }).sceneId}` },
  }) as never);
  vi.mocked(openCapture).mockImplementation(async (input: { url: string }) => ({
    close: vi.fn(),
    manifest: async () => ({ version: 1, durationMs: 100, selector: '[data-velora-capture="scene"]' }),
    snapshot: vi.fn(async (timeMs: number) => {
      seeks.push({ url: input.url, timeMs });
      return png;
    }),
    encode: vi.fn(),
  }) as Awaited<ReturnType<typeof openCapture>>);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const progress: [number, number][] = [];
const run = (input: object, context: object = {}) => executeVideoRender(
  { composition: "teaser.composition.json", out: "teaser.mp4", ...input },
  { root, url: "http://127.0.0.1:9", onProgress: (done: number, total: number) => { progress.push([done, total]); }, ...context },
);

describe("composition video render", () => {
  it("encodes timeline frames to MP4 with a valid manifest", async () => {
    progress.length = 0;
    const result = await run({});
    expect(result).toMatchObject({ success: true, data: { out: "teaser.mp4", manifest: "teaser.manifest.json", frames: 6, durationMs: 200, fps: 30, cachedFrames: 0, renderedFrames: 6 } });
    const streams = ffprobe("teaser.mp4").map((s: { codec_type: string; codec_name: string }) => `${s.codec_type}:${s.codec_name}`);
    expect(streams).toContain("video:h264");
    expect(Number(ffprobe("teaser.mp4").find((s: { codec_type: string }) => s.codec_type === "video").nb_frames)).toBe(6);
    const manifest = JSON.parse(await readFile(path.join(root, "teaser.manifest.json"), "utf8"));
    expect(RenderManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({ kind: "video", compositionId: "teaser", seed: 3, segments: [{ id: "s1" }, { id: "s2" }] });
    expect(manifest.frames).toHaveLength(6);
    expect(manifest.frames.every((f: { sha: string }) => /^[0-9a-f]{64}$/.test(f.sha))).toBe(true);
    expect(progress[progress.length - 1]).toEqual([6, 6]);
  }, 120_000);
  it("serves repeats from cache and matches parallel assembly", async () => {
    expect((await run({})).success).toBe(true);
    const firstSeeks = seeks.length;
    expect(firstSeeks).toBe(6);
    const second = await run({ out: "cached.mp4" });
    expect(second).toMatchObject({ success: true, data: { cachedFrames: 6, renderedFrames: 0 } });
    expect(seeks.length).toBe(firstSeeks);
    const parallel = await run({ out: "parallel.mp4", parallel: 2 });
    expect(parallel.success).toBe(true);
    const serialManifest = JSON.parse(await readFile(path.join(root, "teaser.manifest.json"), "utf8"));
    const parallelManifest = JSON.parse(await readFile(path.join(root, "parallel.manifest.json"), "utf8"));
    expect(parallelManifest.frames.map((f: { sha: string }) => f.sha)).toEqual(serialManifest.frames.map((f: { sha: string }) => f.sha));
  }, 180_000);
  it("re-renders only edited scenes", async () => {
    expect((await run({})).success).toBe(true);
    expect(seeks.length).toBe(6);
    await writeFile(path.join(root, "src/velora/scenes/demo-b.tsx"), "export default function Changed() { return null; }");
    expect((await run({ out: "edited.mp4" })).success).toBe(true);
    expect(seeks.length).toBe(9);
    expect(seeks.slice(6).every((s) => s.url.endsWith("/demo-b"))).toBe(true);
  }, 180_000);
  it("renders overlap transitions and overlays as recorded layers", async () => {
    await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({
      version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 3,
      scenes: [{ id: "s1", recipe: "demo-a", startMs: 0, durationMs: 200 }, { id: "s2", recipe: "demo-b", startMs: 100, durationMs: 200, transition: { type: "crossfade", durationMs: 100 } }],
      overlays: [{ id: "title", recipe: "demo-b", startMs: 200, durationMs: 100 }], assets: [],
    }));
    const result = await run({ out: "layered.mp4" });
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, data: { frames: 9, durationMs: 300 } });
    const manifest = JSON.parse(await readFile(path.join(root, "layered.manifest.json"), "utf8"));
    expect(RenderManifestSchema.safeParse(manifest).success).toBe(true);
    const layers = manifest.frames.map((f: { layers?: { id: string }[] }) => (f.layers ?? []).map(layer => layer.id).join("+"));
    expect(layers).toEqual(["", "", "", "s1+s2", "s1+s2", "s1+s2", "s2+title", "s2+title", "s2+title"]);
    expect(manifest.frames[2].segmentId).toBe("s1");
    expect(manifest.frames[8].segmentId).toBe("s2");
    // A frame inside the window captured A and B at their own local times.
    expect(seeks.filter((s) => s.url.endsWith("/demo-b")).map((s) => Math.round(s.timeMs)).slice(0, 3)).toEqual([0, 33, 67]);
  }, 180_000);
  it("renders gaps as black void and mixes audio with drift evidence", async () => {
    await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({
      version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 3,
      scenes: [
        { id: "s1", recipe: "demo-a", startMs: 0, durationMs: 40 },
        { id: "s2", recipe: "demo-b", startMs: 70, durationMs: 40 },
      ], assets: [],
    }));
    const gapped = await run({ out: "gapped.mp4" });
    expect(gapped).toMatchObject({ success: true, data: { frames: 4 } });
    const manifest = JSON.parse(await readFile(path.join(root, "gapped.manifest.json"), "utf8"));
    expect(manifest.frames.map((f: { sceneId: string }) => f.sceneId)).toEqual(["demo-a", "demo-a", "black-void", "demo-b"]);
    await mkdir(path.join(root, "assets"), { recursive: true });
    await writeFile(path.join(root, "assets/tone.wav"), toneWav());
    await writeFile(path.join(root, "subs.srt"), "1\n00:00:00,050 --> 00:00:00,150\nHi\n");
    await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({
      version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 3,
      scenes: [{ id: "s1", recipe: "demo-a", startMs: 0, durationMs: 200 }],
      assets: [{ id: "tone", path: "assets/tone.wav", type: "audio" }],
      audio: [{ id: "music", assetId: "tone", startMs: 0 }],
      captions: { file: "subs.srt", burnIn: true },
    }));
    const mixed = await run({ out: "mixed.mp4" });
    expect(mixed, JSON.stringify(mixed)).toMatchObject({ success: true });
    const streams = ffprobe("mixed.mp4").map((s: { codec_type: string }) => s.codec_type);
    expect(streams).toContain("audio");
    const mixedManifest = JSON.parse(await readFile(path.join(root, "mixed.manifest.json"), "utf8"));
    expect(mixedManifest.audio.driftMs).toBeLessThanOrEqual(40);
    expect(mixedManifest.captions).toMatchObject({ cues: 1, burnIn: true, windows: [{ startMs: 50, endMs: 150 }] });
    expect(mixedManifest.ffmpegArgs.join(" ")).toContain("subtitles=");
  }, 180_000);
  it("fails closed on broken compositions without publishing", async () => {
    await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({
      version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 0,
      scenes: [{ id: "s1", recipe: "ghost", startMs: 0, durationMs: 100 }], assets: [],
    }));
    expect(await run({ out: "ghost.mp4" })).toMatchObject({ success: false, issues: [{ code: "ERR_SCENE_NOT_FOUND" }] });
    await writeFile(path.join(root, "teaser.composition.json"), JSON.stringify({
      version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 0,
      scenes: [
        { id: "s1", recipe: "demo-a", startMs: 0, durationMs: 100 },
        { id: "s2", recipe: "demo-b", startMs: 50, durationMs: 100 },
      ], assets: [],
    }));
    expect(await run({ out: "overlap.mp4" })).toMatchObject({ success: false, issues: [{ code: "ERR_TIMELINE_OVERLAP" }] });
    expect(seeks.length).toBe(0);
  }, 120_000);
});
