import { describe, expect, it } from "vitest";
import { PROMPT_LIBRARY, PromptSchema, fillPrompt, findPrompt, promptPlaceholders, scaffoldPrompt } from "../../src/core/prompts";
import { BLUEPRINT_CATALOG, TEMPLATE_CATALOG } from "../../src/core/templates";
import { CLI_COMMANDS } from "../../src/core/cli-schema";
import { DELIVERY_PRESETS } from "../../src/core/delivery";
import { VELORA_SKILL_NAMES, extractCommandRefs } from "../../src/project/skills";
import { runCli } from "../../src/cli";

const catalog = new Set([...TEMPLATE_CATALOG.map(entry => entry.id), ...BLUEPRINT_CATALOG.map(entry => entry.id)]);

describe("prompt library", () => {
  it("has unique, schema-valid entries covering the launch intents", () => {
    const ids = PROMPT_LIBRARY.map(prompt => prompt.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const prompt of PROMPT_LIBRARY) expect(PromptSchema.safeParse(prompt).success).toBe(true);
    for (const id of ["launch-film", "feature-announcement", "website-hero-loop", "vertical-teaser", "dashboard-cinematic", "changelog-video", "product-hunt-assets"])
      expect(findPrompt(id), id).toBeDefined();
    for (const id of ["edit-with-agent", "polish-easing", "stagger-entrances", "rack-focus", "promote-layer", "recut-to-beats"])
      expect(findPrompt(id), id).toBeDefined();
    expect(PROMPT_LIBRARY.filter(prompt => prompt.featured).length).toBeGreaterThanOrEqual(3);
    expect(Object.isFrozen(PROMPT_LIBRARY)).toBe(true);
  });
  it.each(PROMPT_LIBRARY.map(prompt => [prompt.id, prompt]))("%s names real templates, skills, commands, flags and presets", (_id, prompt) => {
    for (const template of prompt.templates) expect(catalog.has(template), template).toBe(true);
    for (const skill of prompt.skills) expect(VELORA_SKILL_NAMES as readonly string[]).toContain(skill);
    expect(prompt.skills.length).toBeLessThanOrEqual(4);
    const commands = new Map(CLI_COMMANDS.map(command => [command.name, command]));
    for (const ref of extractCommandRefs(prompt.text)) {
      const command = commands.get(ref.command);
      expect(command, `velora ${ref.command}`).toBeDefined();
      for (const flag of ref.flags) expect(command!.flags, `velora ${ref.command} ${flag}`).toContain(flag);
    }
    for (const preset of prompt.text.matchAll(/--preset ([a-z0-9-]+)/g)) expect(DELIVERY_PRESETS.map(entry => entry.id)).toContain(preset[1]);
    // Every template the prompt scaffolds by name is one it declares.
    for (const named of prompt.text.matchAll(/--(?:template|blueprint) ([a-z0-9-]+)/g)) expect(prompt.templates).toContain(named[1]);
  });
  it("lists and fills placeholders, leaving unknown ones for the person", () => {
    const prompt = findPrompt("launch-film")!;
    expect(promptPlaceholders(prompt.text)).toEqual(expect.arrayContaining(["product", "audience", "single message", "cta"]));
    expect(promptPlaceholders("<video autoplay> <route>")).toEqual(["route"]);
    const filled = fillPrompt(prompt, { product: "Fieldnote", cta: "Start free" });
    expect(filled).toContain("for Fieldnote,");
    expect(filled).toContain("\"Start free\"");
    expect(filled).toContain("<audience>");
  });
  it("builds the studio's template prompt around the exact scaffold command", () => {
    const text = scaffoldPrompt({ id: "hero-push", title: "The precise push" }, "velora new scene --template hero-push --id hero --route /");
    expect(text).toContain('"hero-push" template (The precise push): run velora new scene --template hero-push --id hero --route /.');
    expect(text).toContain("velora shot");
  });
});

describe("velora prompts", () => {
  it("lists the library as JSON and text", async () => {
    const json = await runCli(["prompts", "ls", "--json"], { root: "/x" });
    expect(json.code).toBe(0);
    const body = JSON.parse(json.stdout);
    expect(body).toMatchObject({ success: true, command: "prompts" });
    expect(body.data.prompts.map((prompt: { id: string }) => prompt.id)).toEqual(PROMPT_LIBRARY.map(prompt => prompt.id));
    expect(body.data.prompts[0].text).toBeUndefined();
    const text = await runCli(["prompts", "ls"], { root: "/x" });
    expect(text.stdout.split("\n")[0]).toBe(`launch-film\t${PROMPT_LIBRARY[0].title}\t${PROMPT_LIBRARY[0].intent}`);
  });
  it("shows one prompt with its placeholders", async () => {
    const result = await runCli(["prompts", "show", "--id", "vertical-teaser", "--json"], { root: "/x" });
    expect(result.code).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.data).toMatchObject({ id: "vertical-teaser", text: findPrompt("vertical-teaser")!.text });
    expect(body.data.placeholders).toContain("platform");
    expect((await runCli(["prompts", "show", "--id", "vertical-teaser"], { root: "/x" })).stdout).toContain(findPrompt("vertical-teaser")!.text);
  });
  it("reports unknown prompts and usage errors with stable codes", async () => {
    const missing = await runCli(["prompts", "show", "--id", "nope", "--json"], { root: "/x" });
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stderr || missing.stdout).issues[0].code).toBe("ERR_PROMPT_NOT_FOUND");
    for (const args of [["prompts"], ["prompts", "run"], ["prompts", "show"], ["prompts", "ls", "--id", "x"], ["prompts", "show", "--id"], ["prompts", "ls", "--json", "--json"]])
      expect((await runCli(args, { root: "/x" })).code, args.join(" ")).toBe(2);
    expect((await runCli(["prompts", "--help"], { root: "/x" })).stdout).toContain("velora prompts show --id ID");
  });
});
