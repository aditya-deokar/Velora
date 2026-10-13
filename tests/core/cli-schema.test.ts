import { describe, expect, it } from "vitest";
import {
  CLI_COMMANDS,
  CLI_COMMAND_NAMES,
  CLI_ERROR_CATALOG,
  CliEnvelopeSchema,
  CommandIndexSchema,
  DoctorResultSchema,
  hintForCode,
  nextForCode,
  nextForIssues,
  normalizeIssue,
} from "../../src/core/cli-schema";

describe("CLI error catalog", () => {
  const required = [
    "ERR_UNKNOWN_COMMAND", "ERR_UNKNOWN_OPTION", "ERR_MISSING_VALUE", "ERR_DUPLICATE_OPTION",
    "ERR_INVALID_PROJECT", "ERR_SCENE_NOT_FOUND", "ERR_SCENE_INVALID", "ERR_BINDING_MISSING",
    "ERR_FOCUS_INVALID", "ERR_DURATION_INVALID", "ERR_FPS_UNSUPPORTED", "ERR_SERVER_UNREACHABLE",
    "ERR_CAPTURE_NO_BRIDGE", "ERR_FFMPEG_MISSING", "ERR_CHROMIUM_MISSING", "ERR_OUTPUT_UNWRITABLE",
    "ERR_SNAPSHOT_STALE", "ERR_INTERNAL",
    "ERR_COMPOSITION_INVALID", "ERR_ASSET_NOT_FOUND", "ERR_ASSET_UNSUPPORTED", "ERR_ASSET_TOO_LARGE",
    "ERR_TIMELINE_INVALID", "ERR_TIMELINE_OVERLAP", "ERR_FRAME_OUT_OF_RANGE",
    "ERR_AUDIO_INVALID", "ERR_AUDIO_CODEC", "ERR_AUDIO_DRIFT",
    "ERR_CAPTION_INVALID", "ERR_CAPTION_OVERLAP", "ERR_CAPTION_TIMING",
    "ERR_TRANSITION_INVALID", "ERR_PROCEDURAL_BUDGET", "ERR_ANIMATION_CLOCK",
    "ERR_WEBGL_CONTEXT", "ERR_WEBGL_TIMELOOP",
  ];
  it.each(required)("pins stable code %s with one hint", (code) => {
    expect(CLI_ERROR_CATALOG[code].hint.length).toBeGreaterThan(0);
    expect(Array.isArray(CLI_ERROR_CATALOG[code].next)).toBe(true);
    expect(CLI_ERROR_CATALOG[code].next.length).toBeLessThanOrEqual(2);
  });
  it("covers every legacy operation code emitted by the command layer", () => {
    for (const code of ["conflict", "missing-dev-server", "missing-installation", "invalid-scene", "missing-ffmpeg", "missing-chromium", "source-changed", "denied-path", "project-error", "not-initialized"])
      expect(CLI_ERROR_CATALOG[code].hint.length).toBeGreaterThan(0);
  });
  it("falls back to ERR_INTERNAL for unknown codes", () => {
    expect(hintForCode("nope")).toBe(CLI_ERROR_CATALOG.ERR_INTERNAL.hint);
    expect(nextForCode("nope")).toEqual(CLI_ERROR_CATALOG.ERR_INTERNAL.next);
    expect(nextForIssues([])).toEqual(CLI_ERROR_CATALOG.ERR_INTERNAL.next);
  });
});

describe("normalizeIssue", () => {
  it("backfills the catalog hint while preserving code/path/message", () => {
    expect(normalizeIssue({ code: "conflict", path: "FLUTE.md", message: "Move it." })).toMatchObject({
      code: "conflict", path: "FLUTE.md", message: "Move it.", hint: expect.any(String),
    });
  });
  it("keeps caller-supplied hints and coerces garbage to ERR_INTERNAL", () => {
    expect(normalizeIssue({ code: "ERR_FFMPEG_MISSING", message: "m", hint: "custom" }).hint).toBe("custom");
    expect(normalizeIssue("boom")).toMatchObject({ code: "ERR_INTERNAL", hint: expect.any(String) });
    expect(normalizeIssue({ path: "x", message: "y" }).code).toBe("ERR_INTERNAL");
  });
});

describe("command index and envelopes", () => {
  it("indexes every agent-facing command with flags, example and skill", () => {
    for (const name of ["guide", "init", "open", "sync", "scenes", "load", "validate", "inspect", "assets", "snapshot", "export", "doctor", "render", "audio", "captions", "transitions", "frames", "shot", "check", "skills"]) {
      expect(CLI_COMMAND_NAMES).toContain(name);
      const entry = CLI_COMMANDS.find((command) => command.name === name)!;
      expect(CommandIndexSchema.safeParse(entry).success).toBe(true);
      expect(entry.flags).toContain("--json");
      expect(entry.skill === "velora" || entry.skill.startsWith("velora-")).toBe(true);
    }
  });
  it("validates representative envelopes", () => {
    expect(CliEnvelopeSchema.safeParse({ success: true, command: "scenes", data: { scenes: [] } }).success).toBe(true);
    expect(CliEnvelopeSchema.safeParse({ success: false, command: "export", issues: [{ code: "ERR_FFMPEG_MISSING", message: "m", hint: "h" }], next: ["velora doctor --json"] }).success).toBe(true);
    expect(CliEnvelopeSchema.safeParse({ success: false, issues: [] }).success).toBe(false);
  });
  it("validates doctor results", () => {
    expect(DoctorResultSchema.safeParse({
      success: true, command: "doctor", data: { checks: [{ id: "node", label: "Node", pass: true }] },
    }).success).toBe(true);
    expect(DoctorResultSchema.safeParse({ success: false, command: "doctor", issues: [{ code: "x", message: "y" }] }).success).toBe(true);
  });
});
