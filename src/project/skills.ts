import { z } from "zod";
import { CLI_COMMANDS } from "../core/cli-schema";

/** SOURCE OF TRUTH: skill front-matter contracts and content validators.
 * WHAT: schemas plus pure parsing/validation for Velora skill files.
 * WHY: `skills check`, the lint script and the content tests share one contract.
 * WHERE: project/commands executes install/ls/check through these validators.
 * Layer note (projectAdapter): zod + core only. No filesystem, no processes;
 * services owns all effects. Version equality with package.json is enforced
 * by tests (which can read it), not here: runtime checks semver shape plus
 * installed-vs-source drift.
 */
export const VELORA_SKILL_NAMES = Object.freeze([
  "velora", "velora-init", "velora-composition", "velora-scenes", "velora-render",
  "velora-gsap", "velora-threejs", "velora-ewmotion", "velora-typography",
  "velora-transitions", "velora-audio", "velora-export", "velora-debug",
  "velora-performance", "velora-verify", "velora-templates", "velora-cinematography",
  "velora-brand", "velora-looks", "velora-motion-design", "velora-editing", "velora-launch", "velora-editor",
]);
export const REQUIRED_SKILL_SECTIONS = Object.freeze([
  "## When to Use This Skill",
  "## Commands",
  "## Prerequisites",
  "## Workflow",
  "## Worked Example",
  "## Anti-Patterns",
  "## Troubleshooting",
  "## Validation",
  "## Related Skills",
  "## When NOT to Use This Skill",
]);
const semver = /^\d+\.\d+\.\d+$/;
export const SkillFrontmatterSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(10),
  license: z.string().min(1),
  version: z.string().regex(semver, "Pin the CLI version this skill was written against as X.Y.Z."),
  "when-to-use": z.string().min(10),
  prerequisites: z.array(z.string()).default([]),
  commands: z.array(z.string().min(1)).min(1),
  "related-skills": z.array(z.string()).default([]),
  "not-for": z.string().min(10),
});
export type SkillFrontmatter = z.output<typeof SkillFrontmatterSchema>;
export type SkillIssue = { code: string; path: string; message: string };

