import { z } from "zod";
import type { DepthMatch } from "./depth";
import { applyPoint, type Matrix } from "./matrix";

/** SOURCE OF TRUTH: ElementTargetSchema, resolveTarget.
 * WHAT: validate live element references and resolve measured Surface geometry into a point and corners.
 * WHY: authored targets stay stable as layout, scrolling and elevation change.
 * WHERE: Scene constraints, shot builders, Studio and CLI consume the same measured geometry.
 */
export const AnchorNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const unit = z.number().min(0).max(1);
const options = { surface: z.string().min(1).max(128), at: z.tuple([unit, unit]).optional(), plane: z.enum(["base", "face"]).optional() };
export const ElementTargetSchema = z.union([
  z.strictObject({ ...options, anchor: AnchorNameSchema }),
  z.strictObject({ ...options, selector: z.string().trim().min(1).max(256) }),
]);
export type ElementTarget = z.output<typeof ElementTargetSchema>;
export type ElementMatch = Pick<ElementTarget, "surface"> & ({ anchor: string } | { selector: string });
export function isElementTarget(target: object): target is ElementTarget {
  return "surface" in target && ("selector" in target || "anchor" in target && typeof target.anchor === "string");
}
export const elementKey = (target: ElementMatch) => JSON.stringify([target.surface, "anchor" in target ? "anchor" : "selector", "anchor" in target ? target.anchor : target.selector]);
export const targetPoseKey = (target: ElementTarget) => JSON.stringify([elementKey(target), target.at ?? [0.5, 0.5], target.plane ?? "face"]);
export function describeElementTarget(target: ElementMatch): string {
  return `${target.surface}:${"anchor" in target ? target.anchor : `css(${target.selector})`}`;
}
export function parseElementTarget(text: string, defaultSurface?: string): ElementTarget | undefined {
  const boundary = text.startsWith("css(") ? -1 : text.indexOf(":");
  const surface = boundary === -1 ? defaultSurface : text.slice(0, boundary);
  const body = text.slice(boundary + 1);
  const match = /^(?:css\(([\s\S]+)\)|([a-z0-9][a-z0-9-]*))(?:@((?:\d+(?:\.\d*)?|\.\d+)),((?:\d+(?:\.\d*)?|\.\d+)))?$/.exec(body);
  if (!match) return;
  const parsed = ElementTargetSchema.safeParse({ surface, ...(match[1] ? { selector: match[1] } : { anchor: match[2] }), ...(match[3] ? { at: [Number(match[3]), Number(match[4])] } : {}) });
  return parsed.success ? parsed.data : undefined;
}

const rect = z.strictObject({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() });
export const StagePointSchema = z.tuple([z.number(), z.number(), z.number()]);
export const AnchorReportSchema = z.strictObject({
  target: ElementTargetSchema, tier: z.string().optional(), rect, elevation: z.number(), baseElevation: z.number(),
  stagePoint: StagePointSchema.optional(), stageCorners: z.tuple([StagePointSchema, StagePointSchema, StagePointSchema, StagePointSchema]).optional(),
  stageElevation: z.strictObject({ current: StagePointSchema, rest: StagePointSchema }).optional(),
  projected: rect.optional(), point: z.tuple([z.number(), z.number()]).optional(), depth: z.number(), blur: z.number().nonnegative(), visible: z.boolean(), ambiguous: z.literal(true).optional(),
});
export type AnchorReport = z.output<typeof AnchorReportSchema>;
const AnchorInventorySchema = AnchorReportSchema.partial({ depth: true, blur: true, visible: true });
export const AnchorsResultSchema = z.strictObject({ sceneId: z.string(), timeMs: z.number().nonnegative(), anchors: z.array(AnchorInventorySchema) });
export type AnchorsResult = z.output<typeof AnchorsResultSchema>;
export type AnchorMeasurement = { target: ElementMatch; rect: z.output<typeof rect>; elevation: number; baseElevation: number; restElevation?: number; restBaseElevation?: number; tier?: string; layerMatch?: DepthMatch };
export const matchesDepthLayer = (match: DepthMatch, layer: string) => "anchor" in match ? match.anchor === layer : match.selector === layer || match.selector === `#${layer}`;
export type AnchorMeasurements = { entries: readonly AnchorMeasurement[]; matches: Readonly<Record<string, readonly AnchorMeasurement[]>> };

export function resolveTarget<T extends { id: string; world: Matrix }>(target: ElementTarget, anchors: AnchorMeasurements, evaluation: { nodes: readonly T[] }) {
  const matches = anchors.matches[elementKey(target)] ?? [];
  if (matches.length !== 1) return { ok: false as const, code: matches.length ? "target-ambiguous" as const : "target-missing" as const };
  const node = evaluation.nodes.find(node => node.id === target.surface);
  if (!node) return { ok: false as const, code: "target-missing" as const };
  const measurement = matches[0];
  const { x, y, width, height } = measurement.rect;
  const [u, v] = target.at ?? [0.5, 0.5];
  const z = target.plane === "base" ? measurement.baseElevation : measurement.elevation;
  const corner = (u: number, v: number) => applyPoint(node.world, [x + u * width, y + v * height, z]);
  return { ok: true as const, node, measurement, point: corner(u, v), corners: [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)] };
}
