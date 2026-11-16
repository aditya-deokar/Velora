import type { KeyGlyph } from "./Rows";

/** Keyframe glyphs (EDITOR-UX §6): ◆ linear, ⧗ ease, ● auto, ■ hold, ✱ spring/steps; smooth tracks draw
 * hollow circles on a rail. */
export function KeyGlyphShape({ glyph, x, y, selected, smooth }: { glyph: KeyGlyph; x: number; y: number; selected: boolean; smooth: boolean }) {
  const fill = selected ? "var(--ve-sel)" : "var(--ve-key)";
  const common = { className: "ve-kf-glyph", stroke: selected ? "#fff" : "#0006", strokeWidth: 1 };
  if (smooth) return <circle {...common} cx={x} cy={y} r={4.5} fill="none" stroke={fill} strokeWidth={2}/>;
  switch (glyph) {
    case "linear": return <path {...common} d={`M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`} fill={fill}/>;
    case "auto": return <circle {...common} cx={x} cy={y} r={5} fill={fill}/>;
    case "hold": return <rect {...common} x={x - 5} y={y - 5} width={10} height={10} fill={fill}/>;
    case "spring": return <path {...common} d={`M${x} ${y - 6}L${x + 2} ${y - 2}L${x + 6} ${y}L${x + 2} ${y + 2}L${x} ${y + 6}L${x - 2} ${y + 2}L${x - 6} ${y}L${x - 2} ${y - 2}Z`} fill={fill}/>;
    default: return <path {...common} d={`M${x - 5} ${y - 6}H${x + 5}L${x - 5} ${y + 6}H${x + 5}Z`} fill={fill}/>;
  }
}
export const glyphLabel: Record<KeyGlyph, string> = { linear: "linear", ease: "eased", auto: "auto bezier", hold: "hold", spring: "spring or steps" };
