import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverRecipes, loadComposition } from "../../src/project/discovery";
import { parseJsonDocument } from "../../src/core/json";

// Windows editors (Notepad, PowerShell 5.1) save UTF-8 with a byte-order mark; those files
// are valid JSON to a person and must be valid to Velora.
const BOM = "﻿";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function project() {
  const root = await mkdtemp(path.join(tmpdir(), "velora-bom-"));
  roots.push(root);
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  return root;
}

describe("BOM-prefixed JSON", () => {
  it("parses with or without a leading byte-order mark and still rejects broken JSON", () => {
    expect(parseJsonDocument(`${BOM}{"a":1}`)).toEqual({ a: 1 });
    expect(parseJsonDocument('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJsonDocument(`${BOM}{"a":`)).toThrow();
    expect(() => parseJsonDocument(`{"a":"x${BOM}`)).toThrow();
  });
  it("discovers a BOM-prefixed scene recipe", async () => {
    const root = await project();
    await writeFile(path.join(root, "src/velora/scenes/hero.scene.json"), BOM + JSON.stringify({ version: 1, id: "hero", title: "Hero", definition: { scene: { nodes: [{ id: "page" }] } } }));
    await writeFile(path.join(root, "src/velora/scenes/hero.tsx"), "export default function Hero() { return null; }");
    const catalog = await discoverRecipes(root);
    expect(catalog.issues).toEqual([]);
    expect(catalog.scenes.map(scene => scene.id)).toEqual(["hero"]);
  });
  it("loads a BOM-prefixed composition", async () => {
    const root = await project();
    await writeFile(path.join(root, "launch.composition.json"), BOM + JSON.stringify({ version: 1, id: "launch", title: "Launch", width: 1920, height: 1080, scenes: [{ id: "s1", recipe: "hero", startMs: 0, durationMs: 4000 }] }));
    const loaded = await loadComposition(root, "launch.composition.json");
    expect("composition" in loaded && loaded.composition.id).toBe("launch");
  });
});
