import type { CSSProperties } from "react";
import { useAnimatableState, useSceneTime } from "../react";
import { animatableIdFor, useBrand, useReveal, useRevealOverride, useRevealScale } from "./brand";
const CURSOR_SPEC = { x: { type: "number", default: 0, unit: "px", label: "Cursor x" }, y: { type: "number", default: 0, unit: "px", label: "Cursor y" }, press: { type: "number", default: 0, label: "Press" } } as const;
import { segmentText } from "./type";

/** SOURCE OF TRUTH: Cursor, Typewriter, Spotlight, Callout.
 * WHAT: product-demo interaction drawn over real UI: a cursor following channel tracks with a press
 * ripple, typed text, a feathered dim-around-region spotlight and a labeled callout with a leader line.
 * WHY: demos read best when the viewer's eye is led; every value comes from channels or scene time,
 * so the camera "follow the click" (cursor-demo) and the cursor share one eased clock.
 * WHERE: cursor-demo and hand-written scenes; channels `<id>-x`, `<id>-y`, `<id>-press` are recipe tracks.
 */
export type CursorSkin = "arrow" | "pointer" | "hand";
const paths: Record<CursorSkin, string> = {
  arrow: "M2 2 L2 26 L8.5 19.5 L13 30 L17.5 28 L13 17.8 L22 17.8 Z",
  pointer: "M9 2 C10.6 2 12 3.4 12 5 L12 14 L20 15.5 C22 15.9 23 17.6 22.6 19.5 L21 27 C20.7 28.7 19.2 30 17.4 30 L11 30 C9.7 30 8.6 29.3 8 28.2 L3 19.5 C2.3 18.3 2.8 16.8 4 16.1 C5 15.6 6.2 15.8 7 16.6 L6 5 C6 3.4 7.4 2 9 2 Z",
  hand: "M8 14 L8 5 C8 3.5 10.5 3.5 10.5 5 L10.5 12 L10.5 3.5 C10.5 2 13 2 13 3.5 L13 12 L13 4.5 C13 3 15.5 3 15.5 4.5 L15.5 12.5 L15.5 7 C15.5 5.5 18 5.5 18 7 L18 19 C18 25 15 29 10.5 29 C7 29 5 27 3.5 24 L1.5 19 C1 17.5 3 16.5 4 17.5 L8 21 Z",
};
/** A cursor at (x, y) in its Surface's pixels: from props, or channels `<id>-x`/`<id>-y`; `<id>-press` (0..1) draws a ripple. */
export function Cursor({ id = "cursor", x, y, skin = "arrow", size = 30, color = "#ffffff", style }: { id?: string; x?: number; y?: number; skin?: CursorSkin; size?: number; color?: string; style?: CSSProperties }) {
  // Declared as an animatable; channels keep their v2 names <id>-x, <id>-y and <id>-press.
  const cursor = useAnimatableState(animatableIdFor(id), CURSOR_SPEC, { channels: { x: `${id}-x`, y: `${id}-y`, press: `${id}-press` } });
  const cx = cursor.animated.has("x") ? cursor.values.x : x ?? 0, cy = cursor.animated.has("y") ? cursor.values.y : y ?? 0;
  const press = Math.max(0, Math.min(1, cursor.values.press));
  const brand = useBrand();
  const px = x ?? cx, py = y ?? cy;
  return <div data-velora-cursor={skin} style={{ position: "absolute", left: 0, top: 0, transform: `translate(${px}px, ${py}px)`, pointerEvents: "none", zIndex: 10, ...style }}>
    {press > 0 && <span style={{ position: "absolute", left: -size, top: -size, width: size * 2, height: size * 2, borderRadius: "50%",
      border: `3px solid ${brand.colors.accent}`, opacity: 1 - press, transform: `scale(${0.3 + press * 0.9})` }}/>}
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: "block", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.45))", transform: `scale(${1 - 0.12 * Math.sin(press * Math.PI)})`, transformOrigin: "2px 2px" }}>
      <path d={paths[skin]} fill={color} stroke="#111" strokeWidth={1.4} strokeLinejoin="round"/>
    </svg>
  </div>;
}
/** Text typed at a steady rate (characters per second) from startMs, with a blinking caret on the scene clock. */
export function Typewriter({ id, text, startMs = 0, cps = 18, caret = true, style }: { id?: string; text: string; startMs?: number; cps?: number; caret?: boolean; style?: CSSProperties }) {
  const time = useSceneTime();
  // Graphemes keep emoji and combining marks whole; newlines stay.
  const graphemes = segmentText(text, "grapheme").flatMap((line, index) => index ? ["\n", ...line] : line);
  // An <id>.reveal track (0..1) scrubs the typing span instead of the prop timing.
  const typed = useRevealOverride(id, startMs, (graphemes.length / Math.max(1e-6, cps)) * 1000) ?? time;
  const shown = Math.max(0, Math.min(graphemes.length, Math.floor(((typed - startMs) / 1000) * cps)));
  const blinkOn = Math.floor(time / 530) % 2 === 0 || shown < graphemes.length;
  return <span data-velora-typewriter="" style={{ whiteSpace: "pre-wrap", ...style }}>
    {graphemes.slice(0, shown).join("")}
    {caret && <span style={{ opacity: blinkOn ? 1 : 0, borderLeft: "0.08em solid currentColor", marginLeft: "0.04em" }}>&#8203;</span>}
  </span>;
}
/** Dim everything in its width x height area except a feathered region; `amount` fades in from startMs. */
export function Spotlight({ width, height, region, amount = 0.6, feather = 40, startMs = 0, durationMs = 700, radius = 16 }: { width: number; height: number; region: { x: number; y: number; width: number; height: number }; amount?: number; feather?: number; startMs?: number; durationMs?: number; radius?: number }) {
  const progress = useReveal({ startMs, durationMs });
  const cx = region.x + region.width / 2, cy = region.y + region.height / 2;
  return <div data-velora-spotlight="" style={{ position: "absolute", left: 0, top: 0, width, height, pointerEvents: "none",
    background: `radial-gradient(${region.width / 2 + feather}px ${region.height / 2 + feather}px at ${cx}px ${cy}px, transparent ${Math.max(0, 100 - (feather / Math.max(region.width, region.height)) * 200)}%, rgba(0,0,0,${(amount * progress).toFixed(3)}) 100%)` }}>
    <span style={{ position: "absolute", left: region.x, top: region.y, width: region.width, height: region.height, borderRadius: radius, boxShadow: `0 0 0 2px rgba(255,255,255,${(0.6 * progress).toFixed(3)})` }}/>
  </div>;
}
/** A label at (x, y) with a leader line to (toX, toY); the line draws, then the label rises in. */
export function Callout({ id, label, x, y, toX, toY, startMs = 0, durationMs = 800, style }: { id?: string; label: string; x: number; y: number; toX: number; toY: number; startMs?: number; durationMs?: number; style?: CSSProperties }) {
  const brand = useBrand();
  const scale = useRevealScale();
  const override = useRevealOverride(id, startMs, Math.max(durationMs * 0.6 * scale, durationMs * 0.35 + durationMs * 0.65 * scale));
  const line = useReveal({ startMs, durationMs: durationMs * 0.6 }, 0, override);
  const text = useReveal({ startMs: startMs + durationMs * 0.35, durationMs: durationMs * 0.65 }, 0, override);
  const left = Math.min(x, toX) - 8, top = Math.min(y, toY) - 8;
  const w = Math.abs(toX - x) + 16, h = Math.abs(toY - y) + 16;
  const length = Math.hypot(toX - x, toY - y);
  return <>
    <svg data-velora-callout-line="" width={w} height={h} style={{ position: "absolute", left, top, pointerEvents: "none", overflow: "visible" }}>
      <line x1={x - left} y1={y - top} x2={toX - left} y2={toY - top} stroke={brand.colors.accent} strokeWidth={2.5} strokeDasharray={length} strokeDashoffset={length * (1 - line)} strokeLinecap="round"/>
      <circle cx={toX - left} cy={toY - top} r={5 * line} fill={brand.colors.accent}/>
    </svg>
    <div data-velora-callout="" style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, calc(-100% - 10px)) translateY(${(1 - text) * 12}px)`, opacity: text,
      padding: "8px 14px", borderRadius: brand.radius, background: brand.colors.surface, color: brand.colors.text, font: `600 18px/1.3 ${brand.fonts.body}`, whiteSpace: "nowrap", boxShadow: "0 10px 30px rgba(0,0,0,.35)", ...style }}>{label}</div>
  </>;
}
