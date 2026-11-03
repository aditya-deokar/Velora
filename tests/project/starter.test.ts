import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeCreateCommand } from "../../src/project/commands";
import { starterFiles } from "../../src/project/starter";
import { BrandSchema } from "../../src/core/brand";
import { VELORA_PACKAGE } from "../../src/core/branding";
import { runCli } from "../../src/cli";

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "velora-starter-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("velora create", () => {
  it("writes a branded Vite React starter with setup scripts, create-only", async () => {
    const result = await executeCreateCommand({ dir: "my-launch", name: "Fieldnote" }, { root, version: "0.1.2" });
    expect(result).toMatchObject({ success: true, data: { dir: "my-launch", blueprint: "launch-film-30s", next: ["cd my-launch", "npm install", "npm run velora:setup", "npm run dev"] } });
    expect((await readdir(path.join(root, "my-launch"))).sort()).toEqual([".gitignore", "README.md", "index.html", "package.json", "src", "tsconfig.json", "velora.brand.json", "vite.config.mjs"]);
    const pkg = JSON.parse(await readFile(path.join(root, "my-launch/package.json"), "utf8"));
    expect(pkg.name).toBe("my-launch");
    expect(pkg.devDependencies[VELORA_PACKAGE.name]).toBe("^0.1.2");
    expect(pkg.dependencies.react).toMatch(/^\^19/);
    expect(pkg.scripts["velora:setup"]).toBe("velora init && velora skills install --agent claude && velora new video --blueprint launch-film-30s --id launch --route /");
    const brand = BrandSchema.parse(JSON.parse(await readFile(path.join(root, "my-launch/velora.brand.json"), "utf8")));
    expect([brand.name, brand.motion]).toEqual(["Fieldnote", "crisp"]);
    expect(await readFile(path.join(root, "my-launch/src/App.tsx"), "utf8")).toContain("<h1>Fieldnote</h1>");
    expect(await readFile(path.join(root, "my-launch/README.md"), "utf8")).toContain("velora studio --site");
  });
  it("names the product from the directory and honours a blueprint", async () => {
    const result = await executeCreateCommand({ dir: "launches/acme-teaser", blueprint: "social-teaser-9x16" }, { root });
    expect(result).toMatchObject({ success: true, data: { blueprint: "social-teaser-9x16" } });
    const brand = JSON.parse(await readFile(path.join(root, "launches/acme-teaser/velora.brand.json"), "utf8"));
    expect(brand.name).toBe("Acme Teaser");
  });
  it("refuses a non-empty directory, traversal, odd names and unknown blueprints", async () => {
    await mkdir(path.join(root, "taken"));
    await writeFile(path.join(root, "taken/keep.txt"), "mine");
    expect(await executeCreateCommand({ dir: "taken" }, { root })).toMatchObject({ success: false, issues: [{ code: "output-exists" }] });
    expect(await readFile(path.join(root, "taken/keep.txt"), "utf8")).toBe("mine");
    for (const dir of ["../escape", "/abs", "C:/abs", "-flag", "a/../b"]) expect(await executeCreateCommand({ dir }, { root }), dir).toMatchObject({ success: false });
    expect(await executeCreateCommand({ dir: "x", blueprint: "nope" }, { root })).toMatchObject({ success: false, issues: [{ code: "ERR_TEMPLATE_NOT_FOUND" }] });
  });
  it("strips markup from the product name before it reaches HTML, CSS or TSX", () => {
    const files = starterFiles({ name: '<script>alert("x")</script>', slug: "x", packageVersion: "1.0.0", blueprint: "launch-film-30s" });
    for (const file of ["index.html", "src/App.tsx", "README.md"]) expect(files[file]).not.toMatch(/<script>alert/);
  });
  it("is wired into the CLI", async () => {
    const created = await runCli(["create", "cli-launch", "--name", "Orbit", "--json"], { root });
    expect(created.code).toBe(0);
    expect(JSON.parse(created.stdout)).toMatchObject({ success: true, command: "create" });
    expect((await runCli(["create", "--json"], { root })).code).toBe(2);
    expect((await runCli(["create", "y", "--bogus"], { root })).code).toBe(2);
    expect((await runCli(["create", "--help"], { root })).stdout).toContain("velora studio --site");
  });
});
