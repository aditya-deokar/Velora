import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("../../src/project/commands", () => ({ executeProjectCommand: vi.fn() }));
import { runCli } from "../../src/cli";
import { CliEnvelopeSchema } from "../../src/core/cli-schema";

const context = { root: "/project" };
const ok = { success: true, data: { out: "frame.png", manifest: "frame.manifest.json", frame: 1, timeMs: 100 / 3, sceneId: "demo", segmentId: "s1", sha: "0".repeat(64), cached: false } };
function envelope(text: string) {
  const parsed = JSON.parse(text);
  expect(CliEnvelopeSchema.safeParse(parsed).success, text).toBe(true);
  return parsed;
}

describe("render command", () => {
  it("routes frame requests through the renderer with port-aware server default", async () => {
    const renderer = vi.fn().mockResolvedValue(ok);
    const result = await runCli(["render", "--composition", "t.composition.json", "--frame", "1", "--out", "frame.png", "--json"], { ...context, port: "6211" }, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), renderer);
    expect(renderer).toHaveBeenCalledWith(
      { composition: "t.composition.json", frame: 1, out: "frame.png" },
      { root: "/project", url: "http://127.0.0.1:6211" },
    );
    expect(result.code).toBe(0);
    expect(envelope(result.stdout)).toMatchObject({ success: true, command: "render" });
  });
  it("supports --time, --url, --no-cache and human output", async () => {
    const renderer = vi.fn().mockResolvedValue(ok);
    const result = await runCli(["render", "--composition", "t.composition.json", "--time", "33", "--out", "f.png", "--url", "http://127.0.0.1:9999", "--no-cache", "--cache-dir", "tmp/cache"], context, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), renderer);
    expect(renderer).toHaveBeenCalledWith(
      { composition: "t.composition.json", timeMs: 33, out: "f.png", cacheDir: "tmp/cache", noCache: true },
      { root: "/project", url: "http://127.0.0.1:9999" },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Rendered frame 1");
    expect(result.stdout).toContain("frame.png");
  });
  it.each([
    ["render", "--frame", "1", "--out", "f.png", "--json"],
    ["render", "--composition", "t.composition.json", "--frame", "1", "--json"],
    ["render", "--composition", "t.composition.json", "--frame", "1", "--time", "10", "--out", "f.png", "--json"],
  ])("rejects incomplete %j with usage errors before rendering", async (...args) => {
    const renderer = vi.fn();
    const result = await runCli(args, context, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), renderer);
    expect(result.code).toBe(2);
    expect(renderer).not.toHaveBeenCalled();
    expect(envelope(result.stderr).issues[0].code).toBe("ERR_MISSING_VALUE");
  });
  it("rejects still/video mode mismatches before rendering", async () => {
    const renderer = vi.fn();
    const video = await runCli(["render", "--composition", "t.composition.json", "--out", "f.png", "--json"], context, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), renderer);
    expect(video.code).toBe(2);
    expect(renderer).not.toHaveBeenCalled();
    expect(envelope(video.stderr).issues[0].code).toBe("invalid-input");
  });
  it("normalizes renderer failures and crashes without leaking", async () => {
    const failure = vi.fn().mockResolvedValue({ success: false, issues: [{ code: "ERR_FRAME_OUT_OF_RANGE", message: "Outside." }] });
    const bad = await runCli(["render", "--composition", "t.composition.json", "--frame", "9", "--out", "f.png", "--json"], context, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), failure);
    expect(bad.code).toBe(1);
    expect(envelope(bad.stderr).issues[0]).toMatchObject({ code: "ERR_FRAME_OUT_OF_RANGE", hint: expect.any(String) });
    const crash = vi.fn().mockRejectedValue(new Error("secret boom"));
    const crashed = await runCli(["render", "--composition", "t.composition.json", "--frame", "1", "--out", "f.png", "--json"], context, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), crash);
    expect(crashed.code).toBe(1);
    expect(crashed.stderr).not.toContain("secret boom");
    expect(envelope(crashed.stderr).issues[0].code).toBe("ERR_INTERNAL");
  });
  it("documents render in help", async () => {
    const help = await runCli(["render", "--help"], context, vi.fn());
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--frame");
    expect(help.stdout).toContain("--time");
    const viaHelp = await runCli(["help", "render"], context, vi.fn());
    expect(viaHelp.stdout).toBe(help.stdout);
    const top = await runCli(["--help"], context, vi.fn());
    expect(top.stdout).toContain("velora render");
  });
  it("fails closed on missing compositions without a browser", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "velora-render-empty-"));
    try {
      const result = await runCli(["render", "--composition", "nope.composition.json", "--frame", "0", "--out", "f.png", "--json"], { root: empty });
      expect(result.code).toBe(1);
      expect(envelope(result.stderr).issues[0].code).toBe("ERR_COMPOSITION_INVALID");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
