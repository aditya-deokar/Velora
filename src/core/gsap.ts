import { z } from "zod";
import { MotionTrackSchema, type MotionTrack } from "./motion";

/** SOURCE OF TRUTH: GSAP easing map, timeline converter, clock detection.
 * WHAT: lossy-but-explicit GSAP→Velora mappings plus forbidden-clock detection.
 * WHY: agents reuse GSAP knowledge without smuggling page-scroll clocks into renders.
 * WHERE: validate rejects forbidden clocks; authors paste converter output into recipes.
 * Reference, don't reimplement: deep GSAP API lives in the installed gsap-*
 * skills. Only three easings exist here (linear, easeInOut, cinematic); GSAP
 * easings without an equivalent are rejected, never silently remapped.
 * ScrollTrigger, ticker clocks and rAF loops are forbidden in render paths:
 * video time comes only from the canonical frame clock.
 */
export const GSAP_EASING_MAP: Record<string, "linear" | "easeInOut" | "cinematic"> = {
  "linear": "linear", "none": "linear", "power0.out": "linear",
  "power1.inOut": "easeInOut", "power1.in": "easeInOut", "power2.in": "easeInOut", "power2.inOut": "easeInOut",
  "sine.in": "easeInOut", "sine.inOut": "easeInOut", "quad.inOut": "easeInOut", "cubic.inOut": "easeInOut",
  "power1.out": "cinematic", "power2.out": "cinematic", "power3.out": "cinematic", "power4.out": "cinematic",
  "expo.out": "cinematic", "sine.out": "cinematic", "circ.out": "cinematic",
};
export function mapGsapEasing(ease: string): { easing: "linear" | "easeInOut" | "cinematic" } | { issue: string } {
  const mapped = GSAP_EASING_MAP[ease.trim()];
  if (!mapped) return { issue: `GSAP easing "${ease}" has no Velora equivalent (elastic, bounce, back, rough and stepped easings cannot replay on the frame clock). Pick linear, easeInOut or cinematic.` };
  return { easing: mapped };
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