// Minimal front-matter parser: `key: value`, `key: [a, b]`, and `key:`
// followed by `- item` lines. Anything else is a hard invalid error.
export function parseSkillFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } | { issues: SkillIssue[] } {
  // Windows checkouts (core.autocrlf) carry CRLF; the contract is line-ending agnostic.
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---")
    return { issues: [{ code: "ERR_SKILL_INVALID", path: "SKILL.md:1", message: "Skill files start with a --- front-matter block." }] };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0)
    return { issues: [{ code: "ERR_SKILL_INVALID", path: "SKILL.md", message: "Front-matter block never closes with ---." }] };
  const frontmatter: Record<string, unknown> = {};
  const issues: SkillIssue[] = [];
  let current: string | null = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (/^\s*-\s+/.test(line) && current) {
      const list = frontmatter[current];
      if (Array.isArray(list)) list.push(line.replace(/^\s*-\s+/, "").trim());
      else issues.push({ code: "ERR_SKILL_INVALID", path: `SKILL.md:${i + 1}`, message: `List item without a list key.` });
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      if (line.trim() !== "") issues.push({ code: "ERR_SKILL_INVALID", path: `SKILL.md:${i + 1}`, message: `Unparseable front-matter line.` });
      current = null;
      continue;
    }
    current = match[1];
    const value = match[2].trim();
    if (value === "") frontmatter[current] = [];
    else if (value.startsWith("[") && value.endsWith("]"))
      frontmatter[current] = value.slice(1, -1).split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    else frontmatter[current] = value.replace(/^"(.*)"$/, "$1");
  }
  if (issues.length) return { issues };
  return { frontmatter, body: lines.slice(end + 1).join("\n") };
}
// Extract `velora <command> [--flag ...]` references from prose for
// validation against the real command index. Placeholders (<id>, FILE) and
// trailing prose are ignored; only command + --flag tokens are checked.
export function extractCommandRefs(body: string): { command: string; flags: string[] }[] {
  const refs: { command: string; flags: string[] }[] = [];
  const pattern = /(?:npx\s+)?velora\s+([a-z-]+)((?:\s+--[a-z-]+(?:=[^\s`'"]+)?)*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const flags = [...match[2].matchAll(/--([a-z-]+)/g)].map((m) => `--${m[1]}`);
    refs.push({ command: match[1], flags });
  }
  return refs;
}
// Full content validation: front-matter contract, required sections, skill
// cross-links and command/flag references against the real CLI index.
export function validateSkillContent(
  name: string,
  text: string,
  knownSkills: readonly string[] = VELORA_SKILL_NAMES,
): { frontmatter: SkillFrontmatter; issues: SkillIssue[] } {
  const issues: SkillIssue[] = [];
  const parsed = parseSkillFrontmatter(text);
  if ("issues" in parsed) return { frontmatter: {} as SkillFrontmatter, issues: parsed.issues };
  const checked = SkillFrontmatterSchema.safeParse(parsed.frontmatter);
  if (!checked.success) {
    issues.push(...checked.error.issues.map((issue) => ({
      code: "ERR_SKILL_INVALID",
      path: `SKILL.md:${String(issue.path[0] ?? "frontmatter")}`,
      message: issue.message,
    })));
  }
  const frontmatter = (checked.success ? checked.data : {}) as SkillFrontmatter;
  if (checked.success && frontmatter.name !== name)
    issues.push({ code: "ERR_SKILL_INVALID", path: "SKILL.md:name", message: `Directory is ${name} but front-matter names ${frontmatter.name}.` });
  for (const section of REQUIRED_SKILL_SECTIONS) {
    if (!parsed.body.split("\n").some((line) => line.trim() === section))
      issues.push({ code: "ERR_SKILL_INVALID", path: "SKILL.md", message: `Missing required section "${section}".` });
  }
  const related = Array.isArray(parsed.frontmatter["related-skills"]) ? (parsed.frontmatter["related-skills"] as unknown[]) : [];
  for (const skill of related) {
    if (typeof skill !== "string" || !knownSkills.includes(skill))
      issues.push({ code: "ERR_SKILL_INVALID", path: "SKILL.md:related-skills", message: `Unknown related skill "${String(skill)}".` });
  }
  const byName = new Map(CLI_COMMANDS.map((command) => [command.name, command]));
  for (const ref of extractCommandRefs(parsed.body)) {
    const entry = byName.get(ref.command);
    if (!entry) {
      issues.push({ code: "ERR_SKILL_INVALID", path: "SKILL.md", message: `Unknown command "velora ${ref.command}". Document only real commands.` });
      continue;
    }
    for (const flag of ref.flags) {
      if (!entry.flags.includes(flag))
        issues.push({ code: "ERR_SKILL_INVALID", path: "SKILL.md", message: `"velora ${ref.command} ${flag}" documents an unknown flag. See velora ${ref.command} --help.` });
    }
  }
  return { frontmatter, issues };
}
export const AGENT_NAMES = ["claude", "codex", "cursor", "generic"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
// Registration snippets point at the installed directory without asserting
// agent config filenames this repo cannot verify. Agents confirm their own
// loader paths; the snippet tells them exactly what to register and how to
// verify it.
export function agentSnippet(agent: AgentName, dir: string): string {
  const verify = `velora skills check --dir ${dir} --json`;
  const shared = [
    `Register this directory as a skill library: ${dir}`,
    `Each skill is <name>/SKILL.md (start with velora/SKILL.md).`,
    `Verify with: ${verify}`,
  ];
  switch (agent) {
    case "claude":
      return ["For Claude Code, add the directory above as a skill source (for example a repo-local .claude/skills entry or your user skill directory), then restart the session.", ...shared].join("\n");
    case "codex":
      return ["For Codex, add the directory above to the agent's skill search paths in its configuration, then start a new session.", ...shared].join("\n");
    case "cursor":
      return ["For Cursor, add the directory above to the agent's skill configuration, then start a new session.", ...shared].join("\n");
    default:
      return ["For any skill-compatible coding agent, expose the directory above as skills and load velora/SKILL.md first.", ...shared].join("\n");
  }
}
