import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { EASING_NAMES, frameAt, type EditOp } from "../../core";
import { useEditor, useEditorState } from "../context";
import { commandById } from "../commands";
import { trackKey } from "../model";
import { motionSpeed } from "../properties";
import type { Doc, KeyRef } from "../store";
import { buildRows, type RowKey, type TimelineRow } from "./Rows";
import { snapTime, type SnapCandidate } from "./snap";
import { Ruler } from "./Ruler";
import { KeyGlyphShape, glyphLabel } from "./Keyframes";
import { ClipBar, staggerHandleX } from "./ClipBar";
import { GraphEditor } from "../graph/GraphEditor";

/** Timeline dock (05.1–05.3, 05.7): dope sheet or graph editor over one session cursor. Every gesture is
 * an EditOp: drags preview transient ops and commit once on release. Rows are virtualized; only keys in
 * the visible time window are drawn. role="grid": rows are properties, cells are keyframes. */
export const ROW_HEIGHT = 24, RULER_HEIGHT = 24;
const MENU_COMMANDS = ["ease.easy", "ease.in", "ease.out", "ease.linear", "ease.auto", "ease.hold", "keyframes.reverse", "timing.open", "clip.group", "clip.ungroup", "stagger.open", "edit.copy", "edit.paste", "keyframes.delete", "agent.ask"];
type PropertyRow = Extract<TimelineRow, { kind: "property" }>;
type ClipRow = Extract<TimelineRow, { kind: "clip" }>;
type Gesture =
  | { kind: "keys"; mode: "move" | "scale"; refs: KeyRef[]; anchor: number; pivot: number; x0: number; moved: boolean; delta: number }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: "clip"; mode: "move" | "start" | "end" | "speed" | "stagger"; row: ClipRow; clip: Doc; x0: number; moved: boolean; delta: number }
  | { kind: "scrub" }
  | { kind: "marker"; index: number; x0: number; time: number; delta: number };
