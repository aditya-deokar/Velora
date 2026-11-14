import type { CSSProperties, ReactNode } from "react";
import { useSceneTime } from "../react";
import { tint } from "./color";
import { MOTION_PERSONALITIES } from "../core";
import { useBrand, useReveal, useRevealer, useRevealOverride, useRevealScale, type RevealTiming } from "./brand";

/** SOURCE OF TRUTH: Title, Counter, Countdown, Panel, Marquee, GradientText, CaptionTrack, segmentText.
 * WHAT: brand-styled type that moves on the scene clock: masked line/word/grapheme reveals (Intl.Segmenter,
 * so CJK and RTL split correctly), tabular counters with locale formatting, an endless marquee,
 * gradient text and timed captions (minimal, karaoke, bold-pop).
 * WHY: kinetic type is most of a launch film; masks (overflow clip) reveal without fading, and every
 * frame is a pure function of time and brand.
 * WHERE: motion-graphics templates and scenes; KineticText remains for existing recipes.
 */
export type Split = "line" | "word" | "grapheme";
export function segmentText(text: string, by: Split, locale?: string): string[][] {
  const lines = text.split("\n");
  if (by === "line") return lines.map(line => [line]);
  const hasSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl;
  return lines.map(line => {
    if (!hasSegmenter) return by === "word" ? line.split(/(\s+)/).filter(Boolean) : Array.from(line);
    const segmenter = new Intl.Segmenter(locale, { granularity: by });
    if (by === "grapheme") return Array.from(segmenter.segment(line), part => part.segment);
    // Punctuation rides with the word before it ("Ship." reveals as one unit); spaces stay separate.
    const units: string[] = [];
    for (const part of segmenter.segment(line)) {
      const attach = !part.isWordLike && !/^\s+$/.test(part.segment) && units.length && !/^\s+$/.test(units[units.length - 1]);
      if (attach) units[units.length - 1] += part.segment; else units.push(part.segment);
    }
    return units;
  });
}
type TitleProps = RevealTiming & { id?: string; text: string; by?: Split; accent?: string; size?: number; weight?: number; align?: CSSProperties["textAlign"]; color?: string; locale?: string; lineHeight?: number; style?: CSSProperties };
/** Units rise from behind a mask in reading order (staggered by the brand's motion personality). */
export function Title({ id, text, by = "word", accent, size = 96, weight = 650, align = "left", color, locale, lineHeight = 1.05, startMs = 0, durationMs = 900, easing, style }: TitleProps) {
  const brand = useBrand();
  const lines = segmentText(text, by, locale);
  // An <id>.reveal track (0..1) scrubs the whole staggered reveal span instead of the prop timing.
  const units = lines.flat().filter(unit => !/^\s+$/.test(unit)).length;
  const personality = MOTION_PERSONALITIES[brand.motion];
  const reveal = useRevealer(useRevealOverride(id, startMs, Math.max(0, units - 1) * personality.staggerMs + durationMs * personality.durationScale));
  let index = 0;
  return <div data-velora-title="" lang={locale} style={{ font: `${weight} ${size}px/${lineHeight} ${brand.fonts.display}`, letterSpacing: `${-0.02 * (size / 48)}px`, color: color ?? brand.colors.primary, textAlign: align, ...style }}>
    {lines.map((units, line) => <div key={line} style={{ display: "block" }}>
      {units.map((unit, i) => {
        if (/^\s+$/.test(unit)) return <span key={i} style={{ whiteSpace: "pre" }}>{unit}</span>;
        const progress = reveal({ startMs, durationMs, ...(easing ? { easing } : {}) }, index++);
        // The mask is the unit's own line box; padding keeps descenders inside it.
        return <span key={i} data-velora-unit="" style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", padding: "0.08em 0", margin: "-0.08em 0" }}>
          <span style={{ display: "inline-block", transform: `translateY(${((1 - progress) * 110).toFixed(2)}%)`, whiteSpace: "pre", ...(accent && unit.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === accent.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") ? { color: brand.colors.accent } : {}) }}>{unit}</span>
        </span>;
      })}
    </div>)}
  </div>;
}
/** A number counting from `from` to `to` with tabular numerals and locale grouping. */
export function Counter({ id, from = 0, to, decimals = 0, prefix = "", suffix = "", locale, size = 120, color, startMs = 0, durationMs = 1600, easing, style }: RevealTiming & { id?: string; from?: number; to: number; decimals?: number; prefix?: string; suffix?: string; locale?: string; size?: number; color?: string; style?: CSSProperties }) {
  const brand = useBrand();
  const override = useRevealOverride(id, startMs, durationMs * useRevealScale());
  const progress = useReveal({ startMs, durationMs, easing: easing ?? "expo.out" }, 0, override);
  const value = from + (to - from) * progress;
  const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value.toFixed(decimals)));
  return <span data-velora-counter="" style={{ font: `700 ${size}px/1 ${brand.fonts.display}`, fontVariantNumeric: "tabular-nums", letterSpacing: `${-0.03 * (size / 48)}px`, color: color ?? brand.colors.primary, whiteSpace: "nowrap", ...style }}>{prefix}{formatted}{suffix}</span>;
}
/** Items scrolling sideways at `speed` px/s forever (repeat enough copies to cover `width`). */
export function Marquee({ items, width, speed = 60, gap = 48, size = 28, color, style }: { items: ReactNode[]; width: number; speed?: number; gap?: number; size?: number; color?: string; style?: CSSProperties }) {
  const brand = useBrand();
  const time = useSceneTime();
  const unit = Math.max(1, items.length) * (size * 6 + gap);
  const offset = ((time / 1000) * speed) % unit;
  const copies = Math.max(2, Math.ceil(width / unit) + 1);
  return <div data-velora-marquee="" style={{ width, overflow: "hidden", ...style }}>
    <div style={{ display: "flex", gap, transform: `translateX(${-offset}px)`, font: `500 ${size}px/1.2 ${brand.fonts.body}`, color: color ?? brand.colors.muted, whiteSpace: "nowrap" }}>
      {Array.from({ length: copies }).flatMap((_, copy) => items.map((item, i) => <span key={`${copy}-${i}`} style={{ minWidth: size * 6, display: "inline-flex", justifyContent: "center" }}>{item}</span>))}
    </div>
  </div>;
}
export function GradientText({ children, stops, angle, style }: { children: ReactNode; stops?: string[]; angle?: number; style?: CSSProperties }) {
  const brand = useBrand();
  const gradient = brand.gradients[0];
  const colors = stops ?? gradient?.stops ?? [brand.colors.primary, brand.colors.accent];
  return <span data-velora-gradient-text="" style={{ backgroundImage: `linear-gradient(${angle ?? gradient?.angle ?? 135}deg, ${colors.join(", ")})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", WebkitTextFillColor: "transparent", ...style }}>{children}</span>;
}
export type CaptionStyle = "minimal" | "karaoke" | "bold-pop" | "lower";
export type CaptionWord = { text: string; startMs: number; endMs: number };
export type CaptionCueInput = { startMs: number; endMs: number; text: string; words?: CaptionWord[] };
/** Word timings for a cue: given ones, or the cue's span spread across words by character count. */
export function cueWords(cue: CaptionCueInput): CaptionWord[] {
  if (cue.words?.length) return cue.words;
  const words = cue.text.split(/\s+/).filter(Boolean);
  const total = words.reduce((sum, word) => sum + word.length, 0) || 1;
  let cursor = cue.startMs;
  return words.map(word => {
    const length = ((cue.endMs - cue.startMs) * word.length) / total;
    const entry = { text: word, startMs: Math.round(cursor), endMs: Math.round(cursor + length) };
    cursor += length;
    return entry;
  });
}
/**
 * The cue active at scene time. Captions sit over arbitrary footage, so text is white on a dark plate
 * (bold-pop uses a heavy shadow); karaoke lights each word as it is spoken; lower is a lower-third bar.
 */
export function CaptionTrack({ cues, variant = "minimal", size = 40, style }: { cues: CaptionCueInput[]; variant?: CaptionStyle; size?: number; style?: CSSProperties }) {
  const brand = useBrand();
  const time = useSceneTime();
  const cue = cues.find(entry => time >= entry.startMs && time < entry.endMs);
  if (!cue) return null;
  const words = cueWords(cue);
  const pop = Math.min(1, (time - cue.startMs) / 160);
  const box: CSSProperties = variant === "bold-pop"
    ? { font: `800 ${size * 1.2}px/1.15 ${brand.fonts.display}`, color: "#ffffff", textShadow: "0 4px 18px rgba(0,0,0,.75), 0 0 2px rgba(0,0,0,.9)", transform: `scale(${(0.85 + 0.15 * pop).toFixed(3)})`, textTransform: "uppercase" }
    : variant === "lower"
      ? { font: `600 ${size}px/1.3 ${brand.fonts.body}`, color: "#ffffff", background: "rgba(10,10,14,.78)", padding: "0.35em 0.8em", borderLeft: `${Math.round(size * 0.18)}px solid ${brand.colors.accent}`, textAlign: "left" }
      : { font: `600 ${size}px/1.3 ${brand.fonts.body}`, color: "#ffffff", background: "rgba(0,0,0,.62)", padding: "0.2em 0.6em", borderRadius: brand.radius / 2 };
  return <div data-velora-caption={variant} style={{ display: "inline-block", textAlign: "center", ...box, ...style }}>
    {variant === "karaoke" || variant === "bold-pop"
      ? words.map((word, i) => <span key={i} style={{ color: variant === "karaoke" && time >= word.startMs ? brand.colors.accent : undefined }}>{word.text}{i < words.length - 1 ? " " : ""}</span>)
      : cue.text}
  </div>;
}
/** Numbers counting down (3, 2, 1) each popping in and out over one step. */
export function Countdown({ from = 3, stepMs = 1000, startMs = 0, size = 360, color, style }: { from?: number; stepMs?: number; startMs?: number; size?: number; color?: string; style?: CSSProperties }) {
  const brand = useBrand();
  const time = useSceneTime() - startMs;
  const step = Math.floor(time / stepMs);
  if (time < 0 || step >= from) return null;
  const local = (time - step * stepMs) / stepMs;
  const pop = Math.min(1, local / 0.18), fade = local > 0.8 ? 1 - (local - 0.8) / 0.2 : 1;
  return <span data-velora-countdown={from - step} style={{ display: "inline-block", font: `800 ${size}px/1 ${brand.fonts.display}`, fontVariantNumeric: "tabular-nums", color: color ?? brand.colors.primary,
    transform: `scale(${(0.7 + 0.3 * pop).toFixed(3)})`, opacity: Number(fade.toFixed(3)), ...style }}>{from - step}</span>;
}
/** A brand card (surface color, radius, hairline border) with an optional title and body that reveal in. */
export function Panel({ width, height, title, body, icon, startMs = 0, durationMs = 700, index = 0, children, style }: RevealTiming & { width: number; height: number; title?: string; body?: string; icon?: string; index?: number; children?: ReactNode; style?: CSSProperties }) {
  const brand = useBrand();
  const reveal = useRevealer();
  const progress = reveal({ startMs, durationMs }, index);
  return <div data-velora-panel="" style={{ boxSizing: "border-box", width, height, padding: Math.round(Math.min(width, height) * 0.1), borderRadius: brand.radius * 1.5, background: brand.colors.surface, border: "1px solid rgba(255,255,255,.08)",
    boxShadow: "0 30px 80px rgba(0,0,0,.35)", color: brand.colors.text, display: "flex", flexDirection: "column", gap: 12, opacity: progress, transform: `translateY(${((1 - progress) * 24).toFixed(2)}px)`, ...style }}>
    {icon && <span style={{ width: 48, height: 48, borderRadius: brand.radius, display: "grid", placeItems: "center", background: `${tint(brand.colors.accent, 15)}`, color: brand.colors.accent, font: `700 24px/1 ${brand.fonts.display}` }}>{icon}</span>}
    {title && <strong style={{ font: `650 ${Math.round(Math.min(44, width / 9))}px/1.15 ${brand.fonts.display}` }}>{title}</strong>}
    {body && <span style={{ font: `400 ${Math.round(Math.min(26, width / 16))}px/1.45 ${brand.fonts.body}`, color: brand.colors.muted }}>{body}</span>}
    {children}
  </div>;
}
