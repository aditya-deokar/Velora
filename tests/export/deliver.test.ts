import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeDeliver } from "../../src/export/commands";
import { executeRecipeCommand } from "../../src/project/recipes";
import { openCapture } from "../../src/export/services";
import { DeliverablesManifestSchema, galleryTimesMs, heroEmbedHtml, heroTimeMs, heroVideoTsx, resolveDeliverTargets, sizeLadder } from "../../src/core/deliverables";
import { runCli } from "../../src/cli";
vi.mock("../../src/project/recipes", () => ({ executeRecipeCommand: vi.fn() }));
vi.mock("../../src/export/services", async (original) => ({ ...await original<typeof import("../../src/export/services")>(), openCapture: vi.fn() }));

// A real 16x16 gradient PNG (so encoders have content to compress).
const png = "data:image/png;base64," + execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "gradients=s=16x16:seed=2", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"]).toString("base64");
const recipeDoc = (id: string) => ({ version: 1, id, title: id, definition: { width: 160, height: 90, scene: { nodes: [] } } });
let root: string;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(path.join(tmpdir(), "velora-deliver-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  for (const id of ["shot-a", "shot-b"]) {
    await writeFile(path.join(root, `src/velora/scenes/${id}.scene.json`), JSON.stringify(recipeDoc(id)));
    await writeFile(path.join(root, `src/velora/scenes/${id}.tsx`), "export default function S() { return null; }");
  }
  await writeFile(path.join(root, "launch.composition.json"), JSON.stringify({
    version: 1, id: "launch", title: "Fieldnote launch", width: 1920, height: 1080, fps: 30, seed: 4,
    scenes: [{ id: "s1", recipe: "shot-a", startMs: 0, durationMs: 100 }, { id: "s2", recipe: "shot-b", startMs: 100, durationMs: 200 }], assets: [],
  }));
  vi.mocked(executeRecipeCommand).mockImplementation(async (_op, input: unknown) => ({ success: true, data: { url: `http://127.0.0.1:9/${(input as { sceneId: string }).sceneId}` } }) as never);
  vi.mocked(openCapture).mockImplementation(async () => ({
    close: vi.fn(), manifest: async () => ({ version: 1, durationMs: 300, selector: '[data-velora-capture="scene"]' }),
    snapshot: vi.fn(async () => png), encode: vi.fn(),
  }) as Awaited<ReturnType<typeof openCapture>>);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const probe = (file: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", path.join(root, file)], { encoding: "utf8" })).streams[0];

describe("deliver plan (pure)", () => {
  it("resolves short names and preset ids once each, in request order", () => {
    const { targets, unknown } = resolveDeliverTargets(["reels", "instagram-reel", "youtube", "og-image", "nope", "github-readme-gif"]);
    expect(targets.map(t => [t.name, t.preset.id, t.kind])).toEqual([
      ["reels", "instagram-reel", "video"], ["youtube", "youtube-1080p", "video"], ["og-image", "og-image", "still"], ["readme-gif", "github-readme-gif", "video"],
    ]);
    expect(unknown).toEqual(["nope"]);
  });
  it("climbs a deterministic, monotonic rate-control ladder per codec", () => {
    expect(sizeLadder("h264", "master")).toEqual([{ crf: 14 }, { crf: 18 }, { crf: 22 }, { crf: 26 }]);
    expect(sizeLadder("vp9", "standard")).toEqual([{ crf: 31 }, { crf: 37 }, { crf: 43 }, { crf: 49 }]);
    expect(sizeLadder("gif", "standard", 15)).toEqual([{ gifFps: 15 }, { gifFps: 12 }, { gifFps: 10 }, { gifFps: 8 }]);
    expect(sizeLadder("prores4444", "master")).toEqual([{}]);
    expect(sizeLadder("vp9", "standard")).toEqual(sizeLadder("vp9", "standard"));
  });
  it("picks the hero frame from the longest shot and spreads gallery stills", () => {
    expect(heroTimeMs({ scenes: [{ id: "a", recipe: "a", startMs: 0, durationMs: 1000 }, { id: "b", recipe: "b", startMs: 1000, durationMs: 3000 }] } as never)).toBe(2500);
    expect(galleryTimesMs(8000)).toEqual([2000, 4000, 6000]);
  });
  it("writes accessible, layout-stable hero snippets with WebM before MP4", () => {
    const files = { webm: "hero.webm", mp4: "hero.mp4", poster: "hero.poster.jpg", width: 1920, height: 1080, title: 'Say "hi" <now>' };
    const html = heroEmbedHtml(files);
    expect(html).toMatch(/<video[^>]*\bautoplay\b[^>]*\bmuted\b[^>]*\bloop\b[^>]*\bplaysinline\b[^>]*preload="metadata"[^>]*poster="hero.poster.jpg"[^>]*width="1920"[^>]*height="1080"/);
    expect(html.indexOf("video/webm")).toBeLessThan(html.indexOf("video/mp4"));
    expect(html).toContain("prefers-reduced-motion: reduce");
    expect(html).toContain("Say &quot;hi&quot; &lt;now&gt;");
    expect(html).not.toContain("<now>");
    const tsx = heroVideoTsx(files);
    expect(tsx).toContain("autoPlay muted loop playsInline");
    expect(tsx).toContain("prefers-reduced-motion");
  });
});

describe("velora deliver", () => {
  it("produces every target's files at the preset size, with snippets, stills and a manifest", async () => {
    const result = await executeDeliver({ composition: "launch.composition.json", targets: ["youtube", "reels", "website-hero", "readme-gif", "og-image", "product-hunt"] }, { root });
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, data: { out: "deliverables/launch", manifest: "deliverables/launch/deliverables.json" } });
    const dir = path.join(root, "deliverables/launch");
    expect((await readdir(dir)).sort()).toEqual([
      "HeroVideo.tsx", "deliverables.json", "embed.html", "hero.manifest.json", "hero.mp4", "hero.poster.jpg", "hero.webm", "hero.webm.manifest.json",
      "og-image.png", "product-hunt-1.png", "product-hunt-2.png", "product-hunt-3.png", "product-hunt.manifest.json", "product-hunt.mp4", "product-hunt.poster.png",
      "readme-gif.gif", "readme-gif.gif.manifest.json", "reels.manifest.json", "reels.mp4", "reels.poster.png", "youtube.manifest.json", "youtube.mp4", "youtube.poster.png",
    ]);
    expect([probe("deliverables/launch/reels.mp4").width, probe("deliverables/launch/reels.mp4").height]).toEqual([1080, 1920]);
    expect(probe("deliverables/launch/hero.webm").codec_name).toBe("vp9");
    expect(probe("deliverables/launch/hero.mp4").codec_name).toBe("h264");
    expect(probe("deliverables/launch/readme-gif.gif").codec_name).toBe("gif");
    expect([probe("deliverables/launch/og-image.png").width, probe("deliverables/launch/og-image.png").height]).toEqual([1200, 630]);
    expect([probe("deliverables/launch/product-hunt-2.png").width, probe("deliverables/launch/hero.poster.jpg").codec_name]).toEqual([1270, "mjpeg"]);
    const manifest = DeliverablesManifestSchema.parse(JSON.parse(await readFile(path.join(dir, "deliverables.json"), "utf8")));
    expect(manifest.targets.map(t => t.name)).toEqual(["youtube", "reels", "website-hero", "readme-gif", "og-image", "product-hunt"]);
    const hero = manifest.targets.find(t => t.name === "website-hero")!;
    expect(hero.files.map(f => [f.path.split("/").pop(), f.role])).toEqual([["hero.webm", "video"], ["hero.mp4", "fallback"], ["hero.poster.jpg", "poster"], ["embed.html", "embed"], ["HeroVideo.tsx", "component"]]);
    for (const target of manifest.targets) {
      expect(target.presetLastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const file of target.files) expect(file.bytes).toBeGreaterThan(0);
      if (target.kind !== "still") expect(target.attempts[0].withinBudget).toBe(true);
    }
    expect(manifest.targets.find(t => t.name === "og-image")!.warnings.map(w => w.code)).toEqual(["WARN_DELIVER_CROPPED"]);
    expect(manifest.heroTimeMs).toBe(200);
  }, 240_000);
  it("climbs the ladder until a file fits its budget, and warns when nothing does", async () => {
    const sizes: number[] = [];
    // A stub render: file size falls with each CRF step; github-readme-gif's budget is 10 MB.
    const render = vi.fn(async (input: { out: string; crf?: number; gifFps?: number; poster?: number }) => {
      const bytes = input.gifFps ? (input.gifFps > 10 ? 12 : 9) * 1048576 : 1000;
      sizes.push(bytes);
      await mkdir(path.dirname(path.join(root, input.out)), { recursive: true });
      await writeFile(path.join(root, input.out), Buffer.alloc(bytes));
      const manifest = input.out.endsWith(".mp4") ? input.out.slice(0, -4) + ".manifest.json" : input.out + ".manifest.json";
      await writeFile(path.join(root, manifest), "{}");
      return { success: true as const, data: { out: input.out, manifest, frames: 9, durationMs: 300, fps: 30, width: 960, height: 540, seed: 4, cachedFrames: 0, renderedFrames: 9, codec: "gif" } };
    });
    const result = await executeDeliver({ composition: "launch.composition.json", targets: ["readme-gif"], out: "out/gif" }, { root }, render as never);
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    expect(render.mock.calls.map(([input]) => (input as { gifFps: number }).gifFps)).toEqual([15, 12, 10]);
    const manifest = DeliverablesManifestSchema.parse(JSON.parse(await readFile(path.join(root, "out/gif/deliverables.json"), "utf8")));
    expect(manifest.targets[0].attempts.map(a => [a.gifFps, a.withinBudget])).toEqual([[15, false], [12, false], [10, true]]);
    expect(manifest.targets[0].warnings).toEqual([]);
    expect(await readdir(path.join(root, "out/gif"))).not.toContain(".velora-attempts");

    render.mockImplementation(async (input: { out: string }) => {
      await mkdir(path.dirname(path.join(root, input.out)), { recursive: true });
      await writeFile(path.join(root, input.out), Buffer.alloc(11 * 1048576));
      await writeFile(path.join(root, input.out + ".manifest.json"), "{}");
      return { success: true as const, data: { out: input.out, manifest: input.out + ".manifest.json", frames: 9, durationMs: 300, fps: 30, width: 960, height: 540, seed: 4, cachedFrames: 0, renderedFrames: 9, codec: "gif" } };
    });
    const over = await executeDeliver({ composition: "launch.composition.json", targets: ["readme-gif"], out: "out/gif-2" }, { root }, render as never);
    expect(over).toMatchObject({ success: true, data: { targets: [{ warnings: [{ code: "WARN_DELIVER_BUDGET" }] }] } });
  });
  it("rejects unknown targets, an existing output directory and a bad composition before rendering", async () => {
    const render = vi.fn();
    expect(await executeDeliver({ composition: "launch.composition.json", targets: ["youtube", "myspace"] }, { root }, render as never))
      .toMatchObject({ success: false, issues: [{ code: "ERR_DELIVER_TARGET", message: expect.stringContaining("myspace") }] });
    await mkdir(path.join(root, "deliverables/launch"), { recursive: true });
    expect(await executeDeliver({ composition: "launch.composition.json", targets: ["youtube"] }, { root }, render as never)).toMatchObject({ success: false, issues: [{ code: "output-exists" }] });
    expect(await executeDeliver({ composition: "missing.composition.json", targets: ["youtube"], out: "x" }, { root }, render as never)).toMatchObject({ success: false });
    expect(await executeDeliver({ composition: "launch.composition.json", targets: ["youtube"], out: "../escape" }, { root }, render as never)).toMatchObject({ success: false, issues: [{ code: "invalid-input" }] });
    expect(render).not.toHaveBeenCalled();
  });
  it("leaves no output directory behind when a render fails, so a retry can reuse the name", async () => {
    const render = vi.fn(async () => ({ success: false as const, issues: [{ code: "export-failed", message: "capture timed out" }] }));
    const result = await executeDeliver({ composition: "launch.composition.json", targets: ["youtube"], out: "deliverables/retry" }, { root }, render as never);
    expect(result).toMatchObject({ success: false, issues: [{ code: "export-failed", message: "youtube: capture timed out" }] });
    expect(await readdir(path.join(root, "deliverables"))).toEqual([]);
  });
  it("is wired into the CLI with usage errors for missing targets", async () => {
    expect((await runCli(["deliver", "--composition", "launch.composition.json", "--json"], { root })).code).toBe(2);
    expect((await runCli(["deliver", "--help"], { root })).stdout).toContain("website-hero");
    const stub = vi.fn(async () => ({ success: true as const, data: { out: "d", manifest: "d/deliverables.json", targets: [{ name: "youtube", preset: "youtube-1080p", files: ["d/youtube.mp4"], warnings: [] }] } }));
    const args: unknown[] = Array.from({ length: 20 }, () => undefined);
    const result = await (runCli as (...all: unknown[]) => Promise<{ code: number; stdout: string }>)(["deliver", "--composition", "launch.composition.json", "--targets", "youtube, reels", "--quality", "draft", "--json", "--no-stream"], { root }, ...args.slice(0, 18), stub);
    expect(result.code).toBe(0);
    expect(stub).toHaveBeenCalledWith(expect.objectContaining({ targets: ["youtube", "reels"], quality: "draft" }), expect.anything());
    expect(JSON.parse(result.stdout)).toMatchObject({ success: true, command: "deliver" });
  });
});
