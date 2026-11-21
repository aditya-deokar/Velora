import { useState, type ReactNode } from "react";
import { MotionClipSchema, clipTiming, type EditOp, type MotionClipInput } from "../core";
import { surfaceLayers } from "./commands";
import { useEditor, useEditorState } from "./context";
import { bakeDeviation } from "./group";
import { listTracks, snapToFrame, trackKey } from "./model";
import { motionSpeed } from "./properties";
import type { Doc, EditorStore, KeyRef } from "./store";
import { buildRows } from "./timeline/Rows";

export function MotionPanel({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return <div className="ve-popover ve-panel" role="dialog" aria-label={title} data-velora-preview-chrome=""
    style={{ top: 56, right: 16, width: 400, maxWidth: "calc(100vw - 32px)" }}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="ve-h"><span>{title}</span><button className="ve-btn" onClick={onClose}>Close</button></div>
    <div className="ve-motion-fields">{children}</div>
  </div>;
}

export function NumericField({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number | undefined; onChange(value: number | undefined): void; min?: number; max?: number; step?: number | "any";
}) {
  return <label>{label}<input className="ve-input" type="number" min={min} max={max} step={step} value={value ?? ""}
    onChange={event => onChange(Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : undefined)}/></label>;
}

export function selectClip(store: EditorStore, id: string) {
  store.select({ layers: [`clip:${id}`], clips: [id], tracks: [], keys: [] });
}

export function extendForClips(doc: Doc, clips: readonly MotionClipInput[]): EditOp[] {
  const end = Math.ceil(Math.max(0, ...clips.map(clip => clipTiming(MotionClipSchema.parse(clip)).endMs)));
  return end > (doc.definition.motion?.durationMs ?? 0) ? [{ op: "motion.set", durationMs: end }] : [];
}

export function sequenceOps(doc: Doc, layers: readonly string[], overlap: number, unit: "ms" | "%"): EditOp[] {
  const roots = listTracks(doc).filter(entry => !entry.clip);
  const groups = layers.map(id => roots.flatMap(({ address, track }) => ("id" in address.target ? address.target.id : address.target.kind) === id
    ? (track.keyframes as { timeMs: number }[]).map(frame => ({ track: address, atMs: frame.timeMs })) : [])).filter(refs => refs.length > 0);
  if (groups.length < 2) return [];
  let cursor = Math.min(...groups[0].map(ref => ref.atMs));
  let end = cursor;
  const ops: EditOp[] = [];
  for (const refs of groups) {
    const from = Math.min(...refs.map(ref => ref.atMs)), to = Math.max(...refs.map(ref => ref.atMs));
    const span = to - from, deltaMs = cursor - from;
    end = Math.max(end, cursor + span);
    if (deltaMs) ops.push({ op: "keys.shift", refs, deltaMs });
    const overlapMs = unit === "%" ? span * overlap / 100 : overlap * motionSpeed(doc);
    cursor += Math.max(0, span - overlapMs);
  }
  if (end > doc.definition.motion.durationMs) ops.unshift({ op: "motion.set", durationMs: Math.ceil(end) });
  return ops;
}

export function Timing({ onClose }: { onClose(): void }) {
  const { store, host, notify, snapshot } = useEditor();
  const state = useEditorState(store);
  const [overlap, setOverlap] = useState<number>();
  const [unit, setUnit] = useState<"ms" | "%">("ms");
  const [stretch, setStretch] = useState<number>(150);
  const layers = surfaceLayers(state), refs = state.selection.keys;
  const commit = (ops: EditOp[], label: string, keys?: KeyRef[]) => {
    if (!ops.length) { notify("Select layers with root animation tracks to sequence."); return; }
    const issues = store.commit(ops, label);
    if (issues.length) notify(issues[0].message);
    else { if (keys) store.select({ keys }); onClose(); }
  };
  const transform = (kind: "align" | "distribute" | "stretch" | "reverse") => {
    const doc = store.committed();
    const rows = buildRows(doc, snapshot, { collapsed: [] });
    const byTrack = new Map(rows.flatMap(row => row.kind === "property" ? [[trackKey(row.address), row] as const] : []));
    const selected = refs.flatMap(ref => {
      const row = byTrack.get(trackKey(ref.track));
      return row ? [{ ref, row, time: row.toTime(ref.atMs) }] : [];
    });
    if (!selected.length) return;
    const times = [...new Set(selected.map(key => key.time))].sort((a, b) => a - b);
    const first = times[0], last = times[times.length - 1];
    const playhead = snapToFrame(host.session.timeMs, host.fps);
    const placed = selected.map(({ ref, row, time }) => {
      const next = kind === "align" ? playhead : kind === "reverse" ? first + last - time : kind === "stretch" ? first + (time - first) * stretch / 100
        : first + (last - first) * times.indexOf(time) / (times.length - 1 || 1);
      return { ...ref, toMs: next === time ? ref.atMs : row.fromTime(next) };
    });
    const oneTrack = selected.every(key => key.row === selected[0].row);
    const ops: EditOp[] = kind === "stretch" && oneTrack ? [{ op: "keys.scale", refs, pivotMs: selected[0].row.fromTime(first), factor: stretch / 100 }]
      : kind === "reverse" && oneTrack ? [{ op: "keys.reverse", refs }] : [{ op: "keys.retime", refs: placed }];
    commit(ops, `${kind[0].toUpperCase()}${kind.slice(1)} keyframes`, placed.map(({ track, toMs }) => ({ track, atMs: toMs })));
  };
  return <MotionPanel title="Timing tools" onClose={onClose}>
    {layers.length > 1 && <>
      <NumericField label="Sequence overlap" value={overlap} onChange={setOverlap} min={0} max={unit === "%" ? 100 : undefined}/>
      <label>Overlap unit<select className="ve-input" value={unit} onChange={event => setUnit(event.target.value === "%" ? "%" : "ms")}><option>ms</option><option>%</option></select></label>
      <button className="ve-btn" disabled={(overlap ?? 0) < 0 || (unit === "%" && (overlap ?? 0) > 100)} onClick={() => commit(sequenceOps(store.committed(), layers, overlap ?? 0, unit), "Sequence layers")}>Sequence layers</button>
    </>}
    {refs.length > 0 && <>
      <button className="ve-btn" onClick={() => transform("align")}>Align keyframes to playhead</button>
      <button className="ve-btn" disabled={refs.length < 3} onClick={() => transform("distribute")}>Distribute keyframes evenly</button>
      <button className="ve-btn" disabled={refs.length < 2} onClick={() => transform("reverse")}>Reverse selected keyframes</button>
      <NumericField label="Stretch (%)" value={stretch} min={1} max={10000} onChange={value => setStretch(value ?? 0)}/>
      <button className="ve-btn" disabled={refs.length < 2 || stretch < 1 || stretch > 10000} onClick={() => transform("stretch")}>Stretch keyframes</button>
    </>}
  </MotionPanel>;
}

export function Ungroup({ onClose }: { onClose(): void }) {
  const { store, notify } = useEditor();
  const state = useEditorState(store);
  const doc = store.committed();
  const clips = state.selection.clips;
  const previews = clips.map(id => ({ id, result: bakeDeviation(doc, id) }));
  return <MotionPanel title="Ungroup clips" onClose={onClose}>
    {previews.map(({ id, result }) => <div key={id} role={result.ok ? undefined : "alert"}>{result.ok
      ? result.exact ? `${id} can be ungrouped exactly.` : `${id} will be sampled at 30 Hz. Maximum sampled deviation: ${result.maxDeviation}${result.property ? ` on ${result.property} at ${result.atMs} ms` : ""}.`
      : result.message}</div>)}
    <button className="ve-btn" disabled={!previews.length || previews.some(entry => !entry.result.ok)} onClick={() => {
      const issues = store.commit(previews.map(({ id, result }) => ({ op: "clip.dissolve", id, ...(result.ok && !result.exact ? { bake: { samplesPerSecond: 30 } } : {}) })), "Ungroup clips");
      if (issues.length) notify(issues[0].message);
      else { store.select({ layers: [], clips: [], tracks: [], keys: [] }); onClose(); }
    }}>{previews.some(({ result }) => result.ok && !result.exact) ? "Bake and ungroup" : "Ungroup"}</button>
  </MotionPanel>;
}
