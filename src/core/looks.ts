import { z } from "zod";
import { createRng } from "./random";

/** SOURCE OF TRUTH: LookSchema, LOOK_PRESETS, resolveLook, gradeColorMatrix, gradeTransferTable, grainOffset, parseCube, hasExportFinishing.
 * WHAT: a finishing "look" on a recipe definition or composition: grade, grain, vignette and letterbox
 * (browser layer, captured with the frame, so preview == export) plus bloom, halation, chromatic
 * aberration, sharpen and a .cube LUT (export finishing, applied per frame in Node).
 * WHY: a cinematographer's finishing pass, deterministic per frame (seeded grain, no Math.random) and
 * identical between `velora shot --finish`, frame renders and video.
 * WHERE: kit LookLayer draws the browser layer; export/compositor applies export finishing; recipes
 * and compositions carry `look` (a scene's own look wins over its composition's).
 */
const unit = z.number().finite().min(-1).max(1);
const channels = (min: number, max: number) => z.union([z.number().finite().min(min).max(max), z.tuple([z.number().finite().min(min).max(max), z.number().finite().min(min).max(max), z.number().finite().min(min).max(max)])]);
// Look files state only the grade fields they change (no defaults), so a preset's values survive a partial override.
const GradeFieldsSchema = z.strictObject({
  contrast: unit.optional(), saturation: unit.optional(), temperature: unit.optional(), tint: unit.optional(),
  // Lift raises blacks, gamma bends mids, gain scales whites; a [r,g,b] triple split-tones.
  lift: channels(-0.5, 0.5).optional(), gamma: channels(0.2, 5).optional(), gain: channels(0, 2).optional(),
});
export const GradeSchema = z.strictObject({
  contrast: unit.default(0), saturation: unit.default(0), temperature: unit.default(0), tint: unit.default(0),
  lift: channels(-0.5, 0.5).default(0), gamma: channels(0.2, 5).default(1), gain: channels(0, 2).default(1),
});
export const LOOK_PRESET_NAMES = ["clean", "keynote", "film", "teal-orange", "noir", "neon", "pastel"] as const;
export const LookSchema = z.strictObject({
  preset: z.enum(LOOK_PRESET_NAMES).optional(),
  grade: GradeFieldsSchema.optional(),
  grain: z.strictObject({ amount: z.number().finite().min(0).max(1), size: z.number().finite().min(0.5).max(4).default(1) }).optional(),
  vignette: z.strictObject({ amount: z.number().finite().min(0).max(1), softness: z.number().finite().min(0).max(1).default(0.5) }).optional(),
  letterbox: z.strictObject({ aspect: z.number().finite().min(1).max(4) }).optional(),
  // Export finishing (Node, per frame): previewed with `velora shot --finish`.
  bloom: z.strictObject({ threshold: z.number().finite().min(0).max(1).default(0.8), intensity: z.number().finite().min(0).max(2), radius: z.number().finite().min(1).max(64).default(16) }).optional(),
  halation: z.strictObject({ amount: z.number().finite().min(0).max(1), radius: z.number().finite().min(1).max(64).default(12) }).optional(),
  chromaticAberration: z.number().finite().min(0).max(12).optional(),
  sharpen: z.number().finite().min(0).max(2).optional(),
  lut: z.string().min(1).max(256).regex(/\.cube$/i, "Use a project-relative .cube file.").optional(),
});
export type Look = z.output<typeof LookSchema>;
export type LookInput = z.input<typeof LookSchema>;
export type ResolvedLook = Omit<Look, "preset" | "grade"> & { grade: z.output<typeof GradeSchema> };
export const LOOK_PRESETS: Readonly<Record<(typeof LOOK_PRESET_NAMES)[number], LookInput>> = Object.freeze({
  clean: {},
  keynote: { grade: { contrast: 0.08, lift: -0.02 }, vignette: { amount: 0.25, softness: 0.6 }, sharpen: 0.3 },
  film: { grade: { contrast: 0.12, saturation: -0.08, temperature: 0.12, lift: 0.03, gain: 0.98 }, grain: { amount: 0.12, size: 1.2 }, vignette: { amount: 0.3, softness: 0.55 }, halation: { amount: 0.25, radius: 12 } },
  "teal-orange": { grade: { contrast: 0.1, saturation: 0.1, lift: [-0.02, 0.01, 0.04], gain: [1.05, 1, 0.92] } },
  noir: { grade: { contrast: 0.3, saturation: -1 }, grain: { amount: 0.15, size: 1.4 }, vignette: { amount: 0.4, softness: 0.5 } },
  neon: { grade: { contrast: 0.1, saturation: 0.35 }, bloom: { threshold: 0.7, intensity: 0.8, radius: 18 } },
  pastel: { grade: { contrast: -0.2, saturation: -0.2, lift: 0.08 } },
});
/** Preset values overlaid with explicit fields (field by field; grade merges per key). */
export function resolveLook(input: LookInput | undefined): ResolvedLook | undefined {
  if (!input) return undefined;
  const look = LookSchema.parse(input);
  const base = look.preset ? LookSchema.parse(LOOK_PRESETS[look.preset]) : LookSchema.parse({});
  const { preset: _preset, grade, ...rest } = look;
  const { preset: _basePreset, grade: baseGrade, ...baseRest } = base;
  return { ...baseRest, ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)), grade: GradeSchema.parse({ ...baseGrade, ...grade }) };
}
export const hasBrowserLook = (look: ResolvedLook | undefined) => !!look && (!!look.grain || !!look.vignette || !!look.letterbox ||
  look.grade.contrast !== 0 || look.grade.saturation !== 0 || look.grade.temperature !== 0 || look.grade.tint !== 0 ||
  JSON.stringify([look.grade.lift, look.grade.gamma, look.grade.gain]) !== "[0,1,1]");
