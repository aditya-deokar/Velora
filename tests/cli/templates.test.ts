import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli";
import { CliEnvelopeSchema } from "../../src/core/cli-schema";
import type { executeTemplateCommand } from "../../src/project/commands";

afterEach(() => { vi.restoreAllMocks(); });
const environment = { root: "/project" };
const run = (argv: string[], manager?: typeof executeTemplateCommand) =>
  runCli(argv, environment, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, manager);
const envelope = (text: string) => {
  const parsed = JSON.parse(text);
  expect(CliEnvelopeSchema.safeParse(parsed).success, text).toBe(true);
  return parsed;
};

describe("velora templates", () => {
  it("lists templates and blueprints as a JSON envelope", async () => {
    const result = await run(["templates", "ls", "--json"]);
    expect(result.code).toBe(0);
    const data = envelope(result.stdout).data;
    expect(data.templates.map((t: { id: string }) => t.id)).toContain("hero-push");
    expect(data.blueprints.map((b: { id: string }) => b.id)).toEqual(["product-reel-20s", "website-hero-loop-8s", "launch-film-30s", "feature-drop-15s", "social-teaser-9x16", "changelog-20s", "product-hunt-kit", "app-preview-25s"]);
  }, 30_000);
  it("filters, shows one template and certifies the catalog", async () => {
    const loops = envelope((await run(["templates", "ls", "--tag", "loop", "--json"])).stdout).data.templates.map((t: { id: string }) => t.id);
    expect(loops).toEqual(["float-loop"]);
    const shown = envelope((await run(["templates", "show", "--id", "rack-focus", "--json"])).stdout).data;
    expect(shown.template.craft.technique).toMatch(/focus/);
    expect(shown.examples[0]).toContain("velora new scene --template rack-focus");
    const checked = await run(["templates", "check", "--json"]);
    expect(checked.code).toBe(0);
    expect(envelope(checked.stdout).data.templates.every((t: { certified: boolean }) => t.certified)).toBe(true);
    const missing = await run(["templates", "show", "--id", "nope", "--json"]);
    expect(missing.code).toBe(1);
    expect(envelope(missing.stderr).issues[0]).toMatchObject({ code: "ERR_TEMPLATE_NOT_FOUND", hint: expect.stringContaining("templates ls") });
  }, 60_000);
  it("prints human-readable lists and per-command help", async () => {
    expect((await run(["templates", "ls"])).stdout).toMatch(/hero-push\s+The precise push-in/);
    for (const command of ["templates", "new"]) expect((await run([command, "--help"])).stdout).toContain("Skill: velora-templates");
  });
});

describe("velora new", () => {
  it("passes repeated --set and every slot flag to the scaffolder", async () => {
    const manager = vi.fn(async () => ({ success: true as const, command: "new" as const, data: { files: ["a.scene.json", "a.tsx"] }, next: ["velora shot --scene a"] }));
    const result = await run(["new", "scene", "--template", "hero-push", "--id", "a", "--route", "/", "--set", "intensity=dramatic", "--set", "lens=35", "--aspect", "9:16", "--duration", "5000", "--json"], manager);
    expect(result.code).toBe(0);
    expect(manager).toHaveBeenCalledWith("new-scene", { template: "hero-push", id: "a", route: "/", aspect: "9:16", set: { intensity: "dramatic", lens: "35" }, durationMs: 5000 }, { root: "/project" });
    const video = vi.fn(async () => ({ success: true as const, command: "new" as const, data: { files: [] } }));
    await run(["new", "video", "--blueprint", "product-reel-20s", "--id", "reel", "--component", "src/App.tsx#App"], video);
    expect(video).toHaveBeenCalledWith("new-video", { blueprint: "product-reel-20s", id: "reel", component: "src/App.tsx#App" }, { root: "/project" });
  });
  it.each([
    [["new"], "ERR_MISSING_VALUE"],
    [["new", "page"], "ERR_UNKNOWN_COMMAND"],
    [["new", "scene", "--id", "a"], "ERR_MISSING_VALUE"],
    [["new", "scene", "--template", "hero-push", "--id", "a", "--route", "/", "--component", "x.tsx"], "ERR_INVALID_FLAG_COMBINATION"],
    [["new", "scene", "--template", "hero-push", "--id", "a", "--set", "lens"], "ERR_MISSING_VALUE"],
    [["new", "scene", "--template", "hero-push", "--id", "a", "--id", "b"], "ERR_DUPLICATE_OPTION"],
    [["new", "video", "--blueprint", "x", "--id", "a", "--set", "k=v"], "ERR_UNKNOWN_OPTION"],
  ])("%j is a usage error", async (argv, code) => {
    const result = await run([...argv, "--json"], vi.fn());
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr).issues[0].code).toBe(code);
  });
});

describe("velora brand", () => {
  it("dispatches init and check, and prints help", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const manager = (async (operation: string, input: Record<string, unknown>) => {
      calls.push([operation, input]);
      return { success: true, command: "brand", data: { file: "velora.brand.json", brand: { name: "Acme", motion: "crisp", colors: { accent: "#f36" } } } };
    }) as never;
    const environment = { root: "/project" };
    const init = await runCli(["brand", "init", "--from-css", "src/index.css", "--json"], environment, ...Array(16).fill(undefined), manager);
    expect(init.code).toBe(0);
    expect(JSON.parse(init.stdout)).toMatchObject({ success: true, command: "brand" });
    const check = await runCli(["brand", "check"], environment, ...Array(16).fill(undefined), manager);
    expect(check.stdout).toContain("Valid velora.brand.json: Acme, motion crisp");
    expect(calls).toEqual([["brand-init", { fromCss: "src/index.css" }], ["brand-check", {}]]);
    expect((await runCli(["brand", "--help"], environment)).stdout).toContain("velora brand init");
    expect((await runCli(["brand", "paint"], environment)).code).not.toBe(0);
  });
});
