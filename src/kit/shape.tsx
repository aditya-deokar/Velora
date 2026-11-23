import type { CSSProperties } from "react";
import { useAnimatable } from "../react";

/** SOURCE OF TRUTH: Shape.
 * WHAT: vector shapes (rect, ellipse, line, regular polygon) with animatable `width`, `height`,
 * `radius`, `sides`, `fill`, `stroke` and `strokeWidth` (`<id>.width`, …).
 * WHY: motion-graphics primitives keyed on the timeline like any property; pure functions of time.
 * WHERE: inside a Surface leaf.
 */
export type ShapeKind = "rect" | "ellipse" | "line" | "polygon";
export type ShapeProps = { id: string; kind?: ShapeKind; width?: number; height?: number; radius?: number; sides?: number;
  fill?: string; stroke?: string; strokeWidth?: number; style?: CSSProperties };
/** Regular polygon points inscribed in width × height (first vertex at the top). Exported for tests. */
export function polygonPoints(sides: number, width: number, height: number, inset = 0): string {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return `${(width / 2 + (width / 2 - inset) * Math.cos(angle)).toFixed(3)},${(height / 2 + (height / 2 - inset) * Math.sin(angle)).toFixed(3)}`;
  }).join(" ");
}
export function Shape({ id, kind = "rect", width = 200, height = 200, radius = 0, sides = 6, fill = "#7cc4ff", stroke = "#00000000", strokeWidth = 0, style }: ShapeProps) {
  const v = useAnimatable(id, {
    width: { type: "number", default: width, min: 0, max: 20_000, unit: "px" }, height: { type: "number", default: height, min: 0, max: 20_000, unit: "px" },
    radius: { type: "number", default: radius, min: 0, max: 10_000, unit: "px" }, sides: { type: "number", default: sides, min: 3, max: 64, step: 1 },
    fill: { type: "color", default: fill }, stroke: { type: "color", default: stroke }, strokeWidth: { type: "number", default: strokeWidth, min: 0, max: 400, unit: "px" },
  });
  const inset = v.strokeWidth / 2, w = Math.max(0, v.width), h = Math.max(0, v.height);
  const common = { fill: kind === "line" ? "none" : v.fill, stroke: v.stroke, strokeWidth: v.strokeWidth };
  return <svg data-velora-shape={id} data-kind={kind} width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible", display: "block", ...style }}>
    {kind === "rect" && <rect x={inset} y={inset} width={Math.max(0, w - v.strokeWidth)} height={Math.max(0, h - v.strokeWidth)} rx={Math.min(v.radius, w / 2, h / 2)} {...common}/>}
    {kind === "ellipse" && <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - inset)} ry={Math.max(0, h / 2 - inset)} {...common}/>}
    {kind === "line" && <line x1={0} y1={h / 2} x2={w} y2={h / 2} {...common} stroke={v.stroke === "#00000000" ? v.fill : v.stroke} strokeWidth={Math.max(1, v.strokeWidth)} strokeLinecap="round"/>}
    {kind === "polygon" && <polygon points={polygonPoints(v.sides, w, h, inset)} {...common}/>}
  </svg>;
}
