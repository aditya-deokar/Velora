import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";
import { executeSkillsCommand } from "../../src/project/commands";
import { CliEnvelopeSchema } from "../../src/core/cli-schema";

const context = { root: "/project" };

function envelope(text: string) {
  const parsed = JSON.parse(text);
  expect(CliEnvelopeSchema.safeParse(parsed).success, text).toBe(true);
  return parsed;
}

describe("skills help", () => {
  it.each(["skills", "inspect", "assets"])("%s --help is side-effect free", async (command) => {
    const execute = vi.fn();
    const result = await runCli([command, "--help"], context, execute);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`velora ${command}`);
    expect(result.stdout).toContain("--json");
    expect(execute).not.toHaveBeenCalled();
  });
  it("validate --composition routes to validate-project", async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, data: {} });
    const result = await runCli(["validate", "--composition", "t.composition.json", "--json"], context, execute);
    expect(result.code).toBe(0);
    expect(execute).toHaveBeenCalledWith("validate-project", { composition: "t.composition.json" }, context);
  });
  it("rejects --composition on non-owner commands", async () => {
    const execute = vi.fn();
    const result = await runCli(["sync", "--composition", "t.composition.json", "--json"], context, execute);
    expect(result.code).toBe(2);
    expect(envelope(result.stderr).issues[0].code).toBe("ERR_INVALID_FLAG_COMBINATION");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("skills install round-trip", () => {
  it("installs, lists, checks green and is idempotent", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "velora-skills-"));
    try {
      const dir = path.join(scratch, "agent-skills");
      const installed = await executeSkillsCommand("install-skills", { dir }, { root: scratch, version: "0.1.2" });
      expect(installed.success).toBe(true);
      if (!installed.success) return;
      expect(installed.data.kind).toBe("install");
      if (installed.data.kind !== "install") return;
      expect(installed.data.changed).toBe(true);
      expect(installed.data.installed.length).toBeGreaterThan(15);

      const second = await executeSkillsCommand("install-skills", { dir }, { root: scratch, version: "0.1.2" });
      expect(second.success).toBe(true);
      if (!second.success || second.data.kind !== "install") return;
      expect(second.data.changed).toBe(false);

      const listed = await executeSkillsCommand("list-skills", { dir }, { root: scratch, version: "0.1.2" });
      expect(listed.success).toBe(true);
      if (!listed.success || listed.data.kind !== "list") return;
      expect(listed.data.available.length).toBe(15);
      expect(listed.data.installed.length).toBe(15);
      expect(listed.data.drift).toEqual([]);

      const checked = await executeSkillsCommand("check-skills", { dir }, { root: scratch, version: "0.1.2" });
      expect(checked.success).toBe(true);

      // CLI wrappers agree.
      const ls = await runCli(["skills", "ls", "--dir", dir, "--json"], { root: scratch, terminal: { version: "0.1.2" } as never });
      expect(ls.code).toBe(0);
      expect(envelope(ls.stdout)).toMatchObject({ success: true, command: "skills" });
      const check = await runCli(["skills", "check", "--dir", dir, "--json"], { root: scratch, terminal: { version: "0.1.2" } as never });
      expect(check.code).toBe(0);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);
  it("refuses agent config files and reports conflicts", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "velora-skills-guard-"));
    try {
      const denied = await executeSkillsCommand("install-skills", { dir: path.join(scratch, "AGENTS.md") }, { root: scratch });
      expect(denied.success).toBe(false);
      if (!denied.success) expect(denied.issues[0].code).toMatch(/denied-path|invalid/);

      const dir = path.join(scratch, "skills");
      const first = await executeSkillsCommand("install-skills", { dir }, { root: scratch });
      expect(first.success).toBe(true);
      // Corrupt one installed file to force a conflict on reinstall.
      await writeFile(path.join(dir, "velora/SKILL.md"), "corrupted\n");
      const conflict = await executeSkillsCommand("install-skills", { dir }, { root: scratch });
      expect(conflict.success).toBe(false);
      if (!conflict.success) expect(conflict.issues[0].code).toBe("ERR_SKILL_CONFLICT");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);
  it("check catches broken front-matter with ERR_SKILL_*", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "velora-skills-broken-"));
    try {
      const dir = path.join(scratch, "skills");
      const installed = await executeSkillsCommand("install-skills", { dir }, { root: scratch });
      expect(installed.success).toBe(true);
      await writeFile(path.join(dir, "velora-render/SKILL.md"), "no front-matter here\n");
      const checked = await executeSkillsCommand("check-skills", { dir }, { root: scratch });
      expect(checked.success).toBe(false);
      if (!checked.success) {
        expect(checked.issues.length).toBeGreaterThan(0);
        expect(checked.issues[0].code.startsWith("ERR_SKILL_")).toBe(true);
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);
  it("prints agent snippets without writing config", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "velora-skills-agent-"));
    try {
      const dir = path.join(scratch, "skills");
      const result = await runCli(
        ["skills", "install", "--dir", dir, "--agent", "claude", "--json"],
        { root: scratch, terminal: { version: "0.1.2" } as never },
      );
      expect(result.code).toBe(0);
      const body = envelope(result.stdout);
      expect(body.data.snippet).toContain("Claude Code");
      // No AGENTS.md or CLAUDE.md written.
      await expect(readFile(path.join(scratch, "AGENTS.md"), "utf8")).rejects.toThrow();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("inspect and assets wiring", () => {
  it("inspect reports project without mutation", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "velora-inspect-"));
    try {
      await mkdir(path.join(scratch, "src/velora/scenes"), { recursive: true });
      const result = await runCli(["inspect", "--json"], { root: scratch });
      expect(result.code).toBe(0);
      expect(envelope(result.stdout)).toMatchObject({ success: true, command: "inspect" });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
  it("assets ls and check run against fixtures", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "velora-assets-"));
    try {
      await mkdir(path.join(scratch, "assets"), { recursive: true });
      const ls = await runCli(["assets", "ls", "--json"], { root: scratch });
      expect(ls.code).toBe(0);
      expect(envelope(ls.stdout)).toMatchObject({ success: true, command: "assets" });
      const check = await runCli(["assets", "check", "--json"], { root: scratch });
      expect(check.code).toBe(0);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
