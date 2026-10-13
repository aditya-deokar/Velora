import { z } from "zod";

/** SOURCE OF TRUTH: InitProjectSchema, SyncProjectSchema, ValidateProjectSchema, project command contracts.
 * WHAT: inputs and results exchanged by local project adapters and trusted commands.
 * WHY: adapters share runtime validation without importing filesystem or process code.
 * WHERE: RESOURCES binds input schemas; project/commands executes them; cli presents results.
 */
export const InitProjectSchema = z.strictObject({
  packageSource: z.string().min(1).optional(),
  adapter: z.enum(["auto", "react"]).optional(),
});
export const SyncProjectSchema = z.strictObject({});
export const LoadProjectSchema = z.strictObject({});
export const ValidateProjectSchema = z.strictObject({
  composition: z.string().min(1).optional(),
});
export const ValidationAdviceSchema = z.strictObject({
  code: z.string(),
  path: z.string(),
  message: z.string(),
});
export const ValidationSummarySchema = z.strictObject({
  scenes: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
  composition: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  advice: z.array(ValidationAdviceSchema),
  requiresVisualReview: z.literal(true),
});
export const OpenPreviewSchema = z.strictObject({
  url: z.url().regex(
    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?\/?$/,
    "Use an HTTP loopback dev-server origin, for example http://127.0.0.1:5173.",
  ),
  launch: z.boolean().default(true),
});
export const ProjectStateSchema = z.strictObject({
  version: z.literal(1),
  projectId: z.uuid(),
  entry: z.string().min(1),
  packageManager: z.literal("npm"),
  adapter: z.enum(["next-app", "next-pages", "react"]).optional(),
});
export const ProjectIssueSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  hint: z.string().optional(),
});
export const ProjectResultSchema = z.discriminatedUnion("success", [
  z.strictObject({success:z.literal(true),command:z.string().min(1).optional(),data:z.strictObject({
    project:ProjectStateSchema.optional(),url:z.string().optional(),changed:z.boolean().optional(),
    validation:ValidationSummarySchema.optional(),
    integration:z.strictObject({kind:z.string(),component:z.string(),route:z.string().optional(),instructions:z.string()}).optional(),
    handoff:z.strictObject({
      path:z.literal("FLUTE.md"), guideCommand:z.literal("npx flute guide --json"),
      guideVersion:z.number().int().positive(), prompt:z.string().min(1),
    }).optional(),
  }),warnings:z.array(ProjectIssueSchema).optional(),next:z.array(z.string()).optional()}),
  z.strictObject({success:z.literal(false),command:z.string().min(1).optional(),issues:z.array(ProjectIssueSchema),
    next:z.array(z.string()).optional()}),
]);
export type ProjectState = z.output<typeof ProjectStateSchema>;
export type ProjectResult = z.output<typeof ProjectResultSchema>;
