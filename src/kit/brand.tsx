import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import { BrandSchema, DEFAULT_BRAND, EasingSchema, MOTION_PERSONALITIES, applyEasing, type Brand, type BrandInput, type EasingInput } from "../core";
import { useAnimatableState, useSceneTime } from "../react";
import { ANIMATABLE_ID_PATTERN } from "../core";

/** SOURCE OF TRUTH: BrandProvider, BrandMark, useBrand, useReveal.
 * WHAT: brand tokens (velora.brand.json) for every kit component, and the one reveal helper that
 * turns scene time + start/duration into eased progress scaled by the brand's motion personality.
 * WHY: one brand file re-skins every motion-graphics scene; animation stays on the Scene clock
 * (no rAF, timers or wall clock), so the same time always renders the same frame.
 * WHERE: generated motion-graphics bindings wrap their Surfaces in BrandProvider; kit components read it.
 * An invalid brand file falls back to defaults and reports itself on data-velora-brand-invalid.
 */
const BrandContext = createContext<{ brand: Brand; invalid?: string }>({ brand: DEFAULT_BRAND });
export function BrandProvider({ brand, children }: { brand?: BrandInput | unknown; children?: ReactNode }) {
  const value = useMemo(() => {
    if (brand === undefined) return { brand: DEFAULT_BRAND };
    const parsed = BrandSchema.safeParse(brand);
    return parsed.success ? { brand: parsed.data } : { brand: DEFAULT_BRAND, invalid: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }, [brand]);
  const { colors, fonts, radius } = value.brand;
  // CSS variables let plain elements in bindings use tokens; display: contents adds no box to the 3D tree.
  const variables = { "--velora-background": colors.background, "--velora-surface": colors.surface, "--velora-primary": colors.primary, "--velora-accent": colors.accent,
    "--velora-text": colors.text, "--velora-muted": colors.muted, "--velora-radius": `${radius}px`, color: colors.text, fontFamily: fonts.body } as CSSProperties;
  return <BrandContext.Provider value={value}>
    <div data-velora-brand={value.brand.name} style={{ display: "contents", ...variables }}>
      {value.invalid ? <span data-velora-brand-invalid={value.invalid} hidden/> : null}{children}
    </div>
  </BrandContext.Provider>;
}
/** The brand logo when it is a URL or public path, otherwise the brand name set in the display face. */
export function BrandMark({ size = 96, name, src, style }: { size?: number; name?: string; src?: string; style?: CSSProperties }) {
  const brand = useBrand();
  const logo = src ?? (brand.logo && /^(\/|https?:|data:)/.test(brand.logo) ? brand.logo : undefined);
  if (logo) return <img data-velora-brand-mark="" src={logo} alt={name ?? brand.name} style={{ height: size, width: "auto", display: "block", ...style }}/>;
  return <span data-velora-brand-mark="" style={{ font: `750 ${size}px/1 ${brand.fonts.display}`, letterSpacing: `${-0.03 * (size / 48)}px`, color: brand.colors.primary, whiteSpace: "nowrap", ...style }}>{name ?? brand.name}</span>;
}
export function useBrand(): Brand {
  return useContext(BrandContext).brand;
}
export type RevealTiming = { startMs?: number; durationMs?: number; easing?: EasingInput };
/** The animatable id for a kit component's id or channel name, when it is a valid animatable id. */
export function animatableIdFor(name: string | undefined): string | undefined {
  return name !== undefined && ANIMATABLE_ID_PATTERN.test(name) ? name : undefined;
}
/** Scroll offsets shared by ScrollFrame and RouteFrame (one spec, so one channel can drive both). */
export const SCROLL_SPEC = { scroll: { type: "number", default: 0, unit: "px", label: "Scroll" } } as const;
const REVEAL_SPEC = { reveal: { type: "number", default: 0, min: 0, max: 1, step: 0.01, label: "Reveal" } } as const;
/** The brand personality's duration scale (kit components size their reveal spans with it). */
export function useRevealScale(): number {
  return MOTION_PERSONALITIES[useBrand().motion].durationScale;
}
/** With an `<id>.reveal` track (0..1), the scene time inside a component's reveal span that the
 * track selects; otherwise undefined and the component keeps its prop timing. */
export function useRevealOverride(id: string | undefined, startMs: number, spanMs: number): number | undefined {
  const state = useAnimatableState(animatableIdFor(id), REVEAL_SPEC);
  return state.animated.has("reveal") ? startMs + state.values.reveal * Math.max(0, spanMs) : undefined;
}
/** Eased 0..1 progress of a reveal at the current scene time; personality scales duration and sets the default easing. */
export function useReveal({ startMs = 0, durationMs = 900, easing }: RevealTiming = {}, index = 0, timeOverride?: number): number {
  const sceneTime = useSceneTime();
  const time = timeOverride ?? sceneTime;
  const personality = MOTION_PERSONALITIES[useBrand().motion];
  const duration = Math.max(1, durationMs * personality.durationScale);
  const start = startMs + index * personality.staggerMs;
  const curve = useMemo(() => EasingSchema.parse(easing ?? personality.easing), [easing, personality]);
  return applyEasing(curve, (time - start) / duration);
}
/** A reveal function for many items (lines, words, cards) without calling hooks in loops. */
export function useRevealer(timeOverride?: number): (timing: RevealTiming, index?: number) => number {
  const sceneTime = useSceneTime();
  const time = timeOverride ?? sceneTime;
  const personality = MOTION_PERSONALITIES[useBrand().motion];
  const fallback = useMemo(() => EasingSchema.parse(personality.easing), [personality]);
  return (timing, index = 0) => {
    const duration = Math.max(1, (timing.durationMs ?? 900) * personality.durationScale);
    const start = (timing.startMs ?? 0) + index * personality.staggerMs;
    return applyEasing(timing.easing === undefined ? fallback : EasingSchema.parse(timing.easing), (time - start) / duration);
  };
}
/** Linear progress of a span (no personality): counters, sweeps, typewriters. */
export function useSpan(startMs: number, durationMs: number): number {
  const time = useSceneTime();
  return Math.max(0, Math.min(1, (time - startMs) / Math.max(1, durationMs)));
}
