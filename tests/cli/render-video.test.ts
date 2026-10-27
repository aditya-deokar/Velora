import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/project/commands", () => ({ executeProjectCommand: vi.fn() }));
import { runCli } from "../../src/cli";
import { CliEnvelopeSchema } from "../../src/core/cli-schema";

const context = { root: "/project" };
function envelope(text: string) {
  const parsed = JSON.parse(text);
  expect(CliEnvelopeSchema.safeParse(parsed).success, text).toBe(true);
  return parsed;
}
const ex = () => vi.fn();
const videoOk = { success: true, command: "render", data: { out: "t.mp4", manifest: "t.manifest.json", frames: 6, durationMs: 200, fps: 30, width: 128, height: 96, seed: 0, cachedFrames: 2, renderedFrames: 4 } };

describe("render video mode", () => {
  it("routes video requests with defaults and streams NDJSON progress", async () => {
    const video = vi.fn().mockImplementation(async (_input, ctx: { onProgress?: (d: number, t: number) => void }) => {
      ctx.onProgress?.(3, 6);
      ctx.onProgress?.(6, 6);
      return videoOk;
    });
    const result = await runCli(["render", "--composition", "t.composition.json", "--out", "t.mp4", "--json"], { ...context, port: "6233" }, ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), video);
    expect(video).toHaveBeenCalledWith(
      { composition: "t.composition.json", out: "t.mp4" },
      { root: "/project", url: "http://127.0.0.1:6233", onProgress: expect.any(Function) },
    );
    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0])).toMatchObject({ type: "progress", frame: 3, total: 6, pct: 50 });
    expect(JSON.parse(lines[1])).toMatchObject({ type: "progress", frame: 6, total: 6, pct: 100 });
    expect(envelope(lines[2])).toMatchObject({ success: true, command: "render" });
  });
  it("prints a single envelope behind --no-stream and honors overrides", async () => {
    const video = vi.fn().mockResolvedValue(videoOk);
    const result = await runCli(["render", "--composition", "t.composition.json", "--out", "t.mp4", "--parallel", "2", "--fps", "60", "--width", "256", "--height", "192", "--no-cache", "--no-stream", "--json"],
      context, ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), video);
    expect(video).toHaveBeenCalledWith(
      { composition: "t.composition.json", out: "t.mp4", parallel: 2, fps: 60, width: 256, height: 192, noCache: true },
      { root: "/project", url: "http://127.0.0.1:5173" },
    );
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(envelope(result.stdout)).toMatchObject({ success: true });
  });
  it("reports human summaries and normalizes failures", async () => {
    const video = vi.fn().mockResolvedValue(videoOk);
    const human = await runCli(["render", "--composition", "t.composition.json", "--out", "t.mp4"], context, ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), video);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("t.mp4 (6 frames at 30 FPS, 128x96, h264 standard, seed 0, 2 cached)");
    const failure = vi.fn().mockResolvedValue({ success: false, issues: [{ code: "ERR_TIMELINE_OVERLAP", message: "Overlap." }] });
    const bad = await runCli(["render", "--composition", "t.composition.json", "--out", "t.mp4", "--json"], context, ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), failure);
    expect(bad.code).toBe(1);
    expect(envelope(bad.stderr).issues[0]).toMatchObject({ code: "ERR_TIMELINE_OVERLAP", hint: expect.any(String) });
  });
  it("documents video mode in help", async () => {
    const help = await runCli(["render", "--help"], context, vi.fn());
    expect(help.stdout).toContain("--parallel");
    expect(help.stdout).toContain("--no-stream");
  });
});
