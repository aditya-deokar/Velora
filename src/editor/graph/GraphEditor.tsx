import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { EASING_NAMES, applyEasing, evaluateMotion, type EditOp } from "../../core";
import { useEditor, useEditorState } from "../context";
import { findTrack, trackKey } from "../model";
import { motionSpeed } from "../properties";
import type { Doc } from "../store";
import { buildRows, type TimelineRow } from "../timeline/Rows";
import { bezierOf, handlesOf, makeContinuous, type Bezier, type Segment } from "./handles";
import { SpringPanel } from "./SpringPanel";

/** Graph editor (05.5): value and speed graphs drawn by sampling the canonical evaluator (never re-derived
 * curve math); cubicBezier handles map exactly to easing (handles.ts); named curves convert to cubicBezier on
 * drag; handle modes per keyframe; spring and steps panels; smooth tracks are view-only with a track ease. */
type PropertyRow = Extract<TimelineRow, { kind: "property" }>;
const PAD = { left: 48, right: 16, top: 16, bottom: 22 };
const COLORS = ["#7cc4ff", "#ffd166", "#5ee6a0", "#ff8a3d", "#b893ff"];
const EASY: Bezier = [0.333, 0, 0.667, 1];
/** Evaluate one track alone as a channel (local time), through the compiled evaluator. One sampler per
 * track object, so the evaluator's cache hits on every redraw. */
