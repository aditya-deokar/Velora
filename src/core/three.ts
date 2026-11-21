import { z } from "zod";
import { detectThreeClocks, THREE_CLOCK_HINT } from "./gsap";

/** SOURCE OF TRUTH: WebGLSurface contract and time-discipline validation.
 * WHAT: the schema for time-driven WebGL leaves plus static source checks.
 * WHY: Three.js scenes must replay deterministically under the frame clock.
 * WHERE: WebGLSurface (react) renders under these bounds; validate scans sources.
 * A WebGL scene update is a pure function of video time: update(t) with the
 * composition seed. No rAF loop ownership, no ScrollTrigger, no wall-clock.
 * The capture bridge samples the canvas like any Surface leaf.
 */
export const WebGLSceneSchema = z.strictObject({
  seed: z.number().int().nonnegative().max(4_294_967_295).default(0),
  width: z.number().int().min(64).max(3840).multipleOf(2).default(1400),
  height: z.number().int().min(64).max(3840).multipleOf(2).default(980),
  pixelRatioCap: z.number().finite().min(1).max(2).default(1.5),
  antialias: z.boolean().default(true),
});
export type WebGLScene = z.output<typeof WebGLSceneSchema>;
export type WebGLIssue = { code: string; path: string; message: string };
// Static time-discipline scan of a WebGL scene source: rAF loops and ticker
// clocks break determinism; missing contexts fail at render with ERR_WEBGL_CONTEXT.
export function validateWebGLSource(source: string, path: string): WebGLIssue[] {
  const issues: WebGLIssue[] = [];
  const lines = source.split("\n");
  lines.forEach((text, i) => {
    if (/requestAnimationFrame\s*\(/.test(text))
      issues.push({ code: "ERR_WEBGL_TIMELOOP", path: `${path}:${i + 1}`, message: "requestAnimationFrame owns a competing clock. Drive the scene from the timeMs prop instead." });
    else if (/\.ticker\s*\./.test(text) || /gsap\s*\.\s*ticker/i.test(text))
      issues.push({ code: "ERR_WEBGL_TIMELOOP", path: `${path}:${i + 1}`, message: "Ticker clocks break frame determinism. Drive the scene from the timeMs prop instead." });
  });
  issues.push(...detectThreeClocks(source).map(hit => ({
    code: "ERR_WEBGL_TIMELOOP", path: `${path}:${hit.line}`,
    message: (hit.kind === "three-clock" ? "Three's clock breaks absolute seeks. " : "Accumulating frame delta breaks backward seeks. ") + THREE_CLOCK_HINT,
  })));
  return issues;
}
