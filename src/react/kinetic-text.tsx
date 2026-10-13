import type { CSSProperties, ReactNode } from "react";
import type { TextStyle } from "../core/typography";
import { Surface } from "./index";

/** KineticText: styled text markup paired with core kinetic preset builders.
 * WHAT: renders authored text as Surface leaves with stable IDs for motion tracks.
 * WHY: builders (buildKineticTracks) target Surface IDs; this component owns the
 * matching markup so agents never hand-roll spans that drift from the tracks.
 * WHERE: scenes compose it inside Scene/ScenePreview; recipe motion carries tracks.
 * No clock, no animation state: motion comes from recipe tracks, timing from Scene.
 */
export type KineticTextProps = {
  id: string;
  text: string;
  style?: Partial<TextStyle>;
  // Split into one child Surface per word (`${id}-w${i}`) for word-cascade and
  // typewriter-timed presets. Single mode keeps one Surface leaf.
  words?: boolean;
  className?: string;
};
export function kineticStyle(style?: Partial<TextStyle>): CSSProperties {
  return {
    fontFamily: style?.family,
    fontSize: style?.size,
    fontWeight: style?.weight,
    letterSpacing: style?.tracking === undefined ? undefined : `${style.tracking}px`,
    lineHeight: style?.leading,
    color: style?.color,
    textAlign: style?.align,
    display: "inline-block",
  };
}
function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}
export function kineticWordIds(id: string, text: string): string[] {
  return wordsOf(text).map((_, index) => `${id}-w${index}`);
}
export function KineticText({ id, text, style, words, className }: KineticTextProps): ReactNode {
  const css = kineticStyle(style);
  if (!words) {
    return <Surface id={id} content={<span style={css}>{text}</span>} className={className} />;
  }
  const parts = wordsOf(text);
  return (
    <Surface id={id} className={className}>
      {parts.map((word, index) => (
        <Surface key={`${id}-w${index}`} id={`${id}-w${index}`} content={<span style={css}>{word}</span>} />
      ))}
    </Surface>
  );
}
