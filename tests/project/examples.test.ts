import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, cp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSceneRecipes } from "../../src/core/recipes";
import { CompositionSchema, compositionTotals, resolveCompositionSpec } from "../../src/core/composition";
import { checkCaptions, parseCaptions } from "../../src/core/captions";
import { TRANSITION_CATALOG } from "../../src/core/transitions";
import { executeFramesRender } from "../../src/export/commands";
import { RenderManifestSchema } from "../../src/core/export";

const root = fileURLToPath(new URL("../../", import.meta.url));
// 320x200 black-void SHA recorded by the Phase 09 demos; every example shares
// the canvas so gap renders must reproduce exactly these bytes.
const VOID_SHA = "12584dd631965ce24404c87f727f96bc1a9e484115e30f355563c8e425ff3851";
const EXAMPLES = [
  { dir: "saas-tour", composition: "tour.composition.json", gapAt: [1600, 1800] },
  { dir: "kinetic-explainer", composition: "explainer.composition.json", gapAt: [1600, 1800] },
  { dir: "data-story", composition: "story.composition.json", gapAt: [1600, 1800] },
] as const;

describe.each(EXAMPLES.map((e) => [e.dir] as const))("example %s", (dir) => {
  const base = path.join(root, "tests/examples", dir);
  it("recipes validate and resolve against the composition", async () => {
    const sceneDir = path.join(base, "src/velora/scenes");
    const sources: { path: string; document: unknown }[] = [];
    const bindingPaths: string[] = [];
    for (const file of (await readdir(sceneDir)).sort()) {
      const rel = `src/velora/scenes/${file}`;
      if (file.endsWith(".scene.json")) sources.push({ path: rel, document: JSON.parse(await readFile(path.join(sceneDir, file), "utf8")) });
      else if (/\.[jt]sx$/.test(file)) bindingPaths.push(rel);
    }
    expect(sources.length).toBeGreaterThan(0);
    const catalog = loadSceneRecipes({ sources, bindingPaths });
    expect(catalog.issues, JSON.stringify(catalog.issues)).toEqual([]);
    const composition = CompositionSchema.parse(JSON.parse(await readFile(path.join(base, EXAMPLES.find((e) => e.dir === dir)!.composition), "utf8")));
    const resolved = resolveCompositionSpec(composition, catalog, [], {});
    expect(resolved.issues, JSON.stringify(resolved.issues)).toEqual([]);
    // Transitions fit their segments and resolve to leaf-owning scenes.
    for (const segment of composition.scenes) {
      if (!segment.transition) continue;
      const entry = TRANSITION_CATALOG.find((t) => t.type === segment.transition!.type);
      expect(entry).toBeDefined();
      expect(segment.transition.durationMs).toBeLessThanOrEqual(segment.durationMs);
      if (entry!.needsLeaves) {
        const recipe = catalog.scenes.find((s) => s.id === segment.recipe)!;
        expect(recipe.definition.scene.nodes.length).toBeGreaterThan(0);
      }
    }
    // Captions parse and cover the timeline at reading speed.
    const ref = composition.captions!.file;
    const text = await readFile(path.join(base, ref), "utf8");
    const parsed = parseCaptions(text, "srt");
    expect("issues" in parsed).toBe(false);
    if (!("issues" in parsed)) {
      expect(checkCaptions(parsed.cues, compositionTotals(composition).durationMs)).toEqual([]);
      expect(parsed.cues.length).toBeGreaterThan(0);
    }
  });
});

describe.each(EXAMPLES.map((e) => [e.dir] as const))("example %s offline evidence", (dir) => {
  let tmp = "";
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });
  it("gap frames render deterministically with a dead server URL", async () => {
    const example = EXAMPLES.find((e) => e.dir === dir)!;
    tmp = await mkdtemp(path.join(tmpdir(), "velora-example-"));
    await cp(path.join(root, "tests/examples", dir), tmp, { recursive: true });
    const first = await executeFramesRender(
      { composition: example.composition, out: "stills", at: [...example.gapAt] },
      { root: tmp, url: "http://127.0.0.1:1" },
    );
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(first.data.total).toBe(2);
    const manifest = JSON.parse(await readFile(path.join(tmp, "stills/manifest.json"), "utf8"));
    expect(RenderManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.frames.map((f: { sha: string }) => f.sha)).toEqual([VOID_SHA, VOID_SHA]);
    // Second extraction reproduces identical bytes.
    const second = await executeFramesRender(
      { composition: example.composition, out: "stills2", at: [...example.gapAt] },
      { root: tmp, url: "http://127.0.0.1:1" },
    );
    expect(second.success).toBe(true);
    if (!second.success) return;
    const manifest2 = JSON.parse(await readFile(path.join(tmp, "stills2/manifest.json"), "utf8"));
    expect(manifest2.frames.map((f: { sha: string }) => f.sha)).toEqual([VOID_SHA, VOID_SHA]);
  }, 60_000);
});
