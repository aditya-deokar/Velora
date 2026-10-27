import { useEffect, useRef } from "react";
import { frameAt, timeAtFrame } from "../core";

/** SOURCE OF TRUTH: transportTarget, useTransportKeys.
 * WHAT: editor keyboard transport over the one preview cursor: Space play/pause, J/K/L shuttle
 * (repeat presses double the rate up to 4x), arrows step one frame (Shift: one second),
 * [ ] previous/next segment, Home/End.
 * WHY: reviewing a cut is a keyboard job; every key maps onto the existing session, never a second clock.
 * WHERE: ScenePreview and CompositionPlayer install it; typing in form fields is never intercepted.
 */
export type TransportSession = {
  timeMs: number; durationMs: number; playing: boolean; rate: number;
  seek(ms: number): void; toggle(): void; shuttle(rate: number): void;
  seekNext?: () => void; seekPrev?: () => void;
};
export type TransportAction = { seek: number } | { shuttle: number } | { toggle: true } | { next: true } | { prev: true };
/** Pure key → action mapping (undefined: not a transport key). */
export function transportTarget(key: string, shift: boolean, session: Pick<TransportSession, "timeMs" | "durationMs" | "playing" | "rate">, fps: number): TransportAction | undefined {
  const { timeMs, durationMs } = session;
  const clamp = (value: number) => Math.max(0, Math.min(durationMs, value));
  const step = (direction: 1 | -1) => shift ? clamp(timeMs + direction * 1000) : clamp(timeAtFrame(Math.max(0, frameAt(Math.max(0, timeMs), fps) + direction), fps));
  switch (key) {
    case " ": return { toggle: true };
    case "k": case "K": return { shuttle: 0 };
    case "l": case "L": return { shuttle: session.playing && session.rate > 0 ? Math.min(4, session.rate * 2) : 1 };
    case "j": case "J": return { shuttle: session.playing && session.rate < 0 ? Math.max(-4, session.rate * 2) : -1 };
    case "ArrowRight": return { seek: step(1) };
    case "ArrowLeft": return { seek: step(-1) };
    case "Home": return { seek: 0 };
    case "End": return { seek: durationMs };
    case "]": return { next: true };
    case "[": return { prev: true };
    default: return undefined;
  }
}
export function useTransportKeys(session: TransportSession, fps: number, enabled = true) {
  const latest = useRef(session);
  latest.current = session;
  useEffect(() => {
    if (!enabled) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input,select,textarea,[contenteditable=''],[contenteditable='true']")) return;
      if (event.key === " " && target?.closest?.("button,summary,a")) return;
      const current = latest.current;
      if (!current.durationMs) return;
      const action = transportTarget(event.key, event.shiftKey, current, fps);
      if (!action) return;
      event.preventDefault();
      if ("seek" in action) current.seek(action.seek);
      else if ("shuttle" in action) current.shuttle(action.shuttle);
      else if ("toggle" in action) current.toggle();
      else if ("next" in action) current.seekNext?.();
      else current.seekPrev?.();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [fps, enabled]);
}
