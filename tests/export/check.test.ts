import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { executeCheck } from "../../src/export/commands";
import { voidPng } from "../../src/export/services";

let root: string;
function ffmpeg(...args: string[]) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr?.toString().slice(0, 300)}`);
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function manifestDoc(frames: { frame: number; timeMs: number; sceneId: string; segmentId: string; file: string; sha: string; renderMs?: number }[], extra: Record<string, unknown> = {}) {
  return {
    version: 1, kind: "frames", compositionId: "teaser", compositionSha: "0".repeat(64),
    seed: 0, fps: 30, width: 128, height: 96, durationMs: 200,
    segments: [{ id: "s1", recipe: "demo", startMs: 0, durationMs: 200, frames: 6 }],
    frames, veloraVersion: "test", createdAt: "2026-01-01T00:00:00.000Z", ...extra,
  };
}
let contentPng: Buffer;
let blankPng: Buffer;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-check-"));
  ffmpeg("-f", "lavfi", "-i", "testsrc=size=128x96:rate=30:duration=2", "-frames:v", "1", path.join(root, "content.png"));
  contentPng = await readFile(path.join(root, "content.png"));
  blankPng = voidPng(128, 96);
  await writeFile(path.join(root, "blank.png"), blankPng);
  ffmpeg("-f", "lavfi", "-i", "testsrc=size=128x96:rate=30:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(root, "clip.mp4"));
  ffmpeg("-f", "lavfi", "-i", "testsrc=size=128x96:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(root, "av.mp4"));
}, 120_000);
afterAll(async () => { await rm(root, { recursive: true, force: true }); }, 30_000);
const run = (input: object) => executeCheck(input, { root });
const writeManifest = (dir: string, doc: unknown) => writeFile(path.join(root, dir, "manifest.json"), JSON.stringify(doc));

describe("check --frames", () => {
  it("passes healthy evidence with the full applicable suite", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "stills"), { recursive: true });
    await writeFile(path.join(root, "stills/f0.png"), contentPng);
    await writeFile(path.join(root, "stills/f1.png"), contentPng);
    await writeManifest("stills", manifestDoc([
      { frame: 0, timeMs: 0, sceneId: "demo", segmentId: "s1", file: "f0.png", sha: sha(contentPng), renderMs: 5 },
      { frame: 1, timeMs: 100 / 3, sceneId: "demo", segmentId: "s1", file: "f1.png", sha: sha(contentPng), renderMs: 6 },
    ], { captions: { file: "s.srt", cues: 1, burnIn: false, windows: [{ startMs: 0, endMs: 100 }] } }));
    const result = await run({ frames: "stills" });
    expect(result).toMatchObject({ success: true, command: "check" });
    expect(result.success && result.data.checks.map((c) => `${c.id}:${c.pass}`)).toEqual([
      "manifest-valid:true", "dimensions:true", "no-blank:true", "caption-coverage:true", "fps-budget:true",
    ]);
  });
  it("fails sha mismatches, missing files and bad manifests", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "broken"), { recursive: true });
    const bad = Buffer.from(contentPng);
    bad[100] ^= 0xff;
    await writeFile(path.join(root, "broken/f0.png"), bad);
    await writeManifest("broken", manifestDoc([{ frame: 0, timeMs: 0, sceneId: "demo", segmentId: "s1", file: "f0.png", sha: sha(contentPng) }]));
    const mismatch = await run({ frames: "broken" });
    expect(mismatch).toMatchObject({ success: false, issues: [{ code: "ERR_VISUAL_MANIFEST" }] });
    expect(!mismatch.success && mismatch.data?.checks.find((c) => c.id === "manifest-valid")?.pass).toBe(false);
    await mkdir(path.join(root, "ghost"), { recursive: true });
    await writeManifest("ghost", manifestDoc([{ frame: 0, timeMs: 0, sceneId: "demo", segmentId: "s1", file: "gone.png", sha: "0".repeat(64) }]));
    expect(await run({ frames: "ghost" })).toMatchObject({ success: false, issues: [{ code: "ERR_VISUAL_MANIFEST" }] });
    await mkdir(path.join(root, "nojunk"), { recursive: true });
    await writeFile(path.join(root, "nojunk/manifest.json"), "{oops");
    expect(await run({ frames: "nojunk" })).toMatchObject({ success: false, issues: [{ code: "ERR_VISUAL_MANIFEST" }] });
  });
  it("flags blank scenes but skips black-void gaps, dimensions and budgets", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "mixed"), { recursive: true });
    await writeFile(path.join(root, "mixed/dark.png"), blankPng);
    await writeFile(path.join(root, "mixed/void.png"), blankPng);
    await writeManifest("mixed", manifestDoc([
      { frame: 0, timeMs: 0, sceneId: "demo", segmentId: "s1", file: "dark.png", sha: sha(blankPng) },
      { frame: 1, timeMs: 100 / 3, sceneId: "black-void", segmentId: "gap", file: "void.png", sha: sha(blankPng) },
    ]));
    const result = await run({ frames: "mixed" });
    expect(result).toMatchObject({ success: false, issues: [{ code: "ERR_VISUAL_BLANK" }] });
    expect(!result.success && result.data?.checks.find((c) => c.id === "no-blank")?.frameRefs).toEqual(["mixed/dark.png"]);
    await mkdir(path.join(root, "sizes"), { recursive: true });
    await writeFile(path.join(root, "sizes/f0.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPdwAAAAASUVORK5CYII=", "base64"));
    await writeManifest("sizes", manifestDoc([{ frame: 0, timeMs: 0, sceneId: "demo", segmentId: "s1", file: "f0.png", sha: sha(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPdwAAAAASUVORK5CYII=", "base64")) }]));
    const sized = await run({ frames: "sizes" });
    expect(sized.success).toBe(false);
    expect(!sized.success && sized.issues.map((i) => i.code)).toContain("ERR_VISUAL_DIMENSIONS");
    await mkdir(path.join(root, "timed"), { recursive: true });
    await writeFile(path.join(root, "timed/f0.png"), contentPng);
    await writeManifest("timed", manifestDoc([{ frame: 0, timeMs: 0, sceneId: "demo", segmentId: "s1", file: "f0.png", sha: sha(contentPng), renderMs: 50 }]));
    expect(await run({ frames: "timed", budgetMs: 10 })).toMatchObject({ success: false, issues: [{ code: "ERR_VISUAL_BUDGET" }] });
    expect(await run({ frames: "timed", budgetMs: 100 })).toMatchObject({ success: true });
    await writeManifest("timed", manifestDoc(
      [{ frame: 0, timeMs: 0, sceneId: "demo", segmentId: "s1", file: "f0.png", sha: sha(contentPng), renderMs: 5 }],
      { captions: { file: "s.srt", cues: 1, burnIn: false, windows: [{ startMs: 5000, endMs: 6000 }] } }));
    expect(await run({ frames: "timed" })).toMatchObject({ success: false, issues: [{ code: "ERR_VISUAL_COVERAGE" }] });
  }, 60_000);
});

describe("check --video", () => {
  const videoManifest = (extra: Record<string, unknown> = {}) => ({
    version: 1, kind: "video", compositionId: "teaser", compositionSha: "0".repeat(64),
    seed: 0, fps: 30, width: 128, height: 96, durationMs: 2000,
    segments: [{ id: "s1", recipe: "demo", startMs: 0, durationMs: 2000, frames: 60 }],
    frames: [], veloraVersion: "test", createdAt: "2026-01-01T00:00:00.000Z", ...extra,
  });
  it("verifies streams, samples, drift and manifest cross-checks", async () => {
    const plain = await run({ video: "clip.mp4" });
    expect(plain).toMatchObject({ success: true });
    expect(plain.success && plain.data.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["streams-present", "no-blank", "dimensions"]));
    await writeFile(path.join(root, "clip.manifest.json"), JSON.stringify(videoManifest()));
    const crossed = await run({ video: "clip.mp4", manifest: "clip.manifest.json" });
    expect(crossed).toMatchObject({ success: true });
    await writeFile(path.join(root, "clip.manifest.json"), JSON.stringify(videoManifest({ fps: 60 })));
    expect(await run({ video: "clip.mp4", manifest: "clip.manifest.json" }))
      .toMatchObject({ success: false, issues: [{ code: "ERR_VISUAL_MANIFEST" }] });
    const plainAv = await run({ video: "av.mp4" });
    expect(plainAv).toMatchObject({ success: true });
    expect(plainAv.success && plainAv.data.checks.find((c) => c.id === "av-drift")?.pass).toBe(true);
    await writeFile(path.join(root, "av.manifest.json"), JSON.stringify(videoManifest({ audio: { tracks: [], driftMs: 0 } })));
    expect(await run({ video: "av.mp4", manifest: "av.manifest.json" })).toMatchObject({ success: true });
    await writeFile(path.join(root, "av.manifest.json"), JSON.stringify(videoManifest({ audio: { tracks: [], driftMs: 999 } })));
    expect(await run({ video: "av.mp4", manifest: "av.manifest.json" }))
      .toMatchObject({ success: false, issues: [{ code: "ERR_VISUAL_DRIFT" }] });
  }, 180_000);
  it("covers caption windows over sampled frames", async () => {
    await writeFile(path.join(root, "cap.manifest.json"), JSON.stringify(videoManifest({
      captions: { file: "s.srt", cues: 1, burnIn: false, windows: [{ startMs: 200, endMs: 1800 }] },
    })));
    expect(await run({ video: "clip.mp4", manifest: "cap.manifest.json" })).toMatchObject({ success: true });
    await writeFile(path.join(root, "cap.manifest.json"), JSON.stringify(videoManifest({
      captions: { file: "s.srt", cues: 1, burnIn: false, windows: [{ startMs: 1990, endMs: 2000 }] },
    })));
    expect(await run({ video: "clip.mp4", manifest: "cap.manifest.json" }))
      .toMatchObject({ success: false, issues: [{ code: "ERR_VISUAL_COVERAGE" }] });
  }, 180_000);
});
