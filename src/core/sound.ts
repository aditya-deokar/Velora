import { z } from "zod";

/** SOURCE OF TRUTH: SFX_PRESET_NAMES, SfxEntrySchema, sfxGraph, LoudnessSchema, DEFAULT_LOUDNESS.
 * WHAT: procedural sound design (whoosh, swish, click, pop, tick, riser, impact, shimmer) described as
 * FFmpeg lavfi graphs from seeded noise and closed-form oscillators, plus the loudness target a mix
 * is normalized to.
 * WHY: transitions want sound; synthesized presets are royalty-free by construction and replay
 * byte-identically for the same seed, so renders stay reproducible with no bundled audio.
 * WHERE: compositions place `sfx[]` entries (and transition.sfx at cuts); export/services renders the
 * graphs to temp WAVs and mixes them; the mix is loudness-normalized in two passes.
 */
export const SFX_PRESET_NAMES = ["whoosh", "swish", "click", "pop", "tick", "riser", "impact", "shimmer"] as const;
export type SfxPreset = (typeof SFX_PRESET_NAMES)[number];
export const SfxEntrySchema = z.strictObject({
  id: z.string().min(1).max(128),
  preset: z.enum(SFX_PRESET_NAMES),
  // Where the sound's peak lands on the global timeline.
  atMs: z.number().finite().nonnegative().max(120_000),
  gainDb: z.number().finite().min(-40).max(6).default(-6),
  seed: z.number().int().nonnegative().max(4_294_967_295).default(1),
});
export type SfxEntry = z.output<typeof SfxEntrySchema>;
export const SAMPLE_RATE = 48_000;
/** Each preset: duration, where its peak sits (so atMs lands on the hit), and the lavfi source graph. */
export const SFX_PRESETS: Readonly<Record<SfxPreset, { durationMs: number; peakMs: number; graph: (seed: number) => string }>> = Object.freeze({
  whoosh: { durationMs: 700, peakMs: 420, graph: seed => `anoisesrc=c=pink:r=${SAMPLE_RATE}:a=0.6:d=0.7:s=${seed},highpass=f=250,lowpass=f=3800,afade=t=in:d=0.42:curve=exp,afade=t=out:st=0.42:d=0.28:curve=qsin` },
  swish: { durationMs: 350, peakMs: 180, graph: seed => `anoisesrc=c=white:r=${SAMPLE_RATE}:a=0.45:d=0.35:s=${seed},highpass=f=1800,afade=t=in:d=0.18:curve=exp,afade=t=out:st=0.18:d=0.17` },
  click: { durationMs: 60, peakMs: 0, graph: () => `aevalsrc=exprs='0.8*sin(2*PI*2200*t)*exp(-140*t)':s=${SAMPLE_RATE}:d=0.06` },
  pop: { durationMs: 160, peakMs: 0, graph: () => `aevalsrc=exprs='0.8*sin(2*PI*(620-2400*t)*t)*exp(-26*t)':s=${SAMPLE_RATE}:d=0.16` },
  tick: { durationMs: 40, peakMs: 0, graph: () => `aevalsrc=exprs='0.6*sin(2*PI*4200*t)*exp(-220*t)':s=${SAMPLE_RATE}:d=0.04` },
  riser: { durationMs: 1600, peakMs: 1600, graph: seed => `aevalsrc=exprs='0.35*sin(2*PI*(180*t+260*t*t))':s=${SAMPLE_RATE}:d=1.6[tone];anoisesrc=c=white:r=${SAMPLE_RATE}:a=0.18:d=1.6:s=${seed},highpass=f=2500[air];[tone][air]amix=inputs=2:normalize=0,afade=t=in:d=1.4:curve=exp` },
  impact: { durationMs: 1100, peakMs: 0, graph: seed => `aevalsrc=exprs='0.9*sin(2*PI*52*t)*exp(-3.2*t)':s=${SAMPLE_RATE}:d=1.1[sub];anoisesrc=c=brown:r=${SAMPLE_RATE}:a=0.7:d=1.1:s=${seed},lowpass=f=900,afade=t=out:d=0.35[body];[sub][body]amix=inputs=2:normalize=0` },
  shimmer: { durationMs: 1300, peakMs: 300, graph: () => `aevalsrc=exprs='0.2*(sin(2*PI*2093*t)+sin(2*PI*3136*t)+sin(2*PI*4186*t))*(0.6+0.4*sin(2*PI*9*t))':s=${SAMPLE_RATE}:d=1.3,afade=t=in:d=0.3,afade=t=out:st=0.5:d=0.8` },
});
/** The lavfi filter_complex for one entry, ending in a labeled mono stream at the entry's gain. */
export function sfxGraph(entry: Pick<SfxEntry, "preset" | "gainDb" | "seed">, label = "sfx"): string {
  return `${SFX_PRESETS[entry.preset].graph(entry.seed)},aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=mono,volume=${entry.gainDb}dB[${label}]`;
}
/** When the sound file must start so its peak lands on atMs (clamped at 0). */
export function sfxStartMs(entry: Pick<SfxEntry, "preset" | "atMs">): number {
  return Math.max(0, entry.atMs - SFX_PRESETS[entry.preset].peakMs);
}
export const LoudnessSchema = z.strictObject({
  // Integrated loudness (LUFS) and true peak (dBTP); -14 / -1 suits streaming and social platforms.
  integrated: z.number().finite().min(-36).max(-5).default(-14),
  truePeak: z.number().finite().min(-9).max(0).default(-1),
  range: z.number().finite().min(1).max(20).default(11),
});
export type Loudness = z.output<typeof LoudnessSchema>;
export const DEFAULT_LOUDNESS: Loudness = LoudnessSchema.parse({});
