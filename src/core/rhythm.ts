/** SOURCE OF TRUTH: analyzeRhythm, snapToBeats, RHYTHM_SAMPLE_RATE.
 * WHAT: beat tracking for music beds: STFT (1024 / hop 512, Hann) → half-wave-rectified log spectral flux →
 * adaptive median threshold onsets (refined to the sample in the time domain) → tempo by autocorrelation
 * of the flux envelope over 60-180 BPM → a beat grid fitted to the onsets by least squares → downbeats
 * assuming 4/4. Plus the pure cut-snapping plan used by `velora compose snap`.
 * WHY: cuts that land on the beat feel edited; this is deterministic (no randomness) and dependency-free.
 * WHERE: export services decode mono PCM with FFmpeg; `velora audio beats` and `compose snap` call these;
 * editorial review flags off-beat cuts against composition markers.
 */
export const RHYTHM_SAMPLE_RATE = 22_050;
const FRAME = 1024, HOP = 512;
export type RhythmReport = { bpm: number; confidence: number; beats: number[]; downbeats: number[]; onsets: number[]; durationMs: number };

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) for (let k = 0; k < size / 2; k++) {
      const wr = Math.cos(angle * k), wi = Math.sin(angle * k);
      const a = start + k, b = a + size / 2;
      const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
function spectralFlux(samples: Float32Array): Float64Array {
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  const window = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  const flux = new Float64Array(frames);
  let previous = new Float64Array(FRAME / 2);
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FRAME; i++) { re[i] = samples[f * HOP + i] * window[i]; im[i] = 0; }
    fft(re, im);
    const magnitude = new Float64Array(FRAME / 2);
    let sum = 0;
    for (let k = 0; k < FRAME / 2; k++) {
      magnitude[k] = Math.log1p(10 * Math.hypot(re[k], im[k]));
      if (f > 0) sum += Math.max(0, magnitude[k] - previous[k]);
    }
    flux[f] = sum;
    previous = magnitude;
  }
  return flux;
}
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
/** Onset peaks of the flux, each refined to the first sample reaching half the local peak amplitude. */
function onsetsOf(flux: Float64Array, samples: Float32Array, sampleRate: number): number[] {
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  const minGap = Math.round((0.05 * sampleRate) / HOP);
  const onsets: number[] = [];
  let last = -Infinity;
  for (let i = 1; i < flux.length - 1; i++) {
    const local = Array.from(flux.subarray(Math.max(0, i - 8), Math.min(flux.length, i + 9)));
    const threshold = median(local) + 0.3 * mean;
    if (flux[i] <= threshold || flux[i] < flux[i - 1] || flux[i] < flux[i + 1] || i - last < minGap) continue;
    last = i;
    // The click enters this frame's window: search the samples it covers (plus one hop before) for the attack.
    const from = Math.max(0, (i - 1) * HOP), to = Math.min(samples.length, i * HOP + FRAME);
    let peak = 0;
    for (let s = from; s < to; s++) peak = Math.max(peak, Math.abs(samples[s]));
    let attack = from;
    while (attack < to && Math.abs(samples[attack]) < peak * 0.5) attack++;
    const timeMs = (attack / sampleRate) * 1000;
    if (!onsets.length || timeMs - onsets[onsets.length - 1] > 30) onsets.push(timeMs);
  }
  return onsets;
}
/** Analyze mono PCM (any rate; 22 050 Hz recommended). Deterministic for the same samples. */
export function analyzeRhythm(samples: Float32Array, sampleRate = RHYTHM_SAMPLE_RATE): RhythmReport {
  const durationMs = (samples.length / sampleRate) * 1000;
  const flux = spectralFlux(samples);
  const onsets = onsetsOf(flux, samples, sampleRate);
  const frameRate = sampleRate / HOP;
  // Tempo: autocorrelation of the mean-removed flux over 60-180 BPM, with parabolic peak interpolation.
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  const centered = Array.from(flux, value => value - mean);
  const ac = (lag: number) => { let sum = 0; for (let i = lag; i < centered.length; i++) sum += centered[i] * centered[i - lag]; return sum / Math.max(1, centered.length - lag); };
  const minLag = Math.floor((60 / 180) * frameRate), maxLag = Math.ceil((60 / 60) * frameRate);
  let bestLag = 0, best = -Infinity;
  const energy = ac(0) || 1;
  for (let lag = minLag; lag <= maxLag; lag++) { const value = ac(lag); if (value > best) { best = value; bestLag = lag; } }
  if (!bestLag || onsets.length < 4) return { bpm: 0, confidence: 0, beats: [], downbeats: [], onsets, durationMs };
  const [a, b, c] = [ac(bestLag - 1), best, ac(bestLag + 1)];
  const shift = a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
  let period = ((bestLag + shift) / frameRate) * 1000;
  // Refine the period and phase from the onsets themselves: least squares on onsets matched to grid indices.
  let phase = onsets[0];
  const fit = () => { for (let pass = 0; pass < 3; pass++) {
    const pairs = onsets.map(time => [Math.round((time - phase) / period), time] as const).filter(([k, time]) => Math.abs(time - (phase + k * period)) < period * 0.25);
    if (pairs.length < 3) break;
    const n = pairs.length, sk = pairs.reduce((s, [k]) => s + k, 0), st = pairs.reduce((s, [, t]) => s + t, 0);
    const skk = pairs.reduce((s, [k]) => s + k * k, 0), skt = pairs.reduce((s, [k, t]) => s + k * t, 0);
    const slope = (n * skt - sk * st) / (n * skk - sk * sk);
    if (!Number.isFinite(slope) || slope <= 0) break;
    period = slope; phase = (st - slope * sk) / n;
  } };
  fit();
  // Octave check: if many onsets sit half-way between grid beats, the grid is at half tempo.
  for (let guard = 0; guard < 2; guard++) {
    const fractions = onsets.map(time => { const x = (time - phase) / period; return x - Math.floor(x); });
    const onGrid = fractions.filter(f => f < 0.12 || f > 0.88).length, between = fractions.filter(f => Math.abs(f - 0.5) < 0.12).length;
    if (between < 0.5 * onGrid || 60_000 / (period / 2) > 200) break;
    period /= 2;
    fit();
  }
  while (phase - period >= 0) phase -= period;
  while (phase < 0) phase += period;
  const beats: number[] = [];
  for (let t = phase; t < durationMs; t += period) beats.push(Math.round(t * 10) / 10);
  // Downbeats (4/4 assumed): the phase of four whose beats are loudest (peak amplitude just after the beat).
  const accentAt = (timeMs: number) => {
    const from = Math.max(0, Math.round(((timeMs - 10) / 1000) * sampleRate)), to = Math.min(samples.length, Math.round(((timeMs + 60) / 1000) * sampleRate));
    let peak = 0;
    for (let s = from; s < to; s++) peak = Math.max(peak, Math.abs(samples[s]));
    return peak;
  };
  const scores = [0, 1, 2, 3].map(offset => beats.filter((_, i) => i % 4 === offset).reduce((sum, beat) => sum + accentAt(beat), 0));
  const bar = scores.indexOf(Math.max(...scores));
  return { bpm: Math.round((60_000 / period) * 100) / 100, confidence: Math.max(0, Math.min(1, best / energy)), beats, downbeats: beats.filter((_, i) => i % 4 === bar), onsets, durationMs };
}
export type SnapChange = { id: string; field: "startMs" | "durationMs"; from: number; to: number; beatMs: number };
/**
 * Plan moving each cut (a segment's start, and the previous segment's end with it) onto the nearest beat
 * within tolerance. Segments stay butt-joined (overlap windows keep their length); the first start stays.
 */
