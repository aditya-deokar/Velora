import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkillContent, VELORA_SKILL_NAMES } from "../../src/project/skills";
import { CompositionSchema } from "../../src/core/composition";
import { SceneRecipeSchema } from "../../src/core/recipes";
import { parseCaptions } from "../../src/core/captions";

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
