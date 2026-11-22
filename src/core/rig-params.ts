import { z } from "zod";
import { LensPresetSchema } from "./lens";
import { ElementTargetSchema, StagePointSchema, targetPoseKey } from "./targets";

export const RIG_KINDS = ["drone-flyover", "telephoto-parallax-orbit", "whip-pan-macro"] as const;
export const RigKindSchema = z.enum(RIG_KINDS);
export type RigKind = z.output<typeof RigKindSchema>;
export const RIG_MASSES = Object.freeze({
  light: { frequencyHz: 1.6, dampingRatio: 0.9 },
  medium: { frequencyHz: 1, dampingRatio: 0.95 },
  heavy: { frequencyHz: 0.6, dampingRatio: 1 },
});
export const FollowerSchema = z.strictObject({ frequencyHz: z.number().positive().max(12), dampingRatio: z.number().min(0.1).max(2) });
export const RigMassSchema = z.union([z.enum(["light", "medium", "heavy"]), FollowerSchema]);
export const RigWaypointSchema = z.union([StagePointSchema, ElementTargetSchema]);
export const RigDurationSchema = z.number().min(150).max(120_000);
const fill = z.number().positive().max(1);
const strength = z.enum(["subtle", "standard", "dramatic"]);
export const DroneFlyoverSchema = z.strictObject({
  waypoints: z.array(RigWaypointSchema).min(2).max(12), altitude: z.number().min(0).max(20_000).default(180),
  durationMs: RigDurationSchema.optional(), speed: z.number().positive().max(20_000).optional(),
  lens: LensPresetSchema.default("24mm-drone"), mass: RigMassSchema.default("medium"), bank: strength.default("subtle"),
  through: z.boolean().default(false), lookAhead: z.number().min(0).max(1).default(0.35), margin: z.number().nonnegative().max(4000).default(40),
}).refine(p => !(p.durationMs !== undefined && p.speed !== undefined), { message: "Choose durationMs or speed." });
export const TelephotoOrbitSchema = z.strictObject({
  target: ElementTargetSchema, lens: LensPresetSchema.default("200mm-telephoto"), arcDeg: z.number().positive().max(140).default(24),
  axis: z.union([z.enum(["horizontal", "vertical"]), z.strictObject({ yaw: z.number().min(-180).max(180), pitch: z.number().min(-89).max(89) })]).default("horizontal"),
  durationMs: RigDurationSchema.default(4000), mass: RigMassSchema.default("heavy"), fill: fill.default(0.55),
  depthBoost: z.number().min(0).max(3).optional(),
});
export const WhipPanSchema = z.strictObject({
  from: ElementTargetSchema, to: ElementTargetSchema, lens: z.enum(["85mm-portrait", "200mm-telephoto"]).default("85mm-portrait"),
  durationMs: RigDurationSchema.max(900).default(720), mass: RigMassSchema.default("light"),
  settle: z.enum(["none", "organic"]).default("organic"), fill: fill.default(0.6), blur: z.enum(["auto", "off"]).default("auto"),
}).refine(p => targetPoseKey(p.from) !== targetPoseKey(p.to), { message: "Choose two different whip targets." });
export const RigRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("drone-flyover"), params: DroneFlyoverSchema }),
  z.strictObject({ kind: z.literal("telephoto-parallax-orbit"), params: TelephotoOrbitSchema }),
  z.strictObject({ kind: z.literal("whip-pan-macro"), params: WhipPanSchema }),
]);
export const RigLayerSchema = z.strictObject({
  id: z.string().min(1).max(400), target: ElementTargetSchema.optional(), tier: z.string().optional(),
  point: StagePointSchema, corners: z.tuple([StagePointSchema, StagePointSchema, StagePointSchema, StagePointSchema]).optional(),
  elevation: z.strictObject({ current: StagePointSchema, rest: StagePointSchema }).optional(),
});
export const RigGeometrySchema = z.array(RigLayerSchema).max(1024);

export function mergeRigParams(kind: RigKind, prior?: Record<string, unknown>, changes?: Record<string, unknown>) {
  const params = { ...prior, ...changes };
  if (kind === "drone-flyover" && changes) {
    if (changes.durationMs !== undefined && changes.speed === undefined) delete params.speed;
    if (changes.speed !== undefined && changes.durationMs === undefined) delete params.durationMs;
  }
  return params;
}
