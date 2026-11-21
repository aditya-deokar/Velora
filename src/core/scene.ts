import { z } from "zod";

// SOURCE OF TRUTH: the spatial viewport is a black void; host surface paint remains unchanged.
export const SCENE_BACKGROUND = "#000000" as const;

/** SOURCE OF TRUTH: SceneSchema, NodeSchema, TransformSchema, SCENE_BACKGROUND.
 * WHAT: versioned spatial data, black void backdrop and validation; types derive here.
 * WHY: renderer and future project adapters must accept the same contract.
 * WHERE: core/spatial.ts evaluates it; react/ binds live components without serializing them.
 */
const finite = z.number().finite();
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/, "Use a stable alphanumeric ID.");
export const TransformSchema = z.strictObject({
  x: finite.default(0),
  y: finite.default(0),
  z: finite.default(0),
  rotateX: finite.default(0),
  rotateY: finite.default(0),
  rotateZ: finite.default(0),
  scale: finite.positive().max(100).default(1),
  // v2.1 optional, default-less additions: absent fields keep today's CSS and matrices exactly.
  // Per-axis scale multiplies the uniform scale; skew shears in the surface plane; origin is the
  // pivot for rotation, scale and skew in percent of the element (absent = 50% 50%).
  scaleX: finite.positive().max(100).optional(),
  scaleY: finite.positive().max(100).optional(),
  scaleZ: finite.positive().max(100).optional(),
  skewX: finite.min(-89).max(89).optional(),
  skewY: finite.min(-89).max(89).optional(),
  originX: finite.min(-100).max(200).optional(),
  originY: finite.min(-100).max(200).optional(),
});
export const NodeSchema = z.strictObject({
  id,
  parentId: id.optional(),
  transform: TransformSchema.prefault({}),
});
export const CameraSchema = z.strictObject({
  x: finite.default(0),
  y: finite.default(0),
  z: finite.default(0),
  perspective: finite.min(100).max(10000).default(1400),
  rotateX: finite.default(0),
  rotateY: finite.default(0),
  rotateZ: finite.default(0),
});
/** SOURCE OF TRUTH: camera depth-of-field controls. Distance and focalLength
 * share scene units; fStop controls aperture. The renderer owns kernel quality. */
export const FocusSchema = z.strictObject({
  distance: finite.positive().default(1400),
  fStop: finite.min(0.7).max(128).default(8),
  focalLength: finite.min(1).max(300).default(50),
  maxBlur: finite.min(0).max(32).default(6),
});
/** Constraint targets: a registered surface (anchor u, v in 0..1 of its box; default center) or a
 * stage-space point. Kept a discriminated shape so later phases can add element targets. */
const unit = finite.min(0).max(1);
export const ConstraintTargetSchema = z.union([
  z.strictObject({ surface: id, anchor: z.tuple([unit, unit]).optional() }),
  z.strictObject({ three: id }),
  z.strictObject({ point: z.tuple([finite, finite, finite]) }),
]);
// A constant 0..1 or a channel track (the TrackRef shape) whose value is clamped to 0..1.
const weight = z.union([unit, z.strictObject({ target: z.strictObject({ kind: z.literal("channel"), id: z.string().min(1).max(128) }), property: z.literal("value") })]);
export const SceneConstraintSchema = z.discriminatedUnion("kind", [
  // Pan/tilt about the camera's eye so the target projects to frame center (derives rotateX/rotateY; camera x/y/z follow so the eye stays fixed).
  z.strictObject({ kind: z.literal("lookAt"), subject: z.literal("camera").optional(), target: ConstraintTargetSchema, weight: weight.optional(), up: z.literal("y").optional() }),
  // Hold focus.distance on the target's camera-space depth (plus offset).
  z.strictObject({ kind: z.literal("focusFollow"), target: ConstraintTargetSchema, offset: finite.optional(), weight: weight.optional() }),
]);
export type SceneConstraint = z.output<typeof SceneConstraintSchema>;
export type SceneConstraintInput = z.input<typeof SceneConstraintSchema>;
export const SceneSchema = z
  .strictObject({
    version: z.literal(3).default(3),
    camera: CameraSchema.prefault({}),
    focus: FocusSchema.prefault({}),
    nodes: z.array(NodeSchema).max(1000),
    // Resolved by evaluateScene with layout measurements, so preview and export agree.
    constraints: z.array(SceneConstraintSchema).max(16).optional(),
  })
  .superRefine((scene, ctx) => {
    if (scene.focus.distance > 0 && scene.focus.distance <= scene.focus.focalLength)
      ctx.addIssue({code:"custom",path:["focus","distance"],message:"Focus distance must exceed focal length."});
    const nodes = new Map<string, (typeof scene.nodes)[number]>();
    for (const [index, node] of scene.nodes.entries()) {
      if (nodes.has(node.id))
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: "Duplicate surface ID: " + node.id,
        });
      nodes.set(node.id, node);
    }
    for (const [index, constraint] of (scene.constraints ?? []).entries())
      if ("surface" in constraint.target && !nodes.has(constraint.target.surface))
        ctx.addIssue({ code: "custom", path: ["constraints", index, "target", "surface"], message: "Constraint target is not a scene node: " + constraint.target.surface });
    for (const [index, node] of scene.nodes.entries()) {
      if (node.parentId && !nodes.has(node.parentId))
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "parentId"],
          message: "Missing parent: " + node.parentId,
        });
      const seen = new Set([node.id]);
      let parent = node.parentId;
      while (parent && nodes.has(parent)) {
        if (seen.has(parent)) {
          ctx.addIssue({
            code: "custom",
            path: ["nodes", index, "parentId"],
            message: "Cyclic surface hierarchy at " + node.id,
          });
          break;
        }
        seen.add(parent);
        parent = nodes.get(parent)?.parentId;
      }
    }
  });
export type SceneDefinition = z.output<typeof SceneSchema>;
export type SceneInput = z.input<typeof SceneSchema>;
export type NodeDefinition = z.output<typeof NodeSchema>;
export type Transform = z.output<typeof TransformSchema>;
export type TransformInput = z.input<typeof TransformSchema>;
export type CameraInput = z.input<typeof CameraSchema>;
export type CameraDefinition = z.output<typeof CameraSchema>;
export type FocusDefinition = z.output<typeof FocusSchema>;
export type FocusInput = z.input<typeof FocusSchema>;
export type SceneIssue = { path: string; message: string };
export function validateScene(
  input: unknown,
):
  | { success: true; data: SceneDefinition }
  | { success: false; issues: SceneIssue[] } {
  const result = SceneSchema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : {
        success: false,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
}
