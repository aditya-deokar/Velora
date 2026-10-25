import { z } from "zod";
import { createRng } from "./random";

/** SOURCE OF TRUTH: NoiseSchema, sampleNoise.
 * WHAT: seeded, smooth 1-D gradient noise summed over octaves (fractal) as a pure function of time.
 * WHY: handheld camera texture and gentle float need organic variation that still replays
 * byte-identically on every seek, export and machine.
 * WHERE: core/motion adds amplitude · sampleNoise(...) to position/rotation track values.
 */
export const NoiseSchema = z.strictObject({
  amplitude: z.number().finite().nonnegative().max(1000),
  frequency: z.number().finite().positive().max(30).default(0.5),
  octaves: z.number().int().min(1).max(4).default(2),
  seed: z.number().int().nonnegative().max(4_294_967_295).default(0),
});
export type Noise = z.output<typeof NoiseSchema>;
export type NoiseInput = z.input<typeof NoiseSchema>;

const gradients = new Map<number, Float64Array>();
function gradientTable(seed: number): Float64Array {
  let table = gradients.get(seed);
  if (!table) {
    const rng = createRng(seed);
    table = Float64Array.from({ length: 256 }, () => rng() * 2 - 1);
    gradients.set(seed, table);
  }
  return table;
}
function gradientNoise(table: Float64Array, x: number): number {
  const cell = Math.floor(x);
  const t = x - cell;
  const a = table[cell & 255] * t;
  const b = table[(cell + 1) & 255] * (t - 1);
  const fade = t * t * t * (t * (t * 6 - 15) + 10);
  return 2 * (a + (b - a) * fade);
}
/** Fractal noise in roughly -1..1 at authored time timeMs; identical for identical inputs. */
export function sampleNoise(input: NoiseInput, timeMs: number): number {
  const { frequency, octaves, seed } = NoiseSchema.parse(input);
  let total = 0, weight = 0, amplitude = 1, scale = 1;
  for (let octave = 0; octave < octaves; octave++) {
    total += amplitude * gradientNoise(gradientTable((seed + octave * 0x9e3779b1) >>> 0), (timeMs / 1000) * frequency * scale + octave * 17.31);
    weight += amplitude;
    amplitude /= 2;
    scale *= 2;
  }
  return total / weight;
}
