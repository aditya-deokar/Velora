/** SOURCE OF TRUTH: flashRisk, bandingScore, FLASH_LIMIT_PER_SECOND.
 * WHAT: an approximation of WCAG 2.3.1 (three flashes or below) over a coarse luminance grid of
 * consecutive frames, general and red flashes, plus an advisory banding score for smooth 8-bit gradients.
 * WHY: launch films strobe, flash and cut fast; a render must not ship a seizure risk, and large
 * gradients (backdrops, glows) band visibly after encoding unless grain or 10-bit hides the steps.
 * WHERE: `velora check` runs both over rendered frames or decoded video. This is an engineering
 * approximation (grid cells stand in for the 10-degree field); it is not a certification.
 */
export const FLASH_LIMIT_PER_SECOND = 3;
// A cell "flips" when its relative luminance swings by 10% of maximum and the darker state is below 0.8.
const FLASH_DELTA = 0.1, FLASH_DARK = 0.8;
// Flashing must cover at least this fraction of the frame (WCAG's quarter of a 10-degree field, at typical viewing).
export const FLASH_AREA = 0.1;
const linear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export type GridFrame = { timeMs: number; rgb: Uint8Array };
/**
 * Times of opposing luminance changes in one cell's series. A change counts when the value moves at least
 * `delta` from the anchor (the level at the last change) with the darker side below `darkLimit`, in the
 * opposite direction to the previous change; a continuing ramp only moves the anchor, so a fade never flashes.
 */
function transitions(series: number[], times: number[], delta: number, darkLimit: number): number[] {
  const found: number[] = [];
  let anchor = series[0], direction = 0;
  for (let i = 1; i < series.length; i++) {
    const value = series[i], change = value - anchor;
    if (Math.abs(change) >= delta && Math.min(value, anchor) < darkLimit) {
      const sign = Math.sign(change);
      if (sign !== direction) { found.push(times[i]); direction = sign; }
      anchor = value;
    } else if (direction !== 0 && Math.sign(change) === direction) anchor = value;
  }
  return found;
}
export type FlashReport = { pass: boolean; worst: number; atMs?: number; kind?: "general" | "red"; area: number };
/** Worst flash rate (flashes per any 1 s window) over cells covering at least FLASH_AREA of the frame. */
export function flashRisk(frames: readonly GridFrame[], cells: number): FlashReport {
  if (frames.length < 3) return { pass: true, worst: 0, area: 0 };
  const times = frames.map(frame => frame.timeMs);
  const general: number[][] = [], red: number[][] = [];
  for (let cell = 0; cell < cells; cell++) {
    const lum: number[] = [], redness: number[] = [];
    for (const frame of frames) {
      const r = frame.rgb[cell * 3], g = frame.rgb[cell * 3 + 1], b = frame.rgb[cell * 3 + 2];
      lum.push(0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b));
      // WCAG saturated red: R / (R + G + B) >= 0.8, scored by (R - G - B) * 320 on 0..1 values.
      const sum = r + g + b;
      redness.push(sum > 0 && r / sum >= 0.8 ? Math.max(0, (r - g - b) / 255) * 320 / 20 : 0);
    }
    general.push(transitions(lum, times, FLASH_DELTA, FLASH_DARK));
    red.push(transitions(redness, times, 1, Infinity));
  }
  let report: FlashReport = { pass: true, worst: 0, area: 0 };
  const scan = (series: number[][], kind: "general" | "red") => {
    const starts = [...new Set(series.flat())].sort((a, b) => a - b);
    for (const start of starts) {
      const rates = series.map(list => Math.floor(list.filter(t => t >= start && t < start + 1000).length / 2));
      // The rate shared by enough cells: the area-th largest per-cell flash count.
      const sorted = [...rates].sort((a, b) => b - a);
      const needed = Math.max(1, Math.ceil(FLASH_AREA * cells));
      const shared = sorted[needed - 1] ?? 0;
      if (shared > report.worst) report = { pass: shared <= FLASH_LIMIT_PER_SECOND, worst: shared, atMs: start, kind, area: rates.filter(rate => rate >= shared).length / cells };
    }
  };
  scan(general, "general");
  scan(red, "red");
  return report;
}
/**
 * Fraction of a frame in smooth gradient plateaus: horizontal runs of one 8-bit level at least `minRun`
 * pixels long that step by exactly one level into the next run. High values band visibly once encoded.
 */
export function bandingScore(pixels: Uint8Array, width: number, height: number, minRun = 24): number {
  let banded = 0;
  const step = Math.max(1, Math.floor(height / 120)); // sample rows: banding spans many rows
  let sampled = 0;
  for (let y = 0; y < height; y += step) {
    sampled += width;
    let runStart = 0, previousRun = -1, previousLevel = -1;
    const level = (x: number) => { const o = (y * width + x) * 4; return Math.round(0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2]); };
    let current = level(0);
    for (let x = 1; x <= width; x++) {
      const value = x < width ? level(x) : -999;
      if (value === current) continue;
      const run = x - runStart;
      // A long flat run that meets a neighbor exactly one level away on either side.
      if (run >= minRun && (Math.abs(value - current) === 1 || (previousRun >= minRun && Math.abs(previousLevel - current) === 1))) banded += run;
      previousRun = run; previousLevel = current; current = value; runStart = x;
    }
  }
  return sampled ? banded / sampled : 0;
}
