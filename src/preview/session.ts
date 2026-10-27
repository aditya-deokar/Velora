import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RESOURCES, motionDuration, type PreviewDefinition, type PreviewDefinitionInput, type SceneIssue } from "../core";

/** SOURCE OF TRUTH: usePreviewSession.
 * WHAT: one presentation cursor, source revision retention and playback lifecycle.
 * WHY: UI and capture seek the same canonical motion clock without remounting host UI.
 * WHERE: ScenePreview owns presentation; core/presentPreview validates source revisions.
 * Timeline mode is additive: an optional {durationMs, boundaries} descriptor only
 * rescales the single cursor's clamp span and adds segment-boundary jumps. No
 * second clock, no second capture bridge; undefined keeps byte-identical behavior.
 * Shuttle rate (J/K/L) scales how fast that one cursor advances; negative plays backwards.
 */
export type PreviewTimeline = { durationMs: number; boundaries: number[] };
export function usePreviewSession(input: PreviewDefinitionInput | undefined, revision: unknown, timeline?: PreviewTimeline) {
  const result = useMemo(() => input === undefined ? null : RESOURCES["present-preview"](input), [input]);
  const [accepted, setAccepted] = useState<PreviewDefinition | null>(() => result?.valid ? result.definition : null);
  const definition = result?.valid ? result.definition : input === undefined ? null : accepted;
  const [timeMs, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const [renderIssues, setRenderIssues] = useState<SceneIssue[]>([]);
  const sceneDurationMs = definition?.motion ? motionDuration(definition.motion) : 0;
  const durationMs = timeline?.durationMs ?? sceneDurationMs;
  // A looping scene keeps playing from the start; timelines and exports never wrap.
  const loop = !timeline && !!definition?.motion?.loop;
  const cursor = useRef(timeMs);
  cursor.current = timeMs;
  const issues = result && !result.valid ? result.issues : renderIssues;
  const valid = !!definition && !!result?.valid && issues.length === 0;
  const pause = useCallback(() => setPlaying(false), []);
  const seek = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    setPlaying(false);
    setTime(Math.max(0, Math.min(durationMs, value)));
  }, [durationMs]);
  useEffect(() => {
    setPlaying(false);
    if (result?.valid) setAccepted(result.definition);
    if (input === undefined) { setAccepted(null); setTime(0); setRenderIssues([]); }
    else setTime(value => Math.min(value, durationMs));
  }, [result, input, revision, durationMs]);
  useEffect(() => { if (!valid) pause(); }, [valid, pause]);
  useEffect(() => {
    if (!playing || !valid || !durationMs) return;
    const started = performance.now() - cursor.current / rate;
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = (now - started) * rate;
      const next = loop ? ((elapsed % durationMs) + durationMs) % durationMs : Math.max(0, Math.min(durationMs, elapsed));
      setTime(next);
      if (loop || (rate > 0 ? next < durationMs : next > 0)) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, valid, durationMs, loop, rate]);
  useEffect(() => {
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    const changed = () => { if (media?.matches) pause(); };
    const visibility = () => { if (document.hidden) pause(); };
    media?.addEventListener("change", changed);
    document.addEventListener("visibilitychange", visibility);
    return () => { media?.removeEventListener("change", changed); document.removeEventListener("visibilitychange", visibility); };
  }, [pause]);
  const toggle = () => {
    if (!valid || !durationMs) return;
    if (rate < 0) setRateState(1);
    else if (cursor.current >= durationMs) setTime(0);
    setPlaying(value => !value);
  };
  // Shuttle: start playing at a signed rate on the same cursor (0 pauses).
  const shuttle = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    if (value === 0) { setPlaying(false); return; }
    setRateState(value);
    if (valid && durationMs) setPlaying(true);
  }, [valid, durationMs]);
  // Segment-boundary jumps over the single cursor. Without a timeline both
  // are undefined and every other behavior is unchanged.
  const boundaries = useMemo(() => [...(timeline?.boundaries ?? [])].sort((a, b) => a - b), [timeline]);
  const seekNext = useCallback(() => {
    if (!timeline || !valid) return;
    const edge = boundaries.find((boundary) => boundary > cursor.current);
    if (edge !== undefined) seek(Math.min(edge, durationMs));
  }, [timeline, valid, boundaries, seek, durationMs]);
  const seekPrev = useCallback(() => {
    if (!timeline || !valid) return;
    const edge = [...boundaries].reverse().find((boundary) => boundary < cursor.current);
    if (edge !== undefined) seek(edge);
  }, [timeline, valid, boundaries, seek]);
  return {definition, timeMs, durationMs, playing, rate, valid, issues, seek, pause, toggle, shuttle, onDiagnostics: setRenderIssues, ...(timeline ? {seekNext, seekPrev, boundaries} : {})};
}
