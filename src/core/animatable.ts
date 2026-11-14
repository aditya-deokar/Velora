import { z } from "zod";
import { parseCssColor } from "./color";

/** SOURCE OF TRUTH: AnimatableSpecSchema, coerceAnimatable, ANIMATABLE_ID_PATTERN.
 * WHAT: typed component props ("animatables") that any React component can declare: number, color,
 * boolean and enum props whose values come from recipe channel tracks `<animatable id>.<prop>`.
 * WHY: full control of real components means every prop the editor or an agent can keyframe is
 * declared data with a default, range and label, and evaluates on the one motion clock.
 * WHERE: react/animatable.ts (useAnimatable) reads evaluated channels and registers specs in the Scene
 * registry; core/motion evaluates the channel tracks; the Phase 04 inspector reads the registry.
 */
export const ANIMATABLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*$/;
const PROP_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,63}$/;
const finite = z.number().finite();
const label = z.string().min(1).max(80).optional();
const NumberPropSchema = z.strictObject({
  type: z.literal("number"), default: finite, min: finite.optional(), max: finite.optional(), step: finite.positive().optional(),
  unit: z.string().max(16).optional(), label,
}).refine(spec => spec.min === undefined || spec.max === undefined || spec.min <= spec.max, "min must not exceed max.")
  .refine(spec => (spec.min === undefined || spec.default >= spec.min) && (spec.max === undefined || spec.default <= spec.max), "default must lie within min..max.");
const ColorPropSchema = z.strictObject({ type: z.literal("color"), default: z.string().max(128), label })
  .superRefine((spec, ctx) => {
    const parsed = parseCssColor(spec.default);
    if (!parsed.ok) ctx.addIssue({ code: "custom", path: ["default"], message: parsed.message });
  });
const BooleanPropSchema = z.strictObject({ type: z.literal("boolean"), default: z.boolean(), label });
const EnumPropSchema = z.strictObject({ type: z.literal("enum"), options: z.array(z.string().min(1).max(64)).min(1).max(32), default: z.string(), label })
  .refine(spec => spec.options.includes(spec.default), "default must be one of options.")
  .refine(spec => new Set(spec.options).size === spec.options.length, "options must be distinct.");
export const AnimatablePropSchema = z.union([NumberPropSchema, ColorPropSchema, BooleanPropSchema, EnumPropSchema]);
export const AnimatableSpecSchema = z.record(z.string().regex(PROP_PATTERN, "Use a camelCase prop name (letters and digits)."), AnimatablePropSchema)
  .refine(spec => Object.keys(spec).length >= 1 && Object.keys(spec).length <= 64, "Declare between 1 and 64 animatable props.");
export type AnimatableProp = z.output<typeof AnimatablePropSchema>;
export type AnimatableSpec = z.output<typeof AnimatableSpecSchema>;
export type AnimatableValue<P extends AnimatableProp> =
  P extends { type: "number" } ? number : P extends { type: "boolean" } ? boolean
    : P extends { type: "enum"; options: readonly (infer O)[] } ? O : string;
export type AnimatableValues<S extends Record<string, AnimatableProp>> = { [K in keyof S]: AnimatableValue<S[K]> };

/** Channel id for one prop: `<animatable id>.<prop>`. */
export function animatableChannel(id: string, prop: string): string {
  return `${id}.${prop}`;
}
/** Turn an evaluated channel value into the prop's type. Numbers clamp, booleans switch at 0.5, enums
 * hold the rounded option index, colors pass through; a missing or mistyped value yields the default. */
export function coerceAnimatable(spec: AnimatableSpec, prop: string, channelValue: number | string | undefined): number | string | boolean {
  const entry = spec[prop];
  if (!entry) throw new RangeError(`Unknown animatable prop "${prop}".`);
  if (entry.type === "color") return typeof channelValue === "string" ? channelValue : entry.default;
  if (typeof channelValue !== "number" || !Number.isFinite(channelValue)) return entry.default;
  if (entry.type === "number") return Math.min(entry.max ?? Infinity, Math.max(entry.min ?? -Infinity, channelValue));
  if (entry.type === "boolean") return channelValue >= 0.5;
  return entry.options[Math.min(entry.options.length - 1, Math.max(0, Math.round(channelValue)))];
}
