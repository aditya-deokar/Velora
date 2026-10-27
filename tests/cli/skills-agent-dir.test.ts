import { afterEach, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";

// --agent claude|generic installs into the agent's conventional project directory without --dir.
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it.each([["claude", ".claude/skills"], ["generic", ".agents/skills"]])("installs for %s into %s", async (agent, dir) => {
  const root = await mkdtemp(path.join(tmpdir(), "velora-skills-agent-"));
  roots.push(root);
  const result = await runCli(["skills", "install", "--agent", agent, "--json"], { root });
  expect(result.code, result.stderr).toBe(0);
  const installed = await readdir(path.join(root, dir));
  expect(installed).toEqual(expect.arrayContaining(["velora", "velora-templates", "velora-cinematography"]));
}, 60_000);
it("still requires --dir for agents without a verified convention", async () => {
  const result = await runCli(["skills", "install", "--agent", "cursor", "--json"], { root: tmpdir() });
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stderr).issues[0].code).toBe("ERR_MISSING_VALUE");
});
