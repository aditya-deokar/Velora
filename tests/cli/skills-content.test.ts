import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkillContent, VELORA_SKILL_NAMES } from "../../src/project/skills";
import { CompositionSchema } from "../../src/core/composition";
import { SceneRecipeSchema } from "../../src/core/recipes";
import { parseCaptions } from "../../src/core/captions";
import { CLI_COMMANDS, CLI_ERROR_CATALOG } from "../../src/core/cli-schema";

const root = fileURLToPath(new URL("../../", import.meta.url));

describe("skill content contract", () => {
  it.each(VELORA_SKILL_NAMES.map((n) => [n]))("%s meets front-matter, sections, and cross-link contract", async (name) => {
    const rel = name === "velora" ? "velora/SKILL.md" : `${name}/SKILL.md`;
    const text = await readFile(path.join(root, "skills", rel), "utf8");
    const { frontmatter, issues } = validateSkillContent(name, text);
    expect(issues, `${rel}: ${JSON.stringify(issues)}`).toEqual([]);
    expect(frontmatter.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("root stays under the line budget and routes every command", async () => {
    const text = await readFile(path.join(root, "skills/velora/SKILL.md"), "utf8");
    expect(text.split("\n").length).toBeLessThan(500);
    for (const cmd of ["doctor", "inspect", "validate", "render", "frames", "check", "skills"]) {
      expect(text).toContain(`velora ${cmd}`);
    }
  });
});

describe("director skills v2", () => {
  const read = (name: string) => readFile(path.join(root, "skills", name, "SKILL.md"), "utf8");
  it("routes every intent to installed skills, at most four per intent", async () => {
    const text = await read("velora");
    const router = text.slice(text.indexOf("### Intent router"), text.indexOf("Narrower needs"));
    const rows = router.split("\n").filter(line => line.startsWith("| ") && !line.startsWith("| Intent") && !line.startsWith("|---"));
    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const row of rows) {
      const chain = row.split("|")[2];
      const skills = [...chain.matchAll(/`(velora[a-z-]*)`/g)].map(match => match[1]);
      expect(skills.length, row).toBeGreaterThan(0);
      expect(skills.length, row).toBeLessThanOrEqual(4);
      for (const skill of skills) expect(VELORA_SKILL_NAMES as readonly string[], row).toContain(skill);
    }
    for (const intent of ["Launch film", "cinematic", "Website hero", "Vertical", "bespoke", "Titles"]) expect(router).toContain(intent);
    // Every skill except the router is reachable from it.
    for (const name of VELORA_SKILL_NAMES.filter(name => name !== "velora")) expect(text, name).toContain(`\`${name}\``);
  });
  it("documents the director's workflow from brief to delivery", async () => {
    for (const name of ["velora", "velora-launch"]) {
      const text = (await read(name)).toLowerCase();
      for (const step of ["brief", "shot list", "storyboard", "draft", "review", "master", "deliver"]) expect(text, `${name}: ${step}`).toContain(step);
    }
  });
  it("lists only real commands in every skill's front-matter", async () => {
    const names = new Set(CLI_COMMANDS.map(command => command.name));
    for (const name of VELORA_SKILL_NAMES) {
      const { frontmatter } = validateSkillContent(name, await read(name));
      for (const command of frontmatter.commands) expect(names.has(command) || command === "guide", `${name}: ${command}`).toBe(true);
    }
  });
  it.each(["velora-cinematography", "velora-editing", "velora-motion-design", "velora-brand", "velora-looks", "velora-templates", "velora-launch"])("%s has descriptive Craft Notes and links its craft neighbours", async name => {
    const text = await read(name);
    const notes = text.slice(text.indexOf("## Craft Notes"), text.indexOf("## Related Skills"));
    expect(text).toContain("## Craft Notes");
    expect(notes.length).toBeGreaterThan(200);
    expect(notes).not.toMatch(/in the style of|endorse|approved by|as \w+ would/i);
    const { frontmatter } = validateSkillContent(name, text);
    const craft = ["velora-cinematography", "velora-editing", "velora-motion-design", "velora-brand", "velora-looks", "velora-launch"].filter(other => other !== name);
    expect(craft.filter(other => frontmatter["related-skills"].includes(other)).length, name).toBeGreaterThanOrEqual(2);
  });
  it("documents every catalogued error code in the reference", async () => {
    const text = await readFile(path.join(root, "skills/velora/REFERENCE.md"), "utf8");
    // Stable codes; legacy lowercase codes are covered by the reference's fallback row.
    for (const code of Object.keys(CLI_ERROR_CATALOG).filter(code => /^(ERR|WARN|ADV)_/.test(code))) expect(text, code).toContain(`\`${code}\``);
  });
  it("keeps the reference flag matrix in step with the command index", async () => {
    const text = await readFile(path.join(root, "skills/velora/REFERENCE.md"), "utf8");
    for (const command of CLI_COMMANDS) {
      const row = text.split("\n").find(line => line.startsWith(`| \`${command.name}\` |`));
      expect(row, command.name).toBeDefined();
      for (const flag of command.flags) expect(row, `${command.name} ${flag}`).toContain(`\`${flag}\``);
    }
  });
});

describe("templates are tested fixtures", () => {
  it("scene-minimal recipe validates", async () => {
    const doc = JSON.parse(await readFile(path.join(root, "skills/velora/templates/scene-minimal/minimal.scene.json"), "utf8"));
    expect(SceneRecipeSchema.safeParse(doc).success).toBe(true);
    const tsx = await readFile(path.join(root, "skills/velora/templates/scene-minimal/minimal.tsx"), "utf8");
    expect(tsx).toContain("Surface");
  });
  it("composition-three-act parses", async () => {
    const doc = JSON.parse(await readFile(path.join(root, "skills/velora/templates/composition-three-act/three-act.composition.json"), "utf8"));
    expect(CompositionSchema.safeParse(doc).success).toBe(true);
  });
  it("kinetic-title recipe validates", async () => {
    const doc = JSON.parse(await readFile(path.join(root, "skills/velora/templates/kinetic-title/title.scene.json"), "utf8"));
    expect(SceneRecipeSchema.safeParse(doc).success).toBe(true);
  });
  it("product-survey recipe validates", async () => {
    const doc = JSON.parse(await readFile(path.join(root, "skills/velora/templates/product-survey/survey.scene.json"), "utf8"));
    expect(SceneRecipeSchema.safeParse(doc).success).toBe(true);
  });
  it("audio-captioned captions parse and composition references them", async () => {
    const srt = await readFile(path.join(root, "skills/velora/templates/audio-captioned/subs.srt"), "utf8");
    expect("issues" in parseCaptions(srt, "srt")).toBe(false);
    const doc = JSON.parse(await readFile(path.join(root, "skills/velora/templates/audio-captioned/captioned.composition.json"), "utf8"));
    expect(CompositionSchema.safeParse(doc).success).toBe(true);
    expect(doc.captions.file).toBe("subs.srt");
  });
  it("webgl-stage stub is time-disciplined", async () => {
    const tsx = await readFile(path.join(root, "skills/velora/templates/webgl-stage/stage.tsx"), "utf8");
    expect(tsx).toContain("timeMs");
    expect(tsx).not.toMatch(/requestAnimationFrame/);
    const doc = JSON.parse(await readFile(path.join(root, "skills/velora/templates/webgl-stage/stage.scene.json"), "utf8"));
    expect(SceneRecipeSchema.safeParse(doc).success).toBe(true);
  });
  it("every template has a README", async () => {
    const base = path.join(root, "skills/velora/templates");
    for (const dir of await readdir(base)) {
      const files = await readdir(path.join(base, dir));
      expect(files.some((f) => f.toLowerCase() === "readme.md"), dir).toBe(true);
    }
  });
});