export function snapToBeats(scenes: readonly { id: string; startMs: number; durationMs: number; overlapMs?: number }[], beats: readonly number[], toleranceMs = 120): { changes: SnapChange[]; unsnapped: string[] } {
  const ordered = [...scenes].sort((a, b) => a.startMs - b.startMs);
  const changes: SnapChange[] = [], unsnapped: string[] = [];
  const nearest = (time: number) => beats.reduce((best, beat) => Math.abs(beat - time) < Math.abs(best - time) ? beat : best, Infinity);
  let shift = 0;
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1], scene = ordered[i];
    const overlap = scene.overlapMs ?? 0;
    // The cut point: where B is fully on screen (end of an overlap window, or the hard cut).
    const cut = scene.startMs + shift + overlap;
    const beat = nearest(cut);
    const snapped = Number.isFinite(beat) && Math.abs(beat - cut) <= toleranceMs;
    if (!snapped) unsnapped.push(scene.id);
    const delta = snapped ? Math.round((beat - cut) * 10) / 10 : 0;
    if (delta !== 0) changes.push({ id: previous.id, field: "durationMs", from: previous.durationMs, to: Math.round((previous.durationMs + delta) * 10) / 10, beatMs: beat });
    // Every later segment carries the accumulated shift, so the edit stays joined.
    const start = Math.round((scene.startMs + shift + delta) * 10) / 10;
    if (start !== scene.startMs) changes.push({ id: scene.id, field: "startMs", from: scene.startMs, to: start, beatMs: snapped ? beat : cut });
    shift += delta;
  }
  return { changes, unsnapped };
}