export const hasExportFinishing = (look: ResolvedLook | undefined) => !!look && (!!look.bloom || !!look.halation || !!look.chromaticAberration || !!look.sharpen || !!look.lut);

type M = number[]; // 5x5 row-major affine color matrix (rgba + offset)
const identity = (): M => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const multiply = (a: M, b: M): M => Array.from({ length: 25 }, (_, i) => { const r = Math.floor(i / 5), c = i % 5; let s = 0; for (let k = 0; k < 5; k++) s += a[r * 5 + k] * b[k * 5 + c]; return s; });
/** feColorMatrix values (4x5) for contrast, then saturation (Rec. 709 luma), then temperature/tint. */
export function gradeColorMatrix(grade: Partial<z.output<typeof GradeSchema>>): number[] {
  const c = 1 + (grade.contrast ?? 0), offset = 0.5 * (1 - c);
  const contrast = [c, 0, 0, 0, offset, 0, c, 0, 0, offset, 0, 0, c, 0, offset, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
  const s = 1 + (grade.saturation ?? 0), lr = 0.2126, lg = 0.7152, lb = 0.0722;
  const saturation = [lr * (1 - s) + s, lg * (1 - s), lb * (1 - s), 0, 0, lr * (1 - s), lg * (1 - s) + s, lb * (1 - s), 0, 0, lr * (1 - s), lg * (1 - s), lb * (1 - s) + s, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
  const t = grade.temperature ?? 0, g = grade.tint ?? 0;
  const balance = [1 + 0.1 * t, 0, 0, 0, 0, 0, 1 - 0.1 * g, 0, 0, 0, 0, 0, 1 - 0.1 * t, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
  const m = multiply(balance, multiply(saturation, multiply(contrast, identity())));
  return m.slice(0, 20).map(value => Math.round(value * 1e6) / 1e6);
}
/** feComponentTransfer table for one channel: out = gain * (x + lift * (1 - x)) ^ (1 / gamma). */
export function gradeTransferTable(lift: number, gamma: number, gain: number, samples = 33): number[] {
  return Array.from({ length: samples }, (_, i) => {
    const x = i / (samples - 1);
    const lifted = Math.max(0, Math.min(1, x + lift * (1 - x)));
    return Math.round(Math.max(0, Math.min(1, gain * lifted ** (1 / gamma))) * 1e5) / 1e5;
  });
}
export const channelValue = (value: number | readonly number[], index: number) => typeof value === "number" ? value : value[index];
/** Deterministic grain tile offset for one frame: same seed and frame, same pixels. */
export function grainOffset(seed: number, frame: number): { x: number; y: number } {
  const rng = createRng(((seed >>> 0) ^ Math.imul(frame + 1, 0x9e3779b1)) >>> 0);
  return { x: Math.floor(rng() * 256), y: Math.floor(rng() * 256) };
}
export type CubeLut = { size: number; domainMin: [number, number, number]; domainMax: [number, number, number]; table: Float32Array };
/** Parse an Adobe/Resolve .cube 3D LUT (red varies fastest). */
export function parseCube(text: string): CubeLut {
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0], domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^TITLE\b/i.test(line)) continue;
    const parts = line.split(/\s+/);
    if (/^LUT_3D_SIZE$/i.test(parts[0])) size = Number(parts[1]);
    else if (/^LUT_1D_SIZE$/i.test(parts[0])) throw new Error("1D LUTs are not supported; export a 3D .cube.");
    else if (/^DOMAIN_MIN$/i.test(parts[0])) domainMin = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    else if (/^DOMAIN_MAX$/i.test(parts[0])) domainMax = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    else if (/^[-+.\d]/.test(parts[0]) && parts.length === 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }
  if (!Number.isInteger(size) || size < 2 || size > 128) throw new Error("LUT_3D_SIZE must be an integer from 2 to 128.");
  if (values.length !== size ** 3 * 3 || values.some(value => !Number.isFinite(value))) throw new Error(`Expected ${size ** 3} RGB rows for LUT_3D_SIZE ${size}.`);
  return { size, domainMin, domainMax, table: Float32Array.from(values) };
}
