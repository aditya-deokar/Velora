import type { CSSProperties, ReactNode } from "react";

/** SOURCE OF TRUTH: BrowserFrame, WindowFrame, PhoneFrame, LaptopFrame, TabletFrame.
 * WHAT: CSS-only device and window chrome around real UI: generic shapes (no bitmaps, no
 * trademarked silhouettes), light or dark, with an optional soft drop shadow.
 * WHY: framing the product as a product (window on wallpaper, phone in hand) reads as a launch film,
 * not a screen recording, while the content stays the live, real component.
 * WHERE: template bindings and hand-written scenes, inside a Surface. width/height size the content
 * (screen) area; chrome is added outside it, so layout of the real UI never changes.
 */
export type FrameTheme = "light" | "dark";
type FrameProps = { width: number; height: number; children?: ReactNode; theme?: FrameTheme; shadow?: boolean; style?: CSSProperties };
const palette = (theme: FrameTheme) => theme === "dark"
  ? { chrome: "#1e1e23", edge: "#34343c", text: "#c9c9d1", dot: "#4a4a54", screen: "#0b0b0f" }
  : { chrome: "#ececf0", edge: "#d2d2d9", text: "#55555f", dot: "#c4c4cc", screen: "#ffffff" };
const dropShadow = "0 50px 120px rgba(0,0,0,.45), 0 18px 40px rgba(0,0,0,.28)";
const screen = (width: number, height: number, background: string, radius = 0): CSSProperties =>
  ({ position: "relative", width, height, overflow: "hidden", background, borderRadius: radius });

/** A browser window with traffic-light dots and an address pill. */
export function BrowserFrame({ width, height, children, theme = "light", shadow = true, url, style }: FrameProps & { url?: string }) {
  const c = palette(theme), bar = 44;
  return <div data-velora-frame="browser" style={{ width, borderRadius: 14, overflow: "hidden", background: c.chrome, border: `1px solid ${c.edge}`, boxShadow: shadow ? dropShadow : "none", ...style }}>
    <div style={{ height: bar, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", boxSizing: "border-box", borderBottom: `1px solid ${c.edge}` }}>
      {[0, 1, 2].map(i => <span key={i} style={{ width: 12, height: 12, borderRadius: 6, background: c.dot }}/>)}
      {url !== undefined && <span style={{ margin: "0 auto", minWidth: "40%", maxWidth: "60%", height: 26, borderRadius: 13, background: theme === "dark" ? "#2a2a31" : "#ffffff", color: c.text, font: "500 13px/26px system-ui, sans-serif", textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", padding: "0 14px" }}>{url}</span>}
    </div>
    <div style={screen(width, height, c.screen)}>{children}</div>
  </div>;
}
/** A desktop app window with a centered title. */
export function WindowFrame({ width, height, children, theme = "dark", shadow = true, title, style }: FrameProps & { title?: string }) {
  const c = palette(theme), bar = 38;
  return <div data-velora-frame="window" style={{ width, borderRadius: 12, overflow: "hidden", background: c.chrome, border: `1px solid ${c.edge}`, boxShadow: shadow ? dropShadow : "none", ...style }}>
    <div style={{ position: "relative", height: bar, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", boxSizing: "border-box" }}>
      {[0, 1, 2].map(i => <span key={i} style={{ width: 12, height: 12, borderRadius: 6, background: c.dot }}/>)}
      {title && <span style={{ position: "absolute", left: 0, right: 0, textAlign: "center", color: c.text, font: "600 13px/38px system-ui, sans-serif", pointerEvents: "none" }}>{title}</span>}
    </div>
    <div style={screen(width, height, c.screen)}>{children}</div>
  </div>;
}
/** A generic phone: rounded bezel and a camera pill. */
export function PhoneFrame({ width, height, children, theme = "dark", shadow = true, style }: FrameProps) {
  const c = palette(theme), bezel = Math.round(width * 0.04), radius = Math.round(width * 0.14);
  return <div data-velora-frame="phone" style={{ position: "relative", width: width + bezel * 2, height: height + bezel * 2, padding: bezel, boxSizing: "border-box", borderRadius: radius + bezel, background: theme === "dark" ? "#101013" : "#e4e4ea", border: `2px solid ${c.edge}`, boxShadow: shadow ? dropShadow : "none", ...style }}>
    <div style={screen(width, height, c.screen, radius)}>{children}</div>
    <span style={{ position: "absolute", top: bezel + Math.round(height * 0.015), left: "50%", width: Math.round(width * 0.3), height: Math.round(width * 0.085), transform: "translateX(-50%)", borderRadius: 999, background: "#050506" }}/>
  </div>;
}
/** A generic tablet: even bezel, rounded corners. */
export function TabletFrame({ width, height, children, theme = "dark", shadow = true, style }: FrameProps) {
  const c = palette(theme), bezel = Math.round(Math.min(width, height) * 0.035);
  return <div data-velora-frame="tablet" style={{ width: width + bezel * 2, height: height + bezel * 2, padding: bezel, boxSizing: "border-box", borderRadius: bezel * 2.4, background: theme === "dark" ? "#121216" : "#e4e4ea", border: `2px solid ${c.edge}`, boxShadow: shadow ? dropShadow : "none", ...style }}>
    <div style={screen(width, height, c.screen, bezel)}>{children}</div>
  </div>;
}
/** A generic laptop: screen bezel over a tapered base. */
export function LaptopFrame({ width, height, children, theme = "dark", shadow = true, style }: FrameProps) {
  const c = palette(theme), bezel = Math.round(width * 0.025), baseHeight = Math.round(width * 0.035);
  return <div data-velora-frame="laptop" style={{ width: width + bezel * 2 + width * 0.12, display: "flex", flexDirection: "column", alignItems: "center", filter: shadow ? "drop-shadow(0 40px 60px rgba(0,0,0,.4))" : "none", ...style }}>
    <div style={{ width: width + bezel * 2, height: height + bezel * 2, padding: bezel, boxSizing: "border-box", borderRadius: `${bezel * 1.4}px ${bezel * 1.4}px 0 0`, background: "#0d0d10", border: `2px solid ${c.edge}`, borderBottom: "none" }}>
      <div style={screen(width, height, c.screen)}>{children}</div>
    </div>
    <div style={{ width: "100%", height: baseHeight, borderRadius: `0 0 ${baseHeight}px ${baseHeight}px`, background: theme === "dark" ? "linear-gradient(#3a3a42,#1c1c21)" : "linear-gradient(#e6e6ec,#b9b9c2)", position: "relative" }}>
      <span style={{ position: "absolute", left: "50%", top: 0, width: "16%", height: baseHeight * 0.35, transform: "translateX(-50%)", borderRadius: `0 0 ${baseHeight}px ${baseHeight}px`, background: "rgba(0,0,0,.25)" }}/>
    </div>
  </div>;
}
