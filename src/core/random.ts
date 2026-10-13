/** SOURCE OF TRUTH: createRng, rngRange, rngInt, hashSeed, deterministic random.
 * WHAT: a seeded mulberry32 generator plus range/integer helpers and string hashing.
 * WHY: every procedural choice in renders must replay byte-identically from the composition seed.
 * WHERE: core/procedural consumes it; render manifests record the seed that produced each frame.
 * Pure: no unseeded randomness, no wall-clock, no layout reads. Same seed always yields the same sequence.
 */
export type Rng = () => number;
// Mulberry32: small, fast and fully deterministic across platforms for the
// same 32-bit seed. State lives in the closure; each generator is independent.
export function createRng(seed: number): Rng {
  let state = Math.floor(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
// Stable string hash (FNV-1a) so named content maps to a reproducible seed.
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
export function rngRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}
export function rngInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rngRange(rng, min, max + 1));
}
export function rngPick<T>(rng: Rng, values: readonly T[]): T {
  if (!values.length) throw new Error("rngPick needs at least one value.");
  return values[Math.floor(rng() * values.length)];
}
