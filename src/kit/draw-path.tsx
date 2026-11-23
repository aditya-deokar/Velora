import type { CSSProperties } from "react";
import { useAnimatable } from "../react";

/** SOURCE OF TRUTH: DrawPath.
 * WHAT: trim paths: an SVG path stroked between normalized `start` and `end` (0–1) shifted by `offset`,
 * with animatable `strokeWidth` and `color` (`<id>.start`, `<id>.end`, `<id>.offset`, …).
 * WHY: draw-on lines, underlines and signatures keyed on the timeline; a pure function of time.
 * WHERE: inside a Surface leaf; pathLength is normalized to 1 so any path draws the same way.
 */
export type DrawPathProps = { id: string; d: string; viewBox: string; width: number; height: number; start?: number; end?: number; offset?: number;
  strokeWidth?: number; color?: string; linecap?: "butt" | "round" | "square"; fill?: string; style?: CSSProperties };
/** Dash pattern for a normalized trim (pathLength 1): visible length and dash offset. Exported for tests. */
export function trimDash(start: number, end: number, offset: number): { dasharray: string; dashoffset: number; visible: number } {
  const a = Math.min(start, end), b = Math.max(start, end);
  const visible = Math.min(1, Math.max(0, b - a));
  const shift = ((((a + offset) % 1) + 1) % 1);
  if (visible >= 1) return { dasharray: "none", dashoffset: 0, visible: 1 };
  return { dasharray: `${visible} ${1 - visible}`, dashoffset: -shift, visible };
}
export function DrawPath({ id, d, viewBox, width, height, start = 0, end = 1, offset = 0, strokeWidth = 4, color = "#ffffff", linecap = "round", fill = "none", style }: DrawPathProps) {
  const values = useAnimatable(id, {
    start: { type: "number", default: start, min: 0, max: 1 }, end: { type: "number", default: end, min: 0, max: 1 },
    offset: { type: "number", default: offset, min: -10, max: 10 }, strokeWidth: { type: "number", default: strokeWidth, min: 0, max: 400, unit: "px" },
    color: { type: "color", default: color },
  });
  const dash = trimDash(values.start, values.end, values.offset);
  return <svg data-velora-draw-path={id} viewBox={viewBox} width={width} height={height} style={{ overflow: "visible", display: "block", ...style }}>
    <path d={d} pathLength={1} fill={fill} stroke={values.color} strokeWidth={values.strokeWidth} strokeLinecap={linecap} strokeLinejoin="round"
      strokeDasharray={dash.dasharray} strokeDashoffset={dash.dashoffset} opacity={dash.visible > 0 ? 1 : 0}/>
  </svg>;
}
