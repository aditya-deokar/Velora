import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/project/commands", () => ({ executeProjectCommand: vi.fn() }));
import { runCli } from "../../src/cli";
import { CheckRenderResultSchema } from "../../src/core/export";
import { CliEnvelopeSchema } from "../../src/core/cli-schema";

const context = { root: "/project" };
const ex = () => vi.fn();
function envelope(text: string) {
  const parsed = JSON.parse(text);
  expect(CliEnvelopeSchema.safeParse(parsed).success, text).toBe(true);
  return parsed;
}
const framesOk = { success: true, command: "frames", data: { out: "stills", manifest: "stills/manifest.json", total: 3, frames: [] } };
const shotOk = { success: true, command: "shot", data: { out: "s.png", sceneId: "demo", timeMs: 40, sha: "0".repeat(64) } };
const checkOk = { success: true, command: "check", data: { target: "stills", checks: [{ id: "no-blank", pass: true, detail: "ok" }] } };

describe("frames command", () => {
  it("routes extraction with selectors and usage guards", async () => {
    const frames = vi.fn().mockResolvedValue(framesOk);
    // positions: execute, exporter, recipes, snapshotter, doctor, renderer, audio, captions, video, frames
    const deps = (f: unknown) => [ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), f] as never[];
    const result = await runCli(["frames", "--composition", "t.composition.json", "--out", "stills", "--every", "30", "--json"], context, ...deps(frames));
    expect(frames).toHaveBeenCalledWith(
      { composition: "t.composition.json", out: "stills", every: 30 },
      { root: "/project", url: "http://127.0.0.1:5173", onProgress: expect.any(Function) },
    );
    expect(result.code).toBe(0);
    expect(envelope(result.stdout)).toMatchObject({ success: true, command: "frames" });
    const at = await runCli(["frames", "--composition", "t.composition.json", "--out", "stills", "--at", "0,1500,3000"], context, ...deps(frames));
    expect(frames).toHaveBeenCalledWith(
      expect.objectContaining({ at: [0, 1500, 3000] }),
      expect.anything(),
    );
    expect(at.stdout).toContain("stills");
    for (const args of [
      ["frames", "--out", "stills", "--json"],
      ["frames", "--composition", "t.composition.json", "--json"],
      ["frames", "--composition", "t.composition.json", "--out", "stills", "--every", "2", "--at", "0", "--json"],
    ]) {
      const bad = await runCli(args, context, ...deps(vi.fn()));
      expect(bad.code).toBe(2);
    }
  });
  it("documents frames in help", async () => {
    expect((await runCli(["frames", "--help"], context, vi.fn())).stdout).toContain("--every");
    expect((await runCli(["--help"], context, vi.fn())).stdout).toContain("velora frames");
  });
});

describe("shot command", () => {
  it("routes stills with usage guards", async () => {
    const shot = vi.fn().mockResolvedValue(shotOk);
    const deps = (f: unknown) => [ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), f] as never[];
    const result = await runCli(["shot", "--scene", "demo", "--time", "40", "--out", "s.png", "--json"], context, ...deps(shot));
    expect(shot).toHaveBeenCalledWith(
      { scene: "demo", timeMs: 40, out: "s.png" },
      { root: "/project", url: "http://127.0.0.1:5173" },
    );
    expect(envelope(result.stdout)).toMatchObject({ success: true, command: "shot" });
    const bad = await runCli(["shot", "--scene", "demo", "--json"], context, ...deps(vi.fn()));
    expect(bad.code).toBe(2);
    expect(envelope(bad.stderr).issues[0].code).toBe("ERR_MISSING_VALUE");
  });
  it("documents shot in help", async () => {
    expect((await runCli(["shot", "--help"], context, vi.fn())).stdout).toContain("--scene");
    expect((await runCli(["--help"], context, vi.fn())).stdout).toContain("velora shot");
  });
});

describe("check command", () => {
  it("routes evidence targets and prints check tables", async () => {
    const check = vi.fn().mockResolvedValue(checkOk);
    const deps = (f: unknown) => [ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), f] as never[];
    const frames = await runCli(["check", "--frames", "stills", "--budget-ms", "50", "--json"], context, ...deps(check));
    expect(check).toHaveBeenCalledWith({ frames: "stills", budgetMs: 50 }, { root: "/project" });
    expect(envelope(frames.stdout)).toMatchObject({ success: true, command: "check" });
    const video = await runCli(["check", "--video", "t.mp4", "--manifest", "t.manifest.json"], context, ...deps(check));
    expect(check).toHaveBeenCalledWith({ video: "t.mp4", manifest: "t.manifest.json" }, { root: "/project" });
    expect(video.stdout).toContain("no-blank");
    const failed = vi.fn().mockResolvedValue({ success: false, command: "check",
      data: { target: "stills", checks: [{ id: "no-blank", pass: false, detail: "Blank." }] },
      issues: [{ code: "ERR_VISUAL_BLANK", path: "stills", message: "Blank." }] });
    const bad = await runCli(["check", "--frames", "stills", "--json"], context, ...deps(failed));
    expect(bad.code).toBe(1);
    const body = JSON.parse(bad.stderr);
    expect(CheckRenderResultSchema.safeParse(body).success, bad.stderr).toBe(true);
    expect(body.data.checks).toHaveLength(1);
    const human = await runCli(["check", "--frames", "stills"], context, ...deps(failed));
    expect(human.stderr).toContain("no-blank");
    expect(human.stderr).toContain("ERR_VISUAL_BLANK");
  });
  it("rejects ambiguous targets", async () => {
    const check = vi.fn();
    const deps = [ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), ex(), check] as never[];
    for (const args of [["check", "--json"], ["check", "--frames", "a", "--video", "b", "--json"]]) {
      const result = await runCli(args, context, ...deps);
      expect(result.code).toBe(2);
      expect(check).not.toHaveBeenCalled();
    }
  });
  it("documents check in help", async () => {
    expect((await runCli(["check", "--help"], context, vi.fn())).stdout).toContain("--budget-ms");
    expect((await runCli(["--help"], context, vi.fn())).stdout).toContain("velora check");
  });
});
