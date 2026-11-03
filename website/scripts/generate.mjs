// Generates the docs site's data from the shipped sources of truth, so the website never drifts:
// CLI reference (CLI_COMMANDS + help text), JSON Schemas, template/blueprint catalog, prompts, delivery presets,
// skills (descriptions and Craft Notes) and the recorded agent-demo evidence (images copied into public/media).
// Run after `npm run build` in the repository root.
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const website = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(website);
const library = await import(pathToFileURL(path.join(repo, "dist", "library", "index.js")).href);
const help = {};
for (const command of library.CLI_COMMANDS) {
  const result = spawnSync(process.execPath, [path.join(repo, "dist", "cli", "velora.js"), command.name, "--help"], { cwd: repo, encoding: "utf8" });
  help[command.name] = (result.stdout ?? "").replace(/^Velora by [^\n]*\n[^\n]*\n\n?/, "").trim();
}
const schemas = {};
for (const file of await readdir(path.join(repo, "schemas"))) schemas[file.replace(/\.schema\.json$/, "")] = JSON.parse(await readFile(path.join(repo, "schemas", file), "utf8"));

const skills = [];
for (const dir of (await readdir(path.join(repo, "skills"))).filter((name) => name === "velora" || name.startsWith("velora-")).sort()) {
  const text = (await readFile(path.join(repo, "skills", dir, "SKILL.md"), "utf8")).replace(/\r\n/g, "\n");
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const field = (name) => new RegExp(`^${name}: (.*)$`, "m").exec(front)?.[1] ?? "";
  const craft = /## Craft Notes\n([\s\S]*?)\n## /.exec(text)?.[1].trim();
  skills.push({ name: dir, description: field("description"), whenToUse: field("when-to-use"), notFor: field("not-for"), ...(craft ? { craftNotes: craft } : {}) });
}

// Recorded evidence from the agent demos (real runs; see tests/agent/*/issue-fix-log.md).
const evidence = [
  { demo: "demo-c", file: "evidence-contact-sheet.png", title: "Launch film storyboard", caption: "30 s launch-film-30s draft: hook title, oblique real-UI shots with karaoke captions, device reveal, stats, end card." },
  { demo: "demo-e", file: "evidence-contact-sheet.png", title: "Vertical teaser storyboard", caption: "9:16 social-teaser-9x16 for TikTok: countdown hook, beat-snapped cuts, karaoke captions." },
  { demo: "demo-d", file: "evidence-anchor.png", title: "Website hero loop", caption: "float-loop of a real route at 4 s, delivered as WebM, MP4 and poster." },
];
await mkdir(path.join(website, "public", "media", "evidence"), { recursive: true });
const shots = [];
for (const item of evidence) {
  const source = path.join(repo, "tests", "agent", item.demo, item.file);
  if (!existsSync(source)) continue;
  const name = `${item.demo}-${item.file}`;
  await copyFile(source, path.join(website, "public", "media", "evidence", name));
  shots.push({ ...item, src: `media/evidence/${name}` });
}
const demos = [];
for (const demo of ["demo-c", "demo-d", "demo-e"]) {
  const dir = path.join(repo, "tests", "agent", demo);
  if (!existsSync(dir)) continue;
  const transcript = JSON.parse(await readFile(path.join(dir, "transcript.json"), "utf8"));
  demos.push({
    demo, agent: transcript.agent ?? "",
    prompt: (await readFile(path.join(dir, "prompt.md"), "utf8")).replace(/\r\n/g, "\n"),
    steps: transcript.steps.map((step) => ({ skill: step.skill, cmd: `velora ${step.cmd.join(" ")}`, replayable: step.replayable, note: step.note ?? "" })),
    fixes: (await readFile(path.join(dir, "issue-fix-log.md"), "utf8")).replace(/\r\n/g, "\n"),
  });
}
const hero = existsSync(path.join(website, "public", "media", "hero", "deliverables.json"))
  ? JSON.parse(await readFile(path.join(website, "public", "media", "hero", "deliverables.json"), "utf8")) : undefined;

const pkg = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8"));
const site = {
  version: pkg.version, packageName: pkg.name,
  commands: library.CLI_COMMANDS.map((command) => ({ ...command, help: help[command.name] ?? "" })),
  templates: library.TEMPLATE_CATALOG.map(({ id, title, summary, category, tags, aspects, params }) => ({ id, title, summary, category, tags, aspects, params: params.map((param) => param.name) })),
  blueprints: library.BLUEPRINT_CATALOG.map(({ id, title, summary, aspects, scenes }) => ({ id, title, summary, aspects, scenes: scenes.map((scene) => scene.template) })),
  prompts: library.PROMPT_LIBRARY,
  presets: library.DELIVERY_PRESETS,
  deliverTargets: Object.entries(library.DELIVER_TARGETS).map(([name, entry]) => ({ name, ...entry })),
  transitions: library.TRANSITION_CATALOG.map(({ type, mode, description }) => ({ type, mode, description })),
  schemas, skills, shots, demos, hero: hero ? { files: hero.targets.flatMap((target) => target.files.map((file) => ({ path: file.path, role: file.role, bytes: file.bytes, sha256: file.sha256 }))), createdAt: hero.createdAt } : null,
};
await mkdir(path.join(website, "src", "generated"), { recursive: true });
await writeFile(path.join(website, "src", "generated", "site.json"), JSON.stringify(site, null, 1) + "\n");
console.log(`website: ${site.commands.length} commands, ${site.templates.length} templates, ${site.blueprints.length} blueprints, ${Object.keys(schemas).length} schemas, ${skills.length} skills, ${shots.length} evidence images${hero ? ", hero video" : ""}.`);
