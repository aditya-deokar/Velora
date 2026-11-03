import { z } from "zod";
import type { EasingInput } from "./easing";

/** SOURCE OF TRUTH: BrandSchema, MOTION_PERSONALITIES, DEFAULT_BRAND, brandTokensFromCss, completeBrandColors, contrastRatio.
 * WHAT: one brand file (velora.brand.json) with colors, gradients, fonts, radius, voice and a
 * motion personality, plus the easing/pacing table each personality maps to.
 * WHY: every motion-graphics template reads tokens at render time, so editing the brand file
 * re-skins every scene without touching recipes or bindings.
 * WHERE: kit BrandProvider/useBrand read it; `velora brand init|check` (project/commands) writes and
 * validates it; brandTokensFromCss seeds it from a stylesheet without executing code.
 */
const color = z.string().min(1).max(64).regex(/^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|color)\([^;{}]*\)|[a-zA-Z]+)$/, "Use a CSS color such as #0b0b0f, rgb(…) or oklch(…).");
export const MotionPersonalitySchema = z.enum(["calm", "crisp", "playful", "bold"]);
export type MotionPersonality = z.output<typeof MotionPersonalitySchema>;
export const BrandSchema = z.strictObject({
  $schema: z.string().max(512).optional(),
  version: z.literal(1),
  name: z.string().trim().min(1).max(80),
  logo: z.string().min(1).max(256).optional(),
  colors: z.strictObject({
    background: color.default("#0b0b0f"),
    surface: color.default("#17171c"),
    primary: color.default("#f5f5f7"),
    accent: color.default("#7c5cff"),
    text: color.default("#f5f5f7"),
    muted: color.default("#9a9aa3"),
  }).prefault({}),
  gradients: z.array(z.strictObject({ name: z.string().min(1).max(40), stops: z.array(color).min(2).max(6), angle: z.number().finite().min(0).max(360).default(135) })).max(8).default([]),
  fonts: z.strictObject({
    display: z.string().min(1).max(160).default("Inter, ui-sans-serif, system-ui, sans-serif"),
    body: z.string().min(1).max(160).default("Inter, ui-sans-serif, system-ui, sans-serif"),
    mono: z.string().min(1).max(160).default("ui-monospace, SFMono-Regular, Menlo, monospace"),
  }).prefault({}),
  radius: z.number().finite().min(0).max(64).default(16),
  voice: z.strictObject({
    tagline: z.string().max(140).optional(),
    url: z.string().max(200).optional(),
    cta: z.string().max(60).optional(),
  }).prefault({}),
  motion: MotionPersonalitySchema.default("calm"),
});
export type Brand = z.output<typeof BrandSchema>;
export type BrandInput = z.input<typeof BrandSchema>;
export const BRAND_FILE = "velora.brand.json";
export const DEFAULT_BRAND: Brand = BrandSchema.parse({ version: 1, name: "Your product" });
/** Easing and pacing per personality: durations scale every kit reveal; stagger spaces lines and items. */
export const MOTION_PERSONALITIES: Readonly<Record<MotionPersonality, { easing: EasingInput; durationScale: number; staggerMs: number }>> = Object.freeze({
  calm: { easing: "cinematic", durationScale: 1.35, staggerMs: 140 },
  crisp: { easing: "expo.out", durationScale: 0.8, staggerMs: 70 },
  playful: { easing: { spring: { stiffness: 210, damping: 14, mass: 1 } }, durationScale: 1, staggerMs: 90 },
  bold: { easing: "back.out", durationScale: 0.7, staggerMs: 60 },
});
// Relative luminance of a #rgb / #rrggbb color (undefined for other syntaxes).
function luminance(color: string): number | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 ? [...hex].map(c => c + c).join("") : hex;
  const channel = (i: number) => { const v = parseInt(full.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
/** WCAG contrast ratio of two hex colors (undefined when either is not hex). */
export function contrastRatio(a: string, b: string): number | undefined {
  const la = luminance(a), lb = luminance(b);
  return la === undefined || lb === undefined ? undefined : (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Fill colors a stylesheet did not provide from a palette that matches the background's lightness. */
export function completeBrandColors(seeded: Record<string, string>): Record<string, string> {
  const light = (luminance(seeded.background ?? "") ?? 0) > 0.5;
  const palette = light
    ? { background: "#ffffff", surface: "#f4f4f6", primary: "#111114", accent: "#7c5cff", text: "#111114", muted: "#5f5f6b" }
    : { background: "#0b0b0f", surface: "#17171c", primary: "#f5f5f7", accent: "#7c5cff", text: "#f5f5f7", muted: "#9a9aa3" };
  return { ...palette, ...(seeded.text && !seeded.primary ? { primary: seeded.text } : {}), ...seeded };
}
/**
 * Seed brand tokens from CSS custom properties (`--color-*`, `--brand-*`, `--font-*`, `--radius`).
 * A tokenizer over declarations only: comments are dropped, nothing is evaluated or fetched.
 */
export function brandTokensFromCss(css: string): { colors: Record<string, string>; fonts: Record<string, string>; radius?: number; found: string[] } {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = new Map<string, string>();
  for (const match of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)/g)) if (!declarations.has(match[1])) declarations.set(match[1], match[2].trim());
  const pick = (names: string[]) => names.map(name => declarations.get(name)).find(value => value !== undefined && !value.includes("var("));
  const colors: Record<string, string> = {};
  const map: Record<string, string[]> = {
    background: ["--color-background", "--background", "--brand-background", "--bg"],
    surface: ["--color-surface", "--surface", "--color-card", "--card"],
    // Headings first: in many themes --text is muted body copy and --text-h the heading color.
    primary: ["--color-primary", "--primary", "--brand-primary", "--brand", "--text-h", "--color-heading", "--heading"],
    accent: ["--color-accent", "--accent", "--brand-accent"],
    text: ["--color-text", "--foreground", "--color-foreground", "--text"],
    muted: ["--color-muted", "--muted-foreground", "--muted", "--color-muted-foreground"],
  };
  for (const [token, names] of Object.entries(map)) {
    const value = pick(names);
    if (value && color.safeParse(value).success) colors[token] = value;
    // shadcn-style bare HSL components ("222 47% 11%") become hsl(…).
    else if (value && /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(value)) colors[token] = `hsl(${value})`;
  }
  const fonts: Record<string, string> = {};
  for (const [token, names] of Object.entries({ display: ["--font-display", "--font-heading", "--font-sans"], body: ["--font-body", "--font-sans"], mono: ["--font-mono"] })) {
    const value = pick(names);
    if (value && value.length <= 160) fonts[token] = value;
  }
  const radiusText = pick(["--radius", "--brand-radius", "--border-radius"]);
  const radius = radiusText ? Number.parseFloat(radiusText) * (radiusText.trim().endsWith("rem") ? 16 : 1) : undefined;
  return { colors, fonts, ...(radius !== undefined && Number.isFinite(radius) && radius >= 0 && radius <= 64 ? { radius } : {}), found: [...declarations.keys()].sort() };
}