const samplers = new WeakMap<object, (local: number) => number | undefined>();
function sampler(track: Doc): (local: number) => number | undefined {
  const cached = samplers.get(track);
  if (cached) return cached;
  const made = makeSampler(track);
  samplers.set(track, made);
  return made;
}
function makeSampler(track: Doc): (local: number) => number | undefined {
  const last = track.keyframes[track.keyframes.length - 1].timeMs;
  const motion = { durationMs: Math.max(last, 1), speed: 1, tracks: [{ ...track, target: { kind: "channel", id: "g" }, property: "value", ...(track.unit !== undefined ? { unit: undefined } : {}) }] };
  return local => { const state = evaluateMotion(motion, Math.max(0, Math.min(local, motion.durationMs))); return state.issues.length ? undefined : state.channels.g; };
}
export function GraphEditor() {
  const { store, host, snapshot, notify } = useEditor();
  const state = useEditorState(store);
  const doc = state.draft as Doc;
  const speed = motionSpeed(doc);
  const [mode, setMode] = useState<"value" | "speed">("value");
  const [shared, setShared] = useState(false);
  const [size, setSize] = useState({ width: 800, height: 200 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ row: PropertyRow; atMs: number; which: "out" | "in"; segment: Segment; bezier: Bezier; converted: boolean } | undefined>(undefined);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);
  const rows = useMemo(() => buildRows(doc, snapshot, { collapsed: [] }).filter((row): row is PropertyRow => row.kind === "property"), [doc, snapshot]);
  const wanted = new Set([...state.selection.tracks.map(trackKey), ...state.selection.keys.map(ref => trackKey(ref.track))]);
  const shown = rows.filter(row => wanted.has(row.id) && typeof row.keys[0]?.value === "number").slice(0, 5);
  const duration = Math.max(1, host.session.durationMs);
  const width = Math.max(10, size.width - PAD.left - PAD.right), height = Math.max(10, size.height - PAD.top - PAD.bottom);
  const tx = (time: number) => PAD.left + (time / duration) * width;
  const shownKey = shown.map(row => row.id).join("|");
  // Curves depend on the document, selection, size and mode, never on the playhead.
  const curves = useMemo(() => shown.map((row, index) => {
    const track = findTrack(doc, row.address)!;
    const sample = sampler(track);
    const count = Math.max(60, Math.min(400, Math.round(width / 2)));
    const points: { time: number; value: number }[] = [];
    for (let i = 0; i <= count; i++) {
      const time = (i / count) * duration, value = sample(row.fromTime(time));
      if (value !== undefined) points.push({ time, value });
    }
    const values = mode === "value" ? points.map(point => point.value)
      : points.map((point, i) => i === 0 ? 0 : (point.value - points[i - 1].value) / Math.max(1e-9, point.time - points[i - 1].time) * 1000);
    return { row, track, points, values, color: COLORS[index % COLORS.length] };
  }), [doc, shownKey, width, duration, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = curves.flatMap(curve => curve.values);
  const global = { min: Math.min(0, ...all), max: Math.max(1, ...all) };
  const scaleOf = (values: number[]) => {
    if (shared) return global;
    const min = Math.min(...values), max = Math.max(...values);
    return max - min < 1e-9 ? { min: min - 1, max: max + 1 } : { min, max };
  };
  const ty = (value: number, scale: { min: number; max: number }) => PAD.top + height - ((value - scale.min) / (scale.max - scale.min)) * height;
  const vy = (y: number, scale: { min: number; max: number }) => scale.min + ((PAD.top + height - y) / height) * (scale.max - scale.min);
  const selectedKey = state.selection.keys[0];
  const keyRow = selectedKey ? shown.find(row => row.id === trackKey(selectedKey.track)) : shown[0];
  const keyTrack = keyRow ? findTrack(doc, keyRow.address) : undefined;
  const keyIndex = keyTrack && selectedKey && keyRow?.id === trackKey(selectedKey.track) ? keyTrack.keyframes.findIndex((frame: Doc) => frame.timeMs === selectedKey.atMs) : -1;
  const segmentOf = (row: PropertyRow, track: Doc, index: number): Segment | undefined => {
    const a = track.keyframes[index], b = track.keyframes[index + 1];
    return a && b ? { t0: row.toTime(a.timeMs), v0: a.value, t1: row.toTime(b.timeMs), v1: b.value } : undefined;
  };
  const bezierFor = (easing: unknown): Bezier | undefined => typeof easing === "object" && easing && "cubicBezier" in easing ? (easing as { cubicBezier: Bezier }).cubicBezier : undefined;
  const ease = (row: PropertyRow, atMs: number, easing: unknown): EditOp => ({ op: "key.ease", track: row.address, atMs, easing } as EditOp);
  // Handles of the selected keyframe's outgoing segment (and the incoming one's in-handle).
  const handles: { which: "out" | "in"; atMs: number; t: number; v: number; anchor: { t: number; v: number }; segment: Segment; bezier: Bezier; named: boolean }[] = [];
  const curve = curves.find(entry => entry.row.id === keyRow?.id);
  if (keyRow && keyTrack && keyIndex >= 0 && !keyRow.smooth && mode === "value") {
    for (const [index, which] of [[keyIndex, "out"], [keyIndex - 1, "in"]] as const) {
      const segment = segmentOf(keyRow, keyTrack, index);
      const frame = keyTrack.keyframes[index];
      if (!segment || !frame || ["hold", "auto"].includes(frame.easing) || (typeof frame.easing === "object" && frame.easing && ("spring" in frame.easing || "steps" in frame.easing))) continue;
      const bezier = bezierFor(frame.easing) ?? (frame.easing === "linear" ? [1 / 3, 1 / 3, 2 / 3, 2 / 3] as Bezier : EASY);
      const points = handlesOf(segment, bezier);
      const point = which === "out" ? points.out : points.in;
      handles.push({ which, atMs: frame.timeMs, t: point.t, v: point.v, anchor: which === "out" ? { t: segment.t0, v: segment.v0 } : { t: segment.t1, v: segment.v1 }, segment, bezier, named: !bezierFor(frame.easing) });
    }
  }
  const scale = curve ? scaleOf(curve.values) : global;
  const startDrag = (event: ReactPointerEvent<SVGCircleElement>, handle: (typeof handles)[number]) => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture(event.pointerId);
    drag.current = { row: keyRow!, atMs: handle.atMs, which: handle.which, segment: handle.segment, bezier: handle.bezier, converted: handle.named };
  };
  const dragTo = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current) return;
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const point = { t: ((event.clientX - rect.left - PAD.left) / width) * duration, v: vy(event.clientY - rect.top, scale) };
    const handlesNow = handlesOf(current.segment, current.bezier);
    const bezier = bezierOf(current.segment, current.which === "out" ? point : handlesNow.out, current.which === "in" ? point : handlesNow.in, current.bezier);
    store.preview([ease(current.row, current.atMs, { cubicBezier: bezier })]);
  };
  const endDrag = () => {
    const current = drag.current;
    drag.current = undefined;
    const transient = store.getState().transient;
    if (!current || !transient.length) return;
    store.commit(transient, `Shape ${current.row.label} easing`);
    if (current.converted) notify("Converted to a custom curve (cubicBezier).");
  };
  const nudgeHandle = (event: KeyboardEvent<SVGCircleElement>, handle: (typeof handles)[number]) => {
    const step = event.shiftKey ? 0.25 : 0.05;
    const index = handle.which === "out" ? [0, 1] : [2, 3];
    const next = [...handle.bezier] as Bezier;
    if (event.key === "ArrowUp") next[index[1]] += step; else if (event.key === "ArrowDown") next[index[1]] -= step;
    else if (event.key === "ArrowLeft") next[index[0]] -= step / 2; else if (event.key === "ArrowRight") next[index[0]] += step / 2; else return;
    event.preventDefault();
    next[0] = Math.min(1, Math.max(0, next[0])); next[2] = Math.min(1, Math.max(0, next[2]));
    next[1] = Math.min(5, Math.max(-5, next[1])); next[3] = Math.min(5, Math.max(-5, next[3]));
    store.commit([ease(keyRow!, handle.atMs, { cubicBezier: next.map(value => Math.round(value * 1000) / 1000) })], `Shape ${keyRow!.label} easing`, { merge: true });
  };
  const setHandleMode = (modeName: "linear" | "ease" | "continuous" | "auto" | "hold") => {
    if (!keyRow || !keyTrack || keyIndex < 0) return;
    const atMs = keyTrack.keyframes[keyIndex].timeMs;
    if (modeName !== "continuous") {
      const value = modeName === "ease" ? { cubicBezier: EASY } : modeName;
      store.commit([ease(keyRow, atMs, value)], `${modeName} at ${Math.round(atMs)} ms`);
      return;
    }
    const before = segmentOf(keyRow, keyTrack, keyIndex - 1), after = segmentOf(keyRow, keyTrack, keyIndex);
    if (!before || !after) { notify("Continuous needs a keyframe with a segment on each side."); return; }
    const prevFrame = keyTrack.keyframes[keyIndex - 1];
    const result = makeContinuous({ segment: before, bezier: bezierFor(prevFrame.easing) ?? EASY }, { segment: after, bezier: bezierFor(keyTrack.keyframes[keyIndex].easing) ?? EASY });
    store.commit([ease(keyRow, prevFrame.timeMs, { cubicBezier: result.before }), ease(keyRow, atMs, { cubicBezier: result.after })], `Continuous at ${Math.round(atMs)} ms`);
  };
  const keyEasing = keyTrack && keyIndex >= 0 ? keyTrack.keyframes[keyIndex].easing : undefined;
  const isSpring = typeof keyEasing === "object" && keyEasing && "spring" in keyEasing;
  const isSteps = typeof keyEasing === "object" && keyEasing && "steps" in keyEasing;
  return <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
      <div className="ve-tl-head" role="toolbar" aria-label="Graph editor">
        <button className="ve-btn" aria-pressed={mode === "value"} onClick={() => setMode("value")}>Value</button>
        <button className="ve-btn" aria-pressed={mode === "speed"} onClick={() => setMode("speed")}>Speed</button>
        <button className="ve-btn" aria-pressed={shared} onClick={() => setShared(!shared)} title="One y-scale for every curve">Shared scale</button>
        <span style={{ color: "var(--ve-dim)" }}>Keyframe:</span>
        {(["linear", "ease", "continuous", "auto", "hold"] as const).map(name => <button key={name} className="ve-btn" disabled={keyIndex < 0} onClick={() => setHandleMode(name)}>{name}</button>)}
        {keyRow?.smooth && <label>Track ease <select className="ve-input" style={{ width: 120 }} value={typeof keyTrack?.ease === "string" ? keyTrack.ease : ""}
          onChange={event => store.commit([{ op: "track.options", track: keyRow.address, ease: event.target.value || null } as EditOp], "Track ease")}>
          <option value="">none</option>{EASING_NAMES.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
      </div>
      <div ref={box} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {shown.length === 0 ? <p style={{ padding: 12, color: "var(--ve-dim)" }}>Select a numeric property or keyframes in the dope sheet to graph them.</p> :
          <svg width={size.width} height={size.height} role="img" aria-label={`${mode} graph of ${shown.map(row => row.label).join(", ")}`} onPointerMove={dragTo} onPointerUp={endDrag}>
            <line x1={tx(host.session.timeMs)} x2={tx(host.session.timeMs)} y1={PAD.top} y2={PAD.top + height} stroke="#ff8a3d"/>
            {curves.map(entry => {
              const s = scaleOf(entry.values);
              const d = entry.points.map((point, i) => `${i ? "L" : "M"}${tx(point.time).toFixed(1)} ${ty(entry.values[i], s).toFixed(1)}`).join("");
              return <g key={entry.row.id}><path d={d} fill="none" stroke={entry.color} strokeWidth={entry.row.id === keyRow?.id ? 2 : 1.25}/>
                {mode === "value" && entry.row.keys.map(key => <rect key={key.atMs} x={tx(key.time) - 3} y={ty(key.value as number, s) - 3} width={6} height={6} fill={entry.color}
                  stroke={state.selection.keys.some(ref => ref.atMs === key.atMs && trackKey(ref.track) === entry.row.id) ? "#fff" : "none"}
                  onClick={() => store.select({ keys: [{ track: entry.row.address, atMs: key.atMs }], tracks: [entry.row.address] })}/>)}
                <text x={4} y={PAD.top + 12 + curves.indexOf(entry) * 12} fill={entry.color} fontSize={10}>{entry.row.layer} {entry.row.label} {shared ? "" : `[${Math.round(s.min * 100) / 100}…${Math.round(s.max * 100) / 100}]`}</text></g>;
            })}
            {handles.map(handle => <g key={handle.which}>
              <line x1={tx(handle.anchor.t)} y1={ty(handle.anchor.v, scale)} x2={tx(handle.t)} y2={ty(handle.v, scale)} stroke="#ffffff88"/>
              <circle cx={tx(handle.t)} cy={ty(handle.v, scale)} r={6} fill="#141417" stroke="#fff" strokeWidth={2} tabIndex={0} role="slider"
                aria-label={`${handle.which === "out" ? "Out" : "In"} handle of ${keyRow?.label} at ${Math.round(handle.atMs)} ms`}
                aria-valuetext={`x ${handle.bezier[handle.which === "out" ? 0 : 2].toFixed(3)}, y ${handle.bezier[handle.which === "out" ? 1 : 3].toFixed(3)}`}
                onPointerDown={event => startDrag(event, handle)} onKeyDown={event => nudgeHandle(event, handle)} style={{ cursor: "grab" }}/>
            </g>)}
          </svg>}
      </div>
    </div>
    {keyRow && keyIndex >= 0 && (isSpring || isSteps) && <SpringPanel easing={keyEasing} durationMs={(() => { const s = segmentOf(keyRow, keyTrack!, keyIndex); return s ? (s.t1 - s.t0) * speed : 1000; })()}
      onChange={easing => store.commit([ease(keyRow, keyTrack!.keyframes[keyIndex].timeMs, easing)], "Edit spring", { merge: true })} sample={progress => applyEasing(keyEasing as never, progress)}/>}
  </div>;
}
