import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../../src/cli";
import { VELORA_SKILL_NAMES } from "../../src/project/skills";

// Every CLI line in a skill's fenced code blocks goes through the real argument parser.
// Managers are replaced by a stub that throws once reached, so nothing touches disk,
// a browser or FFmpeg: reaching a manager proves the documented command and flags parse.
const root = fileURLToPath(new URL("../../", import.meta.url));
const REACHED = "velora-example-reached";
const stub = async () => { throw new Error(REACHED); };

function documentedCommands(text: string): string[][] {
  const commands: string[][] = [];
  // Walk fences line by line: opening fences carry an optional language, closing fences are bare.
  const blocks: string[][] = [];
  let open: { shell: boolean; lines: string[] } | undefined;
  for (const line of text.split(/\r?\n/)) {
    const fence = /^\s*```\s*([a-z]*)/.exec(line);
    if (fence) {
      if (open) { if (open.shell) blocks.push(open.lines); open = undefined; }
      else open = { shell: ["", "bash", "sh", "shell"].includes(fence[1]), lines: [] };
    } else open?.lines.push(line);
  }
  for (const block of blocks) {
    for (const raw of block) {
      const line = raw.trim().replace(/^npx\s+/, "");
      if (!line.startsWith("velora ") || /[<>|]/.test(line) || line.includes("&&")) continue;
      const tokens = [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(match => match[1] ?? match[2] ?? match[3]);
      commands.push(tokens.slice(1));
    }
  }
  return commands;
}

async function parses(args: string[]): Promise<{ code: number | "reached"; stderr: string }> {
  const managers = Array.from({ length: 18 }, () => stub) as never[];
  try {
    const result = await (runCli as (...all: unknown[]) => Promise<{ code: number; stderr: string }>)(args, { root: path.join(root, ".does-not-exist") }, ...managers);
    return { code: result.code, stderr: result.stderr };
  } catch (error) {
    if (error instanceof Error && error.message === REACHED) return { code: "reached", stderr: "" };
    throw error;
  }
}

describe("skill code examples run through the real CLI parser", () => {
  it.each(VELORA_SKILL_NAMES.map(name => [name]))("%s", async name => {
    const text = await readFile(path.join(root, "skills", name, "SKILL.md"), "utf8");
    for (const args of documentedCommands(text)) {
      const result = await parses(args);
      expect(result.code, `velora ${args.join(" ")}\n${result.stderr.slice(0, 400)}`).not.toBe(2);
    }
  });
  it.each([["README.md"], ["USER_GUIDE.md"]])("%s", async file => {
    const text = await readFile(path.join(root, file), "utf8");
    const commands = documentedCommands(text);
    expect(commands.length).toBeGreaterThan(5);
    for (const args of commands) {
      const result = await parses(args);
      expect(result.code, `velora ${args.join(" ")}\n${result.stderr.slice(0, 400)}`).not.toBe(2);
    }
  });
  it("covers a meaningful share of the documented commands", async () => {
    let total = 0;
    for (const name of VELORA_SKILL_NAMES) total += documentedCommands(await readFile(path.join(root, "skills", name, "SKILL.md"), "utf8")).length;
    expect(total).toBeGreaterThanOrEqual(60);
  });
  it("still rejects a malformed command (the gate can fail)", async () => {
    expect((await parses(["render", "--composition", "x.json", "--bogus", "--json"])).code).toBe(2);
  });
});
