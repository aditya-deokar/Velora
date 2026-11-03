import { z } from "zod";
import { SceneRecipeSchema } from "./recipes";
import { CompositionSchema } from "./composition";
import { BrandSchema } from "./brand";

/** SOURCE OF TRUTH: jsonSchemas.
 * WHAT: JSON Schema documents (draft 2020-12, input shape) for the files people and agents edit by hand.
 * WHY: editors autocomplete and validate recipes, compositions and brand files from the same Zod contracts the CLI enforces.
 * WHERE: scripts/build-schemas.mjs writes them to schemas/ for the package; a test keeps the committed copies current.
 * Cross-field rules (distinct keyframe times, matching IDs) stay CLI-only; run velora validate for those.
 */
export function jsonSchemas(): Record<string, object> {
  const document = (schema: z.ZodType, id: string, title: string) => ({
    ...z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
    $id: `https://unpkg.com/@adityadeokar/velora/schemas/${id}`,
    title,
  });
  return {
    "scene-recipe.schema.json": document(SceneRecipeSchema, "scene-recipe.schema.json", "Velora scene recipe (src/velora/scenes/<id>.scene.json)"),
    "composition.schema.json": document(CompositionSchema, "composition.schema.json", "Velora composition (<id>.composition.json)"),
    "brand.schema.json": document(BrandSchema, "brand.schema.json", "Velora brand tokens (velora.brand.json)"),
  };
}
