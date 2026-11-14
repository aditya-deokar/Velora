import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { jsonSchemas } from "../../src/core/schemas";
import { SceneRecipeSchema } from "../../src/core/recipes";
import { CompositionSchema } from "../../src/core/composition";

// The shipped editor schemas are generated from the canonical Zod contracts; committed
// copies must match the sources (regenerate with npm run build:package).
const directory = new URL("../../schemas/", import.meta.url);

describe("editor JSON Schemas", () => {
  it("ships exactly the generated documents, without drift", () => {
    const generated = jsonSchemas();
    expect(readdirSync(directory).sort()).toEqual(Object.keys(generated).sort());
    for (const [name, schema] of Object.entries(generated))
      expect(JSON.parse(readFileSync(new URL(name, directory), "utf8")), `${name} is stale; run npm run build:package`).toEqual(JSON.parse(JSON.stringify(schema)));
  });
  it("describes the v2 motion vocabulary and the $schema pointer", () => {
    const recipe = JSON.stringify(jsonSchemas()["scene-recipe.schema.json"]);
    for (const term of ["cubicBezier", "spring", "steps", "elastic.out", "channel", "clipRadius", "perspective", "interpolation", "noise", "loop", "$schema"])
      expect(recipe, term).toContain(term);
  });
  it("describes the v2.1 motion model v3 vocabulary", () => {
    const recipe = JSON.stringify(jsonSchemas()["scene-recipe.schema.json"]);
    for (const term of ["\"auto\"", "\"style\"", "scaleX", "skewY", "originX", "brightness", "hueRotate", "grayscale", "markers", "locked", "\"teal\"", "rem"])
      expect(recipe, term).toContain(term);
  });
  it("lets recipes and compositions carry a $schema pointer", () => {
    const $schema = "../../../node_modules/@adityadeokar/velora/schemas/scene-recipe.schema.json";
    expect(SceneRecipeSchema.safeParse({ $schema, version: 1, id: "a", title: "A", definition: { scene: { nodes: [] } } }).success).toBe(true);
    expect(CompositionSchema.safeParse({ $schema: "node_modules/@adityadeokar/velora/schemas/composition.schema.json", version: 1, id: "c", title: "C", width: 640, height: 360, scenes: [{ id: "s", recipe: "a", startMs: 0, durationMs: 1000 }] }).success).toBe(true);
  });
});
