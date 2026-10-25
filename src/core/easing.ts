import { z } from "zod";

/** SOURCE OF TRUTH: EasingSchema, applyEasing, EASING_NAMES.
 * WHAT: the easing vocabulary (named curves, cubic-bezier, damped spring, steps, hold) and its
 * single evaluator from segment progress 0..1 to eased progress.
 * WHY: camera operators and motion designers need graph-editor control (overshoot, settle, snap)
 * while every renderer replays the identical pure function of frame time.
 * WHERE: core/motion evaluates keyframe segments and smooth-track easing through applyEasing;
 * core/gsap maps GSAP ease names onto these values. No clock, no randomness, no state.
 * Legacy names keep their exact math: easeInOut is smoothstep and cinematic is smootherstep.
 */
const families = ["sine", "quad", "cubic", "quart", "quint", "expo", "circ", "back", "elastic", "bounce"] as const;
const directions = ["in", "out", "inOut"] as const;
type Family = (typeof families)[number];
type Direction = (typeof directions)[number];
export const EASING_NAMES = Object.freeze([
  "linear", "easeInOut", "cinematic", "hold",
  ...families.flatMap(family => directions.map(direction => `${family}.${direction}` as const)),
] as const);
const finite = z.number().finite();
export const EasingSchema = z.union([
  z.enum(EASING_NAMES),
  // CSS / After Effects graph-editor parity: x stays inside 0..1 so time is monotonic; y may overshoot.
  z.strictObject({ cubicBezier: z.tuple([finite.min(0).max(1), finite.min(-5).max(5), finite.min(0).max(1), finite.min(-5).max(5)]) }),
  // A damped spring settling from 0 to 1 within the segment; under-damped springs overshoot by design.
  z.strictObject({ spring: z.strictObject({
    stiffness: finite.positive().max(10_000).default(170),
    damping: finite.positive().max(1_000).default(26),
    mass: finite.positive().max(100).default(1),
  }) }),
  z.strictObject({ steps: z.number().int().min(1).max(240), jump: z.enum(["start", "end"]).default("end") }),
]);
export type Easing = z.output<typeof EasingSchema>;
export type EasingInput = z.input<typeof EasingSchema>;

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const powers: Partial<Record<Family, number>> = { quad: 2, cubic: 3, quart: 4, quint: 5 };
function easeIn(family: Family, t: number): number {
  const power = powers[family];
  if (power) return t ** power;
  switch (family) {
    case "sine": return 1 - Math.cos((t * Math.PI) / 2);
    case "expo": return t === 0 ? 0 : 2 ** (10 * t - 10);
    case "circ": return 1 - Math.sqrt(1 - t * t);
    case "back": { const c1 = 1.70158; return (c1 + 1) * t ** 3 - c1 * t * t; }
    case "elastic": return t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3));
    default: return 1 - bounceOut(1 - t);
  }
}
function bounceOut(t: number): number {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
function named(family: Family, direction: Direction, t: number): number {
  if (direction === "in") return easeIn(family, t);
  if (direction === "out") return 1 - easeIn(family, 1 - t);
  return t < 0.5 ? easeIn(family, 2 * t) / 2 : 1 - easeIn(family, 2 - 2 * t) / 2;
}
// Solve x(s) = progress for the bezier parameter s, then return y(s): Newton steps with a
// bisection fallback (the same monotonic-inversion approach as cinematicTimeAtProgress).
function cubicBezier([x1, y1, x2, y2]: readonly [number, number, number, number], progress: number): number {
  const curve = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const slope = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
  let s = progress;
  for (let i = 0; i < 8; i++) {
    const error = curve(x1, x2, s) - progress;
    if (Math.abs(error) < 1e-7) return curve(y1, y2, s);
    const derivative = slope(x1, x2, s);
    if (Math.abs(derivative) < 1e-6) break;
    s = Math.min(1, Math.max(0, s - error / derivative));
  }
  let low = 0, high = 1;
  for (let i = 0; i < 48; i++) {
    s = (low + high) / 2;
    if (curve(x1, x2, s) < progress) low = s; else high = s;
  }
  return curve(y1, y2, (low + high) / 2);
}
// Closed-form unit step response of m·x'' + c·x' + k·x = k, time-scaled so the
// envelope decays to 0.1% at the segment end; the segment end returns exactly 1.
function spring({ stiffness, damping, mass }: { stiffness: number; damping: number; mass: number }, progress: number): number {
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const decay = zeta < 1 ? zeta * omega : omega * (zeta - Math.sqrt(zeta * zeta - 1));
  const tau = progress * (Math.log(1000) / decay);
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * tau) * (Math.cos(damped * tau) + ((zeta * omega) / damped) * Math.sin(damped * tau));
  }
  if (zeta === 1) return 1 - Math.exp(-omega * tau) * (1 + omega * tau);
  const root = omega * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * omega + root, r2 = -zeta * omega - root;
  return 1 - (r1 * Math.exp(r2 * tau) - r2 * Math.exp(r1 * tau)) / (r1 - r2);
}
/** Map segment progress to eased progress. Total and finite; exactly 0 at 0 and 1 at 1. */
export function applyEasing(easing: Easing, progress: number): number {
  if (!(progress > 0)) return 0;
  if (progress >= 1) return 1;
  if (typeof easing === "string") {
    if (easing === "linear") return progress;
    if (easing === "easeInOut") return smoothstep(progress);
    if (easing === "cinematic") return smootherstep(progress);
    if (easing === "hold") return 0;
    const [family, direction] = easing.split(".") as [Family, Direction];
    return named(family, direction, progress);
  }
  if ("cubicBezier" in easing) return cubicBezier(easing.cubicBezier, progress);
  if ("spring" in easing) return spring(easing.spring, progress);
  return easing.jump === "start" ? Math.min(1, Math.ceil(progress * easing.steps) / easing.steps) : Math.floor(progress * easing.steps) / easing.steps;
}
/** True when the curve leaves 0..1 (overshoot), which reads as jitter on camera tracks. */
export function easingOvershoots(easing: Easing): boolean {
  if (typeof easing === "string") return /^(?:back|elastic)\./.test(easing);
  if ("cubicBezier" in easing) return easing.cubicBezier[1] < 0 || easing.cubicBezier[1] > 1 || easing.cubicBezier[3] < 0 || easing.cubicBezier[3] > 1;
  if ("spring" in easing) return easing.spring.damping < 2 * Math.sqrt(easing.spring.stiffness * easing.spring.mass);
  return false;
}
