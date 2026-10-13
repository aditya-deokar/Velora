import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/project/commands", () => ({ executeProjectCommand: vi.fn() }));
import { runCli } from "../../src/cli";
import { CLI_ERROR_CODES, CliEnvelopeSchema } from "../../src/core/cli-schema";
import type { ProjectResult } from "../../src/core";

const context = { root: "/project" };
const ready: ProjectResult = { success: true, data: { project: { version: 1, projectId: "00000000-0000-4000-8000-000000000000", entry: "src/main.tsx", packageManager: "npm" } } };

function envelope(text: string) {
  const parsed = JSON.parse(text);
  expect(CliEnvelopeSchema.safeParse(parsed).success, text).toBe(true);
  return parsed;
}

describe("agent-first envelope", () => {
  it.each([
    ["init", "init-project", {}],
    ["open", "open-preview", { url: "http://127.0.0.1:5173", launch: true }],
    ["load", "load-project", {}],
    ["validate", "validate-project", {}],
    ["sync", "sync-project", {}],
  ])("%s --json emits a parseable envelope with its command", async (command, operation, input) => {
    const execute = vi.fn().mockResolvedValue(ready);
    const result = await runCli([command, "--json"], context, execute);
    expect(result.code).toBe(0);
    expect(execute).toHaveBeenCalledWith(operation, input, context);
    expect(envelope(result.stdout)).toMatchObject({ success: true, command });
  });
  it("attaches hints to operational failures without losing codes", async () => {
    const execute = vi.fn().mockResolvedValue({ success: false, issues: [{ code: "missing-dev-server", message: "Run npm run dev." }] });
    const result = await runCli(["open", "--json"], context, execute);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    const body = envelope(result.stderr);
    expect(body.issues[0]).toMatchObject({ code: "missing-dev-server", hint: expect.any(String) });
    expect(body.next.length).toBeGreaterThan(0);
  });
  it("normalizes codeless recipe diagnostics and exporter failures", async () => {
    const recipes = vi.fn().mockResolvedValue({ success: false, issues: [{ path: "sources.0", message: "Bad recipe." }] });
    const load = await runCli(["load", "--scene", "demo", "--json"], context, vi.fn(), vi.fn(), recipes);
    expect(load.code).toBe(1);
    expect(envelope(load.stderr).issues[0]).toMatchObject({ code: expect.any(String), path: "sources.0", hint: expect.any(String) });
    const exporter = vi.fn().mockResolvedValue({ success: false, issues: [{ code: "missing-ffmpeg", message: "Install FFmpeg." }] });
    const exported = await runCli(["export", "--url", "http://127.0.0.1:5173/x", "--output", "clip.mp4", "--json"], context, vi.fn(), exporter);
    expect(exported.code).toBe(1);
    expect(envelope(exported.stderr).issues[0]).toMatchObject({ code: "missing-ffmpeg", hint: expect.any(String) });
  });
  it("keeps internal crashes machine-readable without leaking details", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("secret"));
    const result = await runCli(["validate", "--json"], context, execute);
    expect(result.code).toBe(1);
    const body = envelope(result.stderr);
    expect(body.issues[0].code).toBe("ERR_INTERNAL");
    expect(result.stderr).not.toContain("secret");
  });
});

describe("usage errors", () => {
  it.each([
    [["wat", "--json"], "ERR_UNKNOWN_COMMAND"],
    [["init", "--wat", "--json"], "ERR_UNKNOWN_OPTION"],
    [["init", "--project", "--json"], "ERR_MISSING_VALUE"],
    [["init", "--json", "--json"], "ERR_DUPLICATE_OPTION"],
    [["sync", "--adapter", "react", "--json"], "ERR_INVALID_FLAG_COMBINATION"],
    [["export", "--url", "http://127.0.0.1:1", "--json"], "ERR_MISSING_VALUE"],
    [["snapshot", "--scene", "a", "--json"], "ERR_MISSING_VALUE"],
  ])("%j fails closed with %s", async (args, code) => {
    const execute = vi.fn();
    const result = await runCli(args, context, execute);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    const body = envelope(result.stderr);
    expect(body.issues[0].code).toBe(code);
    expect(CLI_ERROR_CODES).toContain(code);
    expect(execute).not.toHaveBeenCalled();
  });
  it("stays human-readable without --json", async () => {
    const result = await runCli(["wat"], context, vi.fn());
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown command: wat");
    expect(result.stderr).toContain("flute --version");
    expect(() => JSON.parse(result.stderr)).toThrow();
  });
});

describe("discoverability", () => {
  const commands = ["guide", "init", "open", "sync", "scenes", "load", "validate", "snapshot", "export", "doctor"];
  it.each(commands.map((command) => [command]))("%s --help is side-effect free", async (command) => {
    const execute = vi.fn();
    const result = await runCli([command, "--help"], context, execute);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(command === "guide" ? "flute guide" : `flute ${command}`);
    expect(result.stdout).toContain("--json");
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(commands.map((command) => [command]))("help %s prints the same entry", async (command) => {
    const direct = await runCli([command, "--help"], context, vi.fn());
    const viaHelp = await runCli(["help", command], context, vi.fn());
    expect(viaHelp.code).toBe(0);
    expect(viaHelp.stdout).toBe(direct.stdout);
  });
  it("rejects help for unknown commands before executing", async () => {
    const execute = vi.fn();
    expect((await runCli(["wat", "--help"], context, execute)).code).toBe(2);
    expect((await runCli(["help", "wat"], context, execute)).code).toBe(2);
    expect(execute).not.toHaveBeenCalled();
  });
  it("advertises doctor and non-interactive guarantees in top-level help", async () => {
    const help = (await runCli(["--help"], context, vi.fn())).stdout;
    for (const text of ["flute doctor", "flute help", "never", "prompt", "Exit 0"])
      expect(help).toContain(text);
  });
});

describe("non-interactive determinism", () => {
  it("produces byte-stable human and JSON output without a TTY", async () => {
    const execute = vi.fn().mockResolvedValue(ready);
    const env = { root: "/host", terminal: { interactive: false, colorDepth: 0 } };
    const first = await runCli(["init"], env, execute);
    execute.mockClear();
    const second = await runCli(["init"], env, execute);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).not.toContain("\x1b");
    const json = await runCli(["init", "--json"], env, execute);
    expect(json.stdout).not.toContain("\x1b");
    expect(envelope(json.stdout)).toMatchObject({ success: true, command: "init" });
  });
});
