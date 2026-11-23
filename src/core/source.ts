import { z } from "zod";
import { AnchorNameSchema } from "./targets";
import { ANIMATABLE_ID_PATTERN } from "./animatable";
import { SceneRecipeIdSchema } from "./recipes";

/** SOURCE OF TRUTH: SourceOutlineSchema.
 * WHAT: shared JSX outline and confirmed edit contracts.
 * WHY: CLI and studio use the same source operations with no compiler in the browser.
 * WHERE: project/source owns the AST and project/source-edit owns effect policy.
 */
export const SourceFileSchema = z.string().max(400).regex(/^src\/(?:[\w .-]+\/)*[\w .-]+\.(?:tsx|jsx)$/i, "Use a .tsx or .jsx file under src.");
const scalar = z.union([z.number(), z.string(), z.boolean()]);
const location = z.strictObject({ line: z.number().int().positive(), column: z.number().int().positive() });
const node = z.strictObject({
  path: z.string(), parent: z.string().optional(), tag: z.string(),
  attributes: z.record(z.string(), scalar), literals: z.record(z.string(), scalar), text: z.string().max(40),
  start: location, end: location, isSurface: z.boolean(), surfaceId: z.string().optional(), owner: z.string().optional(),
  insideMap: z.boolean(), insideConditional: z.boolean(), insideProp: z.boolean(), hasSpread: z.boolean(),
});
export const SourceOutlineSchema = z.strictObject({
  file: SourceFileSchema, nodes: z.array(node),
  animatables: z.array(z.strictObject({ id: z.string(), props: z.array(z.string()), at: location })),
});
export type SourceOutline = z.output<typeof SourceOutlineSchema>;
export type SourceNode = SourceOutline["nodes"][number];
const fields = { file: SourceFileSchema, scene: SceneRecipeIdSchema.optional(), node: z.string().min(1).max(1000), id: z.string().regex(ANIMATABLE_ID_PATTERN).max(80), expectedSha: z.string().regex(/^[a-f0-9]{64}$/).optional() };
export const SourceRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...fields, kind: z.literal("anchor"), id: AnchorNameSchema }),
  z.strictObject({ ...fields, kind: z.literal("wrap"), content: z.boolean().optional() }),
  z.strictObject({ ...fields, kind: z.literal("group"), nodes: z.array(z.string().min(1).max(1000)).min(2).max(100) }),
  z.strictObject({ ...fields, kind: z.literal("expose"), prop: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/), options: z.array(z.string().min(1).max(64)).min(2).max(32).optional() }),
]);
export type SourceRequest = z.output<typeof SourceRequestSchema>;
export const SourceConfirmSchema = z.strictObject({ previewId: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), baseShas: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) });
export type SourceConfirm = z.output<typeof SourceConfirmSchema>;
export type SourceDocument = SourceOutline & { absolutePath: string; sha: string };
export type SourcePreview = SourceConfirm & {
  diffs: { file: string; diff: string; git: "clean" | "dirty" | "unknown" }[];
  outline: SourceOutline; layoutWarning?: string;
};
