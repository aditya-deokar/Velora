import type { CSSProperties } from "react";
import { EASING_NAMES, SELECTOR_SHAPES, readingTimeMs, textAnimatorAt, type RangeSelector, type SelectorShape, type TextAnimatorAmounts, type EasingInput } from "../core";
import { useAnimatableState } from "../react";
import { segmentText } from "./type";

/** SOURCE OF TRUTH: TextAnimator.
 * WHAT: After Effects-style text animator: text split with Intl.Segmenter (chars, words or lines), a range
 * selector weighting per-unit opacity, position, rotation, scale, blur, tracking and color.
 * WHY: kinetic type keyed on the timeline: every selector and amount is an animatable
 * (`<id>.selector.start`, `<id>.selector.end`, `<id>.selector.offset`, `<id>.opacity`, `<id>.y`, …), so
 * the editor keys them like any property. The math is the pure core textAnimatorAt.
 * WHERE: inside a Surface leaf (the focus and capture invariant); a pure function of scene time.
 */
export type TextAnimatorProps = {
  id: string; text: string; by?: "chars" | "words" | "lines"; locale?: string;
  /** Static selector (animatable tracks override start, end and offset). Start 100 selects nothing. */
  selector?: Partial<RangeSelector> & { shape?: SelectorShape; ease?: EasingInput };
  /** Amounts at full selection (animatable tracks override them). */
  amounts?: TextAnimatorAmounts;
  style?: CSSProperties;
};
const SPLIT = { chars: "grapheme", words: "word", lines: "line" } as const;
const SELECTOR_EASES = ["Default", ...EASING_NAMES.filter(name => !name.startsWith("elastic."))];
export function TextAnimator({ id, text, by = "chars", locale, selector = {}, amounts = { opacity: 0, y: 24 }, style }: TextAnimatorProps) {
  const range = {
    start: { type: "number", default: selector.start ?? 100, min: 0, max: 100, label: "Selector start", unit: "%" },
    end: { type: "number", default: selector.end ?? 100, min: 0, max: 100, label: "Selector end", unit: "%" },
    offset: { type: "number", default: selector.offset ?? 0, min: -200, max: 200, label: "Selector offset", unit: "%" },
  } as const;
  const legacy = useAnimatableState(undefined, range, { channels: { start: `${id}.selectorStart`, end: `${id}.selectorEnd`, offset: `${id}.selectorOffset` } }).values;
  const selection = useAnimatableState(`${id}.selector`, {
    ...range, shape: { type: "enum", default: selector.shape ?? "square", options: [...SELECTOR_SHAPES] },
    ease: { type: "enum", default: "Default", options: SELECTOR_EASES },
    wrap: { type: "boolean", default: selector.wrap ?? false },
  });
  const { values, animated } = useAnimatableState(id, {
    opacity: { type: "number", default: amounts.opacity ?? 1, min: 0, max: 1 },
    x: { type: "number", default: amounts.x ?? 0 }, y: { type: "number", default: amounts.y ?? 0 }, z: { type: "number", default: amounts.z ?? 0 },
    rotate: { type: "number", default: amounts.rotate ?? 0 }, scale: { type: "number", default: amounts.scale ?? 1, min: 0, max: 20 },
    blur: { type: "number", default: amounts.blur ?? 0, min: 0, max: 64 }, tracking: { type: "number", default: amounts.tracking ?? 0, min: -1, max: 4, unit: "em" },
    color: { type: "color", default: amounts.color ?? "#00000000" },
  }, { readingTimeMs: readingTimeMs([text]) });
  const lines = segmentText(text, SPLIT[by], locale);
  const units = lines.flat().filter(unit => !/^\s+$/.test(unit));
  const states = textAnimatorAt(units.length, {
    start: selection.animated.has("start") ? selection.values.start : legacy.start,
    end: selection.animated.has("end") ? selection.values.end : legacy.end,
    offset: selection.animated.has("offset") ? selection.values.offset : legacy.offset,
    shape: selection.values.shape, wrap: selection.values.wrap,
    ease: selection.values.ease === "Default" ? selector.ease : selection.values.ease as EasingInput,
  }, {
    opacity: values.opacity, x: values.x, y: values.y, z: values.z, rotate: values.rotate,
    scale: values.scale, blur: values.blur, tracking: values.tracking, ...(amounts.color || animated.has("color") ? { color: values.color } : {}),
  });
  let index = 0;
  return <div data-velora-text-animator={id} lang={locale} style={{ whiteSpace: "pre-wrap", ...style }}>
    {lines.map((line, row) => <div key={row}>{line.map((unit, i) => {
      if (/^\s+$/.test(unit)) return <span key={i} style={{ whiteSpace: "pre" }}>{unit}</span>;
      const state = states[index++];
      return <span key={i} data-velora-unit="" data-weight={state.weight.toFixed(4)} style={{
        display: "inline-block", whiteSpace: "pre", opacity: state.opacity,
        transform: `translate3d(${state.x}px, ${state.y}px, ${state.z}px) rotate(${state.rotate}deg) scale(${state.scale})`,
        ...(state.blur > 0 ? { filter: `blur(${state.blur}px)` } : {}),
        ...(state.tracking !== 0 ? { letterSpacing: `${state.tracking}em` } : {}),
        ...(state.color && state.colorMix > 0 ? { color: `color-mix(in oklab, currentColor, ${state.color} ${(state.colorMix * 100).toFixed(2)}%)` } : {}),
      }}>{unit}</span>;
    })}</div>)}
  </div>;
}