export function timecode(ms: number, fps: number, framesOnly = false): string {
  const frames = frameAt(Math.max(0, ms), fps);
  if (framesOnly) return String(frames);
  const pad = (value: number) => String(value).padStart(2, "0");
  const seconds = Math.floor(frames / fps);
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(frames % fps)}`;
}
const sameRef = (a: KeyRef, b: KeyRef) => a.atMs === b.atMs && trackKey(a.track) === trackKey(b.track);
function findClip(doc: Doc, id: string): Doc | undefined {
  const visit = (clips: Doc[] | undefined): Doc | undefined => { for (const clip of clips ?? []) { if (clip.id === id) return clip; const nested = visit(clip.clips); if (nested) return nested; } return undefined; };
  return visit(doc?.definition?.motion?.clips);
}
export function Timeline() {
  const { store, host, snapshot, controller, notify, setFocused } = useEditor();
  const state = useEditorState(store);
  const doc = state.draft as Doc;
  const session = host.session;
  const speed = motionSpeed(doc);
  const duration = Math.max(1, session.durationMs);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [size, setSize] = useState({ width: 800, height: 220 });
  const [scrollTop, setScrollTop] = useState(0);
  const [framesOnly, setFramesOnly] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [inline, setInline] = useState<{ row: PropertyRow; key: RowKey; x: number; y: number }>();
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number }>();
  const [snapLine, setSnapLine] = useState<{ time: number; kind: string }>();
  const lanes = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const rows = useMemo(() => buildRows(doc, snapshot, { collapsed, labels: doc.editor?.labels }), [doc, snapshot, collapsed]);
  useEffect(() => {
    const element = lanes.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, [state.ui.view]);
  const fit = Math.max(1e-6, (size.width - 24) / duration);
  const pxPerMs = fit * state.ui.zoom;
  const start = Math.max(0, Math.min(state.ui.scroll, Math.max(0, duration - (size.width - 24) / pxPerMs)));
  const x = (time: number) => (time - start) * pxPerMs + 12;
  const timeAtX = (px: number) => (px - 12) / pxPerMs + start;
  const contentHeight = rows.length * ROW_HEIGHT;
  const visibleFirst = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const visibleLast = Math.min(rows.length, Math.ceil((scrollTop + size.height - RULER_HEIGHT) / ROW_HEIGHT) + 2);
  const yOf = (index: number) => RULER_HEIGHT + index * ROW_HEIGHT - scrollTop;
  const windowStart = start - 20 / pxPerMs, windowEnd = start + (size.width + 20) / pxPerMs;
  const selected = state.selection.keys;
  const isSelected = (row: PropertyRow, key: RowKey) => selected.some(ref => ref.atMs === key.atMs && trackKey(ref.track) === row.id);
  const markers = ((doc.editor?.markers ?? []) as { atMs: number; label: string }[]).map((marker, index) => ({ time: marker.atMs / speed, label: marker.label, index }));
  const rowByKey = useMemo(() => new Map(rows.filter((row): row is PropertyRow => row.kind === "property").map(row => [row.id, row])), [rows]);
  const candidates = (exclude: KeyRef[]): SnapCandidate[] => [
    { timeMs: session.timeMs, kind: "playhead" },
    ...rows.slice(visibleFirst, visibleLast).flatMap(row => row.kind === "property" ? row.keys.filter(key => !exclude.some(ref => ref.atMs === key.atMs && trackKey(ref.track) === row.id)).map(key => ({ timeMs: key.time, kind: "keyframe" as const })) : []),
    ...markers.map(marker => ({ timeMs: marker.time, kind: "marker" as const })),
    ...rows.flatMap(row => row.kind === "clip" ? [{ timeMs: row.start, kind: "clip" as const }, { timeMs: row.end, kind: "clip" as const }] : []),
  ];
  /** keys.shift / keys.scale ops for a presentation delta, grouped by each track's local time scale. */
  const retimeOps = (g: Extract<Gesture, { kind: "keys" }>, delta: number): EditOp[] => {
    const groups = new Map<string, { refs: KeyRef[]; local: number; pivot: number; factor: number }>();
    for (const ref of g.refs) {
      const row = rowByKey.get(trackKey(ref.track));
      if (!row) continue;
      const time = row.toTime(ref.atMs);
      if (g.mode === "move") {
        const local = row.fromTime(time + delta) - ref.atMs;
        const key = `move:${local}`;
        if (!groups.has(key)) groups.set(key, { refs: [], local, pivot: 0, factor: 1 });
        groups.get(key)!.refs.push(ref);
      } else {
        const factor = (g.anchor + delta - g.pivot) / (g.anchor - g.pivot);
        const key = `scale:${row.fromTime(g.pivot)}`;
        if (!groups.has(key)) groups.set(key, { refs: [], local: 0, pivot: row.fromTime(g.pivot), factor });
        groups.get(key)!.refs.push(ref);
      }
    }
    return [...groups.values()].map(group => g.mode === "move" ? { op: "keys.shift", refs: group.refs, deltaMs: group.local } as EditOp
      : { op: "keys.scale", refs: group.refs, pivotMs: Math.max(0, group.pivot), factor: Math.max(1e-3, group.factor) } as EditOp);
  };
  const hit = (px: number, py: number): { row: TimelineRow; index: number; key?: RowKey; edge?: "start" | "end" | "stagger" } | undefined => {
    if (py < RULER_HEIGHT) return undefined;
    const index = Math.floor((py - RULER_HEIGHT + scrollTop) / ROW_HEIGHT);
    const row = rows[index];
    if (!row) return undefined;
    if (row.kind === "property") {
      const key = row.keys.reduce<RowKey | undefined>((best, candidate) => Math.abs(x(candidate.time) - px) <= 7 && (!best || Math.abs(x(candidate.time) - px) < Math.abs(x(best.time) - px)) ? candidate : best, undefined);
      return { row, index, key };
    }
    if (row.kind === "clip" && row.staggerHandle && Math.abs(px - staggerHandleX(row, x)) <= 6 && (py - RULER_HEIGHT + scrollTop) % ROW_HEIGHT >= 12)
      return { row, index, edge: "stagger" };
    if (row.kind === "clip" && px >= x(row.start) - 2 && px <= x(row.end) + 2)
      return { row, index, edge: px - x(row.start) < 7 ? "start" : x(row.end) - px < 7 ? "end" : undefined };
    return { row, index };
  };
  const local = (event: { clientX: number; clientY: number }) => { const rect = lanes.current!.getBoundingClientRect(); return { px: event.clientX - rect.left, py: event.clientY - rect.top }; };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 2) return;
    setMenu(undefined);
    const { px, py } = local(event);
    lanes.current!.setPointerCapture(event.pointerId);
    if (py < RULER_HEIGHT) {
      const marker = markers.find(entry => Math.abs(x(entry.time) - px) < 6);
      if (marker) { gesture.current = { kind: "marker", index: marker.index, x0: px, time: marker.time, delta: 0 }; return; }
      gesture.current = { kind: "scrub" };
      session.seek(Math.max(0, Math.min(duration, timeAtX(px))));
      return;
    }
    const target = hit(px, py);
    if (target?.row.kind === "property" && target.key) {
      const ref: KeyRef = { track: target.row.address, atMs: target.key.atMs };
      setFocused({ track: target.row.address, value: target.key.value as number });
      let refs = selected;
      if (event.shiftKey) refs = selected.some(entry => sameRef(entry, ref)) ? selected : [...selected, ref];
      else if (event.ctrlKey || event.metaKey) refs = selected.some(entry => sameRef(entry, ref)) ? selected.filter(entry => !sameRef(entry, ref)) : [...selected, ref];
      else if (!selected.some(entry => sameRef(entry, ref))) refs = [ref];
      store.select({ keys: refs, tracks: [target.row.address] });
      const times = refs.map(entry => rowByKey.get(trackKey(entry.track))?.toTime(entry.atMs) ?? 0);
      const anchor = target.key.time;
      const pivot = Math.abs(anchor - Math.min(...times)) < 1e-9 ? Math.max(...times) : Math.min(...times);
      gesture.current = { kind: "keys", mode: event.altKey && refs.length > 1 ? "scale" : "move", refs, anchor, pivot, x0: px, moved: false, delta: 0 };
      return;
    }
    if (target?.row.kind === "clip") {
      const clip = findClip(store.committed(), target.row.clipId);
      if (!clip) return;
      store.select({ clips: [target.row.clipId], keys: [], tracks: [], layers: [`clip:${target.row.clipId}`] });
      gesture.current = { kind: "clip", mode: event.altKey ? "speed" : target.edge ?? "move", row: target.row, clip, x0: px, moved: false, delta: 0 };
      return;
    }
    if (target?.row.kind === "property" || target?.row.kind === "layer") store.select({ tracks: target.row.kind === "property" ? [target.row.address] : [] });
    gesture.current = { kind: "marquee", x0: px, y0: py, x1: px, y1: py, additive: event.shiftKey || event.ctrlKey || event.metaKey };
  };
  const clipOps = (g: Extract<Gesture, { kind: "clip" }>, delta: number): EditOp[] => {
    const clip = g.clip, authored = delta * g.row.parentRate;
    if (g.mode === "stagger" && clip.stagger && clip.members && g.row.staggerHandle)
      return [{ op: "stagger.set", clipId: clip.id, members: clip.members, eachMs: Math.max(0, Math.round((clip.stagger.eachMs + delta / g.row.staggerHandle.rate) * 1000) / 1000),
        ...(clip.stagger.order !== undefined ? { order: clip.stagger.order } : {}), ...(clip.stagger.ease !== undefined ? { ease: clip.stagger.ease } : {}) } as EditOp];
    if (g.mode === "move") return [{ op: "clip.update", id: clip.id, startMs: Math.max(0, clip.startMs + authored) }];
    const width = (g.row.end - g.row.start) * g.row.parentRate;
    const span = width * (clip.speed ?? 1) / (clip.loop || 1);
    if (g.mode === "speed") return [{ op: "clip.update", id: clip.id, speed: Math.min(4, Math.max(0.05, (clip.speed ?? 1) * width / Math.max(1, width + authored))) }];
    if (g.mode === "end") return [{ op: "clip.update", id: clip.id, durationMs: Math.max(1, span + authored * (clip.speed ?? 1)) }];
    const trim = Math.max(-(clip.inMs ?? 0), Math.min(span - 1, authored * (clip.speed ?? 1)));
    return [{ op: "clip.update", id: clip.id, startMs: Math.max(0, clip.startMs + trim / (clip.speed ?? 1)), inMs: (clip.inMs ?? 0) + trim, durationMs: Math.max(1, span - trim) }];
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const { px, py } = local(event);
    if (g.kind === "scrub") { session.seek(Math.max(0, Math.min(duration, timeAtX(px)))); return; }
    if (g.kind === "marquee") { g.x1 = px; g.y1 = py; setMarquee({ x0: g.x0, y0: g.y0, x1: px, y1: py }); return; }
    const raw = (px - g.x0) / pxPerMs;
    if (g.kind === "marker") { g.delta = snapTime(g.time + raw, { fps: host.fps, pxPerMs, candidates: candidates([]), enabled: state.ui.snap && !event.shiftKey }).timeMs - g.time; setSnapLine({ time: g.time + g.delta, kind: "marker" }); return; }
    if (g.kind === "clip") {
      g.moved = true;
      const edge = g.mode === "end" ? g.row.end : g.row.start;
      const snapped = g.mode === "speed" || g.mode === "stagger" ? { timeMs: edge + raw, kind: "frame" } : snapTime(edge + raw, { fps: host.fps, pxPerMs, candidates: candidates([]), enabled: state.ui.snap && !event.shiftKey });
      g.delta = snapped.timeMs - edge;
      setSnapLine({ time: snapped.timeMs, kind: snapped.kind });
      store.preview(clipOps(g, g.delta));
      return;
    }
    if (!g.moved && Math.abs(px - g.x0) < 3) return;
    g.moved = true;
    const snapped = snapTime(g.anchor + raw, { fps: host.fps, pxPerMs, candidates: candidates(g.refs), enabled: state.ui.snap && !event.shiftKey });
    g.delta = snapped.timeMs - g.anchor;
    setSnapLine({ time: snapped.timeMs, kind: snapped.kind });
    store.preview(retimeOps(g, g.delta));
  };
  const up = () => {
    const g = gesture.current;
    gesture.current = undefined;
    setSnapLine(undefined);
    if (!g) return;
    if (g.kind === "marquee") {
      setMarquee(undefined);
      const [x0, x1] = [Math.min(g.x0, g.x1), Math.max(g.x0, g.x1)], [y0, y1] = [Math.min(g.y0, g.y1), Math.max(g.y0, g.y1)];
      if (x1 - x0 < 3 && y1 - y0 < 3) { if (!g.additive) store.select({ keys: [] }); return; }
      const found: KeyRef[] = [];
      rows.forEach((row, index) => {
        const cy = yOf(index) + ROW_HEIGHT / 2;
        if (row.kind !== "property" || cy < y0 || cy > y1) return;
        for (const key of row.keys) if (x(key.time) >= x0 && x(key.time) <= x1) found.push({ track: row.address, atMs: key.atMs });
      });
      store.select({ keys: g.additive ? [...selected, ...found.filter(ref => !selected.some(entry => sameRef(entry, ref)))] : found });
      return;
    }
    if (g.kind === "marker") {
      if (!g.delta) return;
      const list = [...((store.committed().editor?.markers ?? []) as { atMs: number; label: string }[])];
      list[g.index] = { ...list[g.index], atMs: Math.max(0, (g.time + g.delta) * speed) };
      store.commit([{ op: "editor.set", markers: list.sort((a, b) => a.atMs - b.atMs) }], "Move marker");
      return;
    }
    if (g.kind === "scrub") return;
    if (!g.moved || !g.delta) { store.cancel(); return; }
    if (g.kind === "clip") {
      const issues = store.commit(clipOps(g, g.delta), `${g.mode === "move" ? "Move" : g.mode === "speed" ? "Retime" : g.mode === "stagger" ? "Adjust stagger in" : "Trim"} clip ${g.clip.id}`);
      if (issues.length) notify(issues[0].message);
      return;
    }
    const ops = retimeOps(g, g.delta);
    const issues = store.commit(ops, g.mode === "move" ? `Move ${g.refs.length} keyframe${g.refs.length === 1 ? "" : "s"}` : `Retime ${g.refs.length} keyframes`);
    if (!issues.length) {
      store.select({ keys: g.refs.map(ref => { const row = rowByKey.get(trackKey(ref.track)); if (!row) return ref; const time = row.toTime(ref.atMs);
        return { ...ref, atMs: g.mode === "move" ? row.fromTime(time + g.delta) : row.fromTime(g.pivot + (time - g.pivot) * (g.anchor + g.delta - g.pivot) / (g.anchor - g.pivot)) }; }) });
      return;
    }
    if (issues.some(issue => /exceeds scene duration/.test(issue.message))) {
      const latest = Math.max(...g.refs.map(ref => { const row = rowByKey.get(trackKey(ref.track)); return row ? row.toTime(ref.atMs) + g.delta : 0; }));
      const durationMs = Math.ceil(latest * speed / 100) * 100;
      notify(`Keyframes would pass the scene end.`, { label: `Extend scene to ${(durationMs / 1000).toFixed(1)} s`, run: () => { const more = store.commit([...ops, { op: "motion.set", durationMs }], "Move keyframes and extend scene"); if (more.length) notify(more[0].message); } });
    } else if (issues.some(issue => /collide|already exists/.test(issue.message))) notify("Another keyframe already sits at that time on the same track; move by one more frame.");
    else notify(issues[0].message);
  };
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      const { px } = local(event);
      const at = timeAtX(px);
      const zoom = Math.min(400, Math.max(1, state.ui.zoom * (event.deltaY < 0 ? 1.25 : 0.8)));
      store.setUi({ zoom, scroll: Math.max(0, at - (px - 12) / (fit * zoom)) });
    } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) store.setUi({ scroll: Math.max(0, start + (event.deltaX || event.deltaY) / pxPerMs) });
    else setScrollTop(Math.max(0, Math.min(Math.max(0, contentHeight - size.height + RULER_HEIGHT), scrollTop + event.deltaY)));
  };
  const focusCell = (rowIndex: number, time: number) => {
    const row = rows[rowIndex];
    if (row?.kind !== "property" || !row.keys.length) return false;
    const key = row.keys.reduce((best, candidate) => Math.abs(candidate.time - time) < Math.abs(best.time - time) ? candidate : best);
    if (rowIndex < visibleFirst + 2 || rowIndex > visibleLast - 3) setScrollTop(Math.max(0, rowIndex * ROW_HEIGHT - size.height / 2));
    requestAnimationFrame(() => lanes.current?.querySelector<SVGGElement>(`[data-cell="${CSS.escape(row.id)}@${key.atMs}"]`)?.focus());
    store.select({ keys: [{ track: row.address, atMs: key.atMs }], tracks: [row.address] });
    return true;
  };
  const cellKey = (event: KeyboardEvent<SVGGElement>, rowIndex: number, row: PropertyRow, key: RowKey) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = row.keys.indexOf(key);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = row.keys[index + (event.key === "ArrowRight" ? 1 : -1)];
      if (next) focusCell(rowIndex, next.time);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      for (let i = rowIndex + (event.key === "ArrowDown" ? 1 : -1); i >= 0 && i < rows.length; i += event.key === "ArrowDown" ? 1 : -1) if (focusCell(i, key.time)) break;
    } else if (event.key === "Enter") {
      event.preventDefault();
      setInline({ row, key, x: x(key.time), y: yOf(rowIndex) });
    }
  };
  const openInline = (event: React.MouseEvent<HTMLDivElement>) => {
    const { px, py } = local(event);
    const target = hit(px, py);
    if (target?.row.kind === "property" && target.key) setInline({ row: target.row, key: target.key, x: px, y: py });
  };
  const contextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const { px, py } = local(event);
    const target = hit(px, py);
    if (target?.row.kind === "property" && target.key) {
      const ref = { track: target.row.address, atMs: target.key.atMs };
      if (!selected.some(entry => sameRef(entry, ref))) store.select({ keys: [ref], tracks: [target.row.address] });
    }
    setMenu({ x: event.clientX, y: event.clientY });
  };
  // Row callbacks read the latest closures through one stable object, so memoized rows skip re-renders.
  const api = useRef<LaneApi>({} as LaneApi).current;
  api.cellKey = cellKey;
  api.focus = (row, key) => { if (!isSelected(row, key)) store.select({ keys: [{ track: row.address, atMs: key.atMs }], tracks: [row.address] }); setFocused({ track: row.address, value: key.value as number }); };
  const graph = state.ui.view === "graph";
  const visibleRows = rows.slice(visibleFirst, visibleLast);
  const inWindow = (key: RowKey) => key.time >= windowStart && key.time <= windowEnd;
  const selectedRow = visibleRows.findIndex(row => row.kind === "property" &&
    selected.some(ref => trackKey(ref.track) === row.id && row.keys.some(key => key.atMs === ref.atMs && inWindow(key))));
  const entryRow = selectedRow >= 0 ? selectedRow :
    visibleRows.findIndex(row => row.kind === "property" && row.keys.some(inWindow));
  return <div className="ve-panel" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }} data-velora-editor-timeline="">
    <div className="ve-tl-head" role="toolbar" aria-label="Timeline controls">
      <button className="ve-btn" onClick={session.toggle} aria-label={session.playing ? "Pause" : "Play"}>{session.playing ? "❚❚" : "▶"}</button>
      <button className="ve-btn" onClick={() => session.seek(0)} aria-label="Restart">↺</button>
      <span className="ve-tc" aria-live="off" data-testid="editor-timecode">{timecode(session.timeMs, host.fps, framesOnly)} / {timecode(session.durationMs, host.fps, framesOnly)}</span>
      <button className="ve-btn" aria-pressed={framesOnly} onClick={() => setFramesOnly(!framesOnly)} title="Show frames only">{host.fps} fps</button>
      <span role="group" aria-label="Timeline view" style={{ display: "inline-flex", gap: 2 }}>
        <button className="ve-btn" aria-pressed={!graph} onClick={() => store.setUi({ view: "dope" })}>Dope sheet</button>
        <button className="ve-btn" aria-pressed={graph} onClick={() => store.setUi({ view: "graph" })}>Graph (G)</button>
      </span>
      <button className="ve-btn ve-icon" aria-label="Zoom out" onClick={() => controller.zoom(-1)}>−</button>
      <button className="ve-btn ve-icon" aria-label="Zoom in" onClick={() => controller.zoom(1)}>+</button>
      <button className="ve-btn" onClick={() => controller.zoom(0)}>Fit</button>
      <button className="ve-btn" onClick={() => commandById("marker.add")!.run({ ...controller, state: store.getState() })} title="Add marker (M)">⚑ Marker</button>
      <button className="ve-btn" onClick={() => controller.open("easing")} title="Easing library (E)">Easing</button>
    </div>
    {graph ? <GraphEditor/> : <div className="ve-tl" style={{ minHeight: 0 }}>
      <div className="ve-labels" role="presentation" onWheel={event => setScrollTop(Math.max(0, Math.min(Math.max(0, contentHeight - size.height + RULER_HEIGHT), scrollTop + event.deltaY)))}>
        {rows.slice(visibleFirst, visibleLast).map((row, offset) => {
          const index = visibleFirst + offset;
          const collapsible = row.kind === "layer" || row.kind === "clip";
          const isRowSelected = row.kind === "property" && state.selection.tracks.some(track => trackKey(track) === row.id);
          return <div key={row.id} className="ve-label" data-kind={row.kind} data-selected={isRowSelected} style={{ top: yOf(index), paddingLeft: row.kind === "property" ? 20 : row.kind === "clip" ? 8 + row.depth * 10 : 8 }}
            onClick={event => {
              if (row.kind === "clip") store.select({ clips: [row.clipId], keys: [], tracks: [], layers: [row.id] });
              if (row.kind === "property") store.select({ tracks: [row.address], keys: [], layers: [row.layer], clips: row.address.clip ? [row.address.clip] : [] });
              if (row.kind === "layer") {
                const id = row.id.slice(6), existing = state.selection.layers.filter(layer => !layer.startsWith("clip:"));
                const toggle = event.ctrlKey || event.metaKey;
                const layers = event.shiftKey || toggle ? existing.includes(id) ? toggle ? existing.filter(layer => layer !== id) : existing : [...existing, id] : [id];
                store.select({ layers, clips: [], tracks: [], keys: [] });
              }
            }}>
            {collapsible && <button className="ve-btn ve-icon" style={{ minHeight: 16, border: 0, background: "none" }} aria-label={collapsed.includes(row.id) ? "Expand row" : "Collapse row"}
              onClick={event => { event.stopPropagation(); setCollapsed(collapsed.includes(row.id) ? collapsed.filter(id => id !== row.id) : [...collapsed, row.id]); }}>{collapsed.includes(row.id) ? "▸" : "▾"}</button>}
            <span>{row.label}</span>
            {row.kind === "property" && row.static && <span style={{ color: "var(--ve-dim)" }}>static</span>}
            {row.kind === "property" && row.smooth && <span style={{ color: "var(--ve-dim)" }}>smooth</span>}
          </div>;
        })}
      </div>
      <div ref={lanes} className="ve-lanes" role="grid" aria-label="Keyframes" aria-rowcount={rows.length}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { gesture.current = undefined; store.cancel(); setMarquee(undefined); setSnapLine(undefined); }}
        onWheel={wheel} onDoubleClick={openInline} onContextMenu={contextMenu}>
        <svg width={size.width} height={size.height} style={{ display: "block" }}>
          <g data-rows="" transform={`translate(0 ${RULER_HEIGHT - scrollTop})`}>
            {visibleRows.map((row, offset) => {
              const index = visibleFirst + offset;
              const picked = row.kind === "property" ? selected.filter(ref => trackKey(ref.track) === row.id).map(ref => ref.atMs).join(",") : "";
              const entry = offset === entryRow;
              return <LaneRow key={row.id} row={row} index={index} width={size.width} start={start} pxPerMs={pxPerMs} picked={picked} entry={entry}
                clipSelected={row.kind === "clip" && state.selection.clips.includes(row.clipId)} api={api}/>;
            })}
          </g>
          <Ruler width={size.width} start={start} pxPerMs={pxPerMs} durationMs={duration} markers={markers} workArea={state.ui.workArea} playhead={session.timeMs}/>
          <line data-playhead="" x1={x(session.timeMs)} x2={x(session.timeMs)} y1={0} y2={size.height} stroke="#ff8a3d" strokeWidth={1.5} style={{ pointerEvents: "none" }}/>
          {snapLine && <line x1={x(snapLine.time)} x2={x(snapLine.time)} y1={RULER_HEIGHT} y2={size.height} stroke="#5ee6a0" strokeDasharray="3 3" style={{ pointerEvents: "none" }}><title>{snapLine.kind}</title></line>}
          {marquee && <rect x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)} width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)} fill="#7cc4ff22" stroke="#7cc4ff"/>}
        </svg>
        {inline && <InlineKey row={inline.row} keyframe={inline.key} x={inline.x} y={inline.y} onClose={() => setInline(undefined)}/>}
      </div>
    </div>}
    {menu && <div className="ve-menu" role="menu" style={{ left: menu.x, top: menu.y }} data-velora-preview-chrome="" onKeyDown={event => { if (event.key === "Escape") setMenu(undefined); }}>
      {MENU_COMMANDS.map(id => commandById(id)!).map(command => <button key={command.id} role="menuitem" disabled={!command.enabled(state)}
        onClick={() => { setMenu(undefined); command.run({ ...controller, state: store.getState() }); }}>{command.label}<span className="ve-kbd">{command.shortcuts[0] ?? ""}</span></button>)}
    </div>}
  </div>;
}
function InlineKey({ row, keyframe, x, y, onClose }: { row: PropertyRow; keyframe: RowKey; x: number; y: number; onClose(): void }) {
  const { store, notify } = useEditor();
  const [time, setTime] = useState(String(keyframe.atMs));
  const [value, setValue] = useState(typeof keyframe.value === "string" ? keyframe.value : JSON.stringify(keyframe.value));
  const [easing, setEasing] = useState(typeof keyframe.easing === "string" ? keyframe.easing : keyframe.easing ? "custom" : "cinematic");
  const apply = () => {
    const parsed = (() => { try { return JSON.parse(value); } catch { return value; } })();
    const ops: EditOp[] = [{ op: "key.set", track: row.address, atMs: keyframe.atMs, value: parsed, ...(easing !== "custom" ? { easing } : {}) } as EditOp];
    const next = Number(time);
    if (Number.isFinite(next) && next !== keyframe.atMs) ops.push({ op: "key.move", track: row.address, fromMs: keyframe.atMs, toMs: next });
    const issues = store.commit(ops, `Edit ${row.label} keyframe`);
    if (issues.length) notify(issues[0].message); else onClose();
  };
  return <div className="ve-popover" role="dialog" aria-label={`Edit ${row.label} keyframe`} style={{ position: "absolute", left: Math.max(0, x - 140), top: Math.max(0, y - 10), minWidth: 260 }}
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") onClose(); if (event.key === "Enter") apply(); event.stopPropagation(); }}>
    <label style={{ display: "grid", gap: 2 }}>Time (ms)<input className="ve-input" autoFocus value={time} onChange={event => setTime(event.target.value)}/></label>
    <label style={{ display: "grid", gap: 2 }}>Value<input className="ve-input" value={value} onChange={event => setValue(event.target.value)}/></label>
    <label style={{ display: "grid", gap: 2 }}>Easing<select className="ve-input" value={easing} onChange={event => setEasing(event.target.value)}>
      {easing === "custom" && <option value="custom">custom (keep)</option>}
      {["auto", ...EASING_NAMES].map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}><button className="ve-btn" onClick={apply}>Apply</button><button className="ve-btn" onClick={onClose}>Cancel</button></div>
  </div>;
}

type LaneApi = { cellKey(event: KeyboardEvent<SVGGElement>, rowIndex: number, row: PropertyRow, key: RowKey): void; focus(row: PropertyRow, key: RowKey): void };
const GLYPH_PATH: Record<string, (x: number, y: number) => string> = {
  linear: (x, y) => `M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`,
  auto: (x, y) => `M${x - 5} ${y}a5 5 0 1 0 10 0a5 5 0 1 0 -10 0`,
  hold: (x, y) => `M${x - 5} ${y - 5}h10v10h-10Z`,
  spring: (x, y) => `M${x} ${y - 6}L${x + 2} ${y - 2}L${x + 6} ${y}L${x + 2} ${y + 2}L${x} ${y + 6}L${x - 2} ${y + 2}L${x - 6} ${y}L${x - 2} ${y - 2}Z`,
  ease: (x, y) => `M${x - 5} ${y - 6}H${x + 5}L${x - 5} ${y + 6}H${x + 5}Z`,
};
/** One timeline row at a fixed y inside the scrolled group. Dense rows draw glyphs as one path per glyph
 * kind (no node per keyframe) and keep focusable grid cells for selected keys and the row's entry key. */
const LaneRow = memo(function LaneRow({ row, index, width, start, pxPerMs, picked, entry, clipSelected, api }: { row: TimelineRow; index: number; width: number; start: number; pxPerMs: number;
  picked: string; entry: boolean; clipSelected: boolean; api: LaneApi }) {
  const y = index * ROW_HEIGHT, mid = y + ROW_HEIGHT / 2;
  const x = (time: number) => (time - start) * pxPerMs + 12;
  const windowStart = start - 20 / pxPerMs, windowEnd = start + (width + 20) / pxPerMs;
  if (row.kind === "clip") return <g role="row" aria-rowindex={index + 1} aria-label={row.label}>
    <g role="gridcell" aria-selected={clipSelected}><ClipBar row={row} x={x} y={y} pxPerMs={pxPerMs} selected={clipSelected}/></g>
  </g>;
  if (row.kind === "badge") return <g role="row" aria-rowindex={index + 1}>
    <text role="gridcell" x={16} y={mid + 4} fontSize={11} fill="#a9a9b6">{row.label}</text>
  </g>;
  if (row.kind === "layer") {
    const d = row.summary.filter(time => time >= windowStart && time <= windowEnd).map(time => `M${x(time)} ${mid - 4}l4 4l-4 4l-4 -4Z`).join("");
    return <g role="row" aria-rowindex={index + 1} aria-label={row.label}>
      <g role="gridcell" aria-label={`${row.summary.length} keyframe times`}><rect x={0} y={y} width={width} height={ROW_HEIGHT} fill="#17171b"/><path d={d} fill="#a9a9b6"/></g>
    </g>;
  }
  const selectedTimes = new Set(picked ? picked.split(",").map(Number) : []);
  const keys = row.keys.filter(key => key.time >= windowStart && key.time <= windowEnd);
  const dense = keys.length > width / 10;
  const entryKey = entry ? keys.find(key => selectedTimes.has(key.atMs)) ?? keys[0] : undefined;
  const cells = dense ? keys.filter(key => selectedTimes.has(key.atMs) || key === entryKey) : keys;
  const paths: Record<string, string> = {};
  if (dense) for (const key of keys) if (!selectedTimes.has(key.atMs)) paths[row.smooth ? "auto" : key.glyph] = (paths[row.smooth ? "auto" : key.glyph] ?? "") + GLYPH_PATH[row.smooth ? "auto" : key.glyph](x(key.time), mid);
  return <g role="row" aria-rowindex={index + 1} aria-label={`${row.label}${dense ? `, ${keys.length} keyframes (zoom in to reach each one)` : ""}`}>
    {row.keys.length > 1 && <line x1={x(row.keys[0].time)} x2={x(row.keys[row.keys.length - 1].time)} y1={mid} y2={mid} stroke={row.smooth ? "#7cc4ff" : "#ffffff22"} strokeWidth={row.smooth ? 2 : 1}/>}
    {Object.entries(paths).map(([glyph, d]) => <path key={glyph} d={d} fill={row.smooth ? "none" : "var(--ve-key)"} stroke={row.smooth ? "var(--ve-key)" : "#0006"} strokeWidth={row.smooth ? 2 : 1}/>)}
    {!cells.length && <g role="gridcell" aria-label="No keyframes in view"/>}
    {cells.map(key => {
      const on = selectedTimes.has(key.atMs);
      const label = `${row.layer.replace(/^clip:/, "clip ")} ${row.label}, keyframe at ${(key.atMs / 1000).toFixed(2)} s, value ${typeof key.value === "number" ? Math.round(key.value * 1000) / 1000 : JSON.stringify(key.value)}, easing ${typeof key.easing === "string" ? key.easing : key.easing ? "custom" : "cinematic"} (${glyphLabel[key.glyph]})`;
      return <g key={key.atMs} className="ve-kf" role="gridcell" aria-label={label} aria-selected={on} tabIndex={key === entryKey ? 0 : -1}
        data-cell={`${row.id}@${key.atMs}`} onKeyDown={event => api.cellKey(event, index, row, key)} onFocus={() => api.focus(row, key)}>
        <KeyGlyphShape glyph={key.glyph} x={x(key.time)} y={mid} selected={on} smooth={row.smooth}/>
      </g>;
    })}
  </g>;
});
