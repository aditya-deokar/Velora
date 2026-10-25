import { z } from "zod";
import { MotionTrackSchema, type MotionTrack } from "./motion";
import type { Easing } from "./easing";

/** SOURCE OF TRUTH: GSAP easing map, timeline converter, clock detection.
 * WHAT: GSAP ease names mapped onto Velora easings, a tween converter and forbidden-clock detection.
 * WHY: agents reuse GSAP knowledge without smuggling page-scroll clocks into renders.
 * WHERE: validate rejects forbidden clocks; authors paste converter output into recipes.
 * Reference, don't reimplement: deep GSAP API lives in the installed gsap-* skills. Every
 * easing is a pure function of progress, so back, elastic, bounce and steps replay exactly on
 * the frame clock. Only parameterized configs and GSAP plugin eases (rough, slow, expoScale,
 * CustomEase) have no equivalent and are rejected, never silently remapped.
 * ScrollTrigger, ticker clocks and rAF loops are forbidden in render paths:
 * video time comes only from the canonical frame clock.
 */
const powers: Record<string, string> = { power1: "quad", power2: "cubic", power3: "quart", power4: "quint", quad: "quad", cubic: "cubic", quart: "quart", quint: "quint", strong: "quint" };
const families = new Set(["sine", "expo", "circ", "back", "elastic", "bounce"]);
// Common literal names, kept for agents and skills that look up a fixed table.
export const GSAP_EASING_MAP: Record<string, Easing> = {
  linear: "linear", none: "linear", "power0.in": "linear", "power0.out": "linear", "power0.inOut": "linear",
  "power1.out": "quad.out", "power2.out": "cubic.out", "power3.out": "quart.out", "power4.out": "quint.out",
  "power1.inOut": "quad.inOut", "power2.inOut": "cubic.inOut", "power3.inOut": "quart.inOut", "power4.inOut": "quint.inOut",
  "expo.out": "expo.out", "sine.inOut": "sine.inOut", "back.out": "back.out", "elastic.out": "elastic.out", "bounce.out": "bounce.out",
};
export function mapGsapEasing(ease: string): { easing: Easing } | { issue: string } {
  const name = ease.trim();
  if (GSAP_EASING_MAP[name]) return { easing: GSAP_EASING_MAP[name] };
  const steps = /^steps\((\d+)\)$/.exec(name);
  if (steps && Number(steps[1]) >= 1 && Number(steps[1]) <= 240) return { easing: { steps: Number(steps[1]), jump: "end" } };
  const match = /^([a-z0-9]+)(?:\.(in|out|inOut))?$/.exec(name);
  if (match) {
    const direction = match[2] ?? "out";
    if (match[1] === "power0") return { easing: "linear" };
    const family = powers[match[1]] ?? (families.has(match[1]) ? match[1] : undefined);
    if (family) return { easing: `${family}.${direction}` as Easing };
  }
  if (/\(/.test(name)) return { issue: `GSAP easing "${ease}" uses a parameterized config Velora does not replay. Use the default ${name.split("(")[0]}, a {cubicBezier:[x1,y1,x2,y2]} or a {spring:{stiffness,damping,mass}} easing.` };
  return { issue: `GSAP easing "${ease}" has no Velora equivalent (rough, slow, expoScale and CustomEase are plugin eases). Use a named family, cubicBezier or spring easing.` };
}
export const GsapTweenSchema = z.strictObject({
  target: z.string().min(1),
  property: z.string().min(1),
  from: z.number().finite(),
  to: z.number().finite(),
  at: z.number().finite().nonnegative().default(0),
  dur: z.number().finite().positive(),
  ease: z.string().default("power1.out"),
});
export type GsapTween = z.input<typeof GsapTweenSchema>;
// Convert GSAP-style tweens (seconds) to Velora motion tracks (milliseconds).
// from/to are required: the converter never guesses current values.
export function gsapToVelora(tweens: unknown): { tracks: MotionTrack[] } | { issues: { code: string; path: string; message: string }[] } {
  const parsed = z.array(GsapTweenSchema).min(1).safeParse(tweens);
  if (!parsed.success)
    return { issues: parsed.error.issues.map((issue) => ({ code: "ERR_ANIMATION_CLOCK", path: `gsap.${issue.path.join(".")}`, message: issue.message })) };
  const issues: { code: string; path: string; message: string }[] = [];
  const tracks: MotionTrack[] = [];
  parsed.data.forEach((tween, index) => {
    const mapped = mapGsapEasing(tween.ease);
    if ("issue" in mapped) {
      issues.push({ code: "ERR_ANIMATION_CLOCK", path: `gsap.${index}.ease`, message: mapped.issue });
      return;
    }
    const atMs = tween.at * 1000, endMs = (tween.at + tween.dur) * 1000;
    const candidate = {
      target: { kind: "surface", id: tween.target },
      property: tween.property,
      keyframes: [
        { timeMs: atMs, value: tween.from, easing: mapped.easing },
        { timeMs: endMs, value: tween.to },
      ],
    };
    const track = MotionTrackSchema.safeParse(candidate);
    if (!track.success)
      issues.push(...track.error.issues.map((issue) => ({ code: "ERR_ANIMATION_CLOCK", path: `gsap.${index}.${issue.path.join(".")}`, message: `${tween.target}.${tween.property}: ${issue.message}` })));
    else tracks.push(track.data);
  });
  return issues.length ? { issues } : { tracks };
}
export type ForbiddenClock = "scrolltrigger" | "ticker" | "raf-loop";
// Static detection of render-path clocks in scene/component source. Pure text
// scan: ScrollTrigger, gsap.ticker (or any .ticker.), and requestAnimationFrame
// loops all own a competing clock. Matches are evidence, returned with kind.
export function detectForbiddenClock(source: string): { kind: ForbiddenClock; line: number }[] {
  const found: { kind: ForbiddenClock; line: number }[] = [];
  const lines = source.split("\n");
  lines.forEach((text, i) => {
    const line = i + 1;
    if (/scrolltrigger/i.test(text)) found.push({ kind: "scrolltrigger", line });
    else if (/\.ticker\s*\./.test(text) || /gsap\s*\.\s*ticker/i.test(text)) found.push({ kind: "ticker", line });
    else if (/requestAnimationFrame\s*\(/.test(text)) found.push({ kind: "raf-loop", line });
  });
  return found;
}
