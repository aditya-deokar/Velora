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
const audioOk = { success: true, command: "audio", data: { composition: "t.composition.json", fps: 30, tracks: [], driftBudgetMs: 40, placementErrorMs: 0 } };
const captionsOk = { success: true, command: "captions", data: { file: "s.srt", kind: "srt", cues: [] } };

describe("audio command", () => {
  const ex = () => vi.fn();
  it("routes ls and check through the audio manager", async () => {
    const manager = vi.fn().mockResolvedValue(audioOk);
    const ls = await runCli(["audio", "ls", "--composition", "t.composition.json", "--json"], context, ex(), ex(), ex(), ex(), ex(), ex(), manager);
    expect(manager).toHaveBeenCalledWith("list-audio", { composition: "t.composition.json" }, context);
    expect(ls.code).toBe(0);
    expect(envelope(ls.stdout)).toMatchObject({ success: true, command: "audio" });
    const check = await runCli(["audio", "check", "--composition", "t.composition.json"], context, ex(), ex(), ex(), ex(), ex(), ex(), manager);
    expect(manager).toHaveBeenCalledWith("check-audio", { composition: "t.composition.json" }, context);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("Audio:");
  });
  it("normalizes audio failures with hints", async () => {
    const manager = vi.fn().mockResolvedValue({ success: false, command: "audio", issues: [{ code: "ERR_ASSET_NOT_FOUND", path: "audio.0.assetId", message: "Missing." }], next: ["velora assets ls --json"] });
    const result = await runCli(["audio", "check", "--composition", "t.composition.json", "--json"], context, ex(), ex(), ex(), ex(), ex(), ex(), manager);
    expect(result.code).toBe(1);
    expect(envelope(result.stderr).issues[0]).toMatchObject({ code: "ERR_ASSET_NOT_FOUND", hint: expect.any(String) });
  });
  it.each([
    ["audio", "--json"],
    ["audio", "play", "--composition", "t.composition.json", "--json"],
    ["audio", "ls", "--json"],
    ["audio", "check", "--composition", "t.composition.json", "--wat", "--json"],
  ])("rejects malformed %j before managing", async (...args) => {
    const manager = vi.fn();
    const ex = () => vi.fn();
    const result = await runCli(args, context, ex(), ex(), ex(), ex(), ex(), ex(), manager);
    expect(result.code).toBe(2);
    expect(manager).not.toHaveBeenCalled();
    expect(envelope(result.stderr).issues[0].code).toMatch(/ERR_(MISSING_VALUE|UNKNOWN_COMMAND|UNKNOWN_OPTION)/);
  });
  it("documents audio in help", async () => {
    const help = await runCli(["audio", "--help"], context, vi.fn());
    expect(help.stdout).toContain("audio check");
    expect((await runCli(["help", "audio"], context, vi.fn())).stdout).toBe(help.stdout);
  });
});

describe("captions command", () => {
  const ex = () => vi.fn();
  it("routes validate and check through the captions manager", async () => {
    const manager = vi.fn().mockResolvedValue(captionsOk);
    const validated = await runCli(["captions", "validate", "--file", "s.srt", "--json"], context, ex(), ex(), ex(), ex(), ex(), ex(), ex(), manager);
    expect(manager).toHaveBeenCalledWith("validate-captions", { file: "s.srt" }, context);
    expect(envelope(validated.stdout)).toMatchObject({ success: true, command: "captions" });
    const checked = await runCli(["captions", "check", "--composition", "t.composition.json"], context, ex(), ex(), ex(), ex(), ex(), ex(), ex(), manager);
    expect(manager).toHaveBeenCalledWith("check-captions", { composition: "t.composition.json" }, context);
    expect(checked.stdout).toContain("Captions:");
  });
  it.each([
    ["captions", "--json"],
    ["captions", "validate", "--json"],
    ["captions", "check", "--json"],
    ["captions", "validate", "--file", "s.srt", "--composition", "t.composition.json", "--json"],
  ])("rejects malformed %j before managing", async (...args) => {
    const manager = vi.fn();
    const ex = () => vi.fn();
    const result = await runCli(["captions", ...args.slice(1)], context, ex(), ex(), ex(), ex(), ex(), ex(), ex(), manager);
    expect(result.code).toBe(2);
    expect(manager).not.toHaveBeenCalled();
  });
  it("documents captions in help", async () => {
    const help = await runCli(["captions", "--help"], context, vi.fn());
    expect(help.stdout).toContain("captions check");
    expect((await runCli(["help", "captions"], context, vi.fn())).stdout).toBe(help.stdout);
  });
});

describe("export media flags", () => {
  it("passes --audio and --captions through to the exporter", async () => {
    const exporter = vi.fn().mockResolvedValue({ success: true, data: { output: "c.mp4", fps: 30, frames: 3, durationMs: 100, audio: { file: "a.wav", codec: "pcm_s16le", driftMs: 0, peakDb: -6 }, captions: { file: "s.srt", cues: 2, burnIn: true } } });
    const result = await runCli(["export", "--url", "http://127.0.0.1:5173/x", "--output", "c.mp4", "--audio", "a.wav", "--captions", "s.srt", "--json"], context, vi.fn(), exporter);
    expect(exporter).toHaveBeenCalledWith({ url: "http://127.0.0.1:5173/x", output: "c.mp4", audio: "a.wav", captions: "s.srt" }, context);
    expect(result.code).toBe(0);
    expect(envelope(result.stdout).data).toMatchObject({ audio: { driftMs: 0 }, captions: { cues: 2, burnIn: true } });
    const human = await runCli(["export", "--url", "http://127.0.0.1:5173/x", "--output", "c.mp4", "--audio", "a.wav", "--captions", "s.srt"], context, vi.fn(), exporter);
    expect(human.stdout).toContain("drift 0ms");
    expect(human.stdout).toContain("2 cues burned");
  });
  it("lists media flags in help", async () => {
    expect((await runCli(["export", "--help"], context, vi.fn())).stdout).toContain("--captions");
    expect((await runCli(["--help"], context, vi.fn())).stdout).toContain("velora captions");
  });
});
