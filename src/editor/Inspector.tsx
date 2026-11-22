import type { SceneSnapshot } from "../react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { applyLens, EASING_NAMES, LENS_PRESETS, LensPresetSchema, focalLengthForPerspective, perspectiveForFocalLength, type EditOp, type TrackAddress } from "../core";
import { DEFAULT_DEPTH_LIGHT, DepthConfigSchema, DepthIntensitySchema, DepthModeSchema, type DepthConfig } from "../core/depth";
import { useEditor, useEditorState } from "./context";
import { intentToOps, isAnimated, type PropertyIntent } from "./intents";
import { findTrack, listClips, listTracks, trackKey } from "./model";
import { ClipInspector } from "./ClipInspector";
import { CAMERA_PROPS, FOCUS_PROPS, TRANSFORM_PROPS, VISUAL_PROPS, keyAtPlayhead, stateAt, toAuthored, toPresentation, valueAt, type PropertySpec } from "./properties";
import type { Doc } from "./store";
import { rackOps } from "./viewport/FocusTool";

/** Inspector (EDITOR-UX §2, §4, §6): grouped properties of the selection. Every change goes through
 * intentToOps; drags preview transient ops at pointer rate and commit once on release. */
const fmt = (value: unknown) => typeof value === "number" ? String(Math.round(value * 1000) / 1000) : value === undefined ? "" : String(value);
function usePropertyActions() {
  const { store, host, controller, setFocused } = useEditor();
  const state = useEditorState(store);
  const context = () => ({ timeMs: toAuthored(store.committed(), host.session.timeMs), fps: host.fps, autoKey: state.ui.autoKey, armed: state.ui.armed });
  const ops = (intent: PropertyIntent) => intentToOps(intent, store.committed(), context());
  return {
    preview: (intent: PropertyIntent) => store.preview(ops(intent)),
    commit: (intent: PropertyIntent, merge = false) => {
      const batch = ops(intent);
      const issues = store.commit(batch, undefined, { merge });
      if (issues.length) controller.notify(issues[0].message);
      return issues;
    },
    focus: (track: TrackAddress, value: number | string) => setFocused({ track, value }),
    store, state, host,
  };
}
function NumberField({ value, spec, italic, label, onPreview, onCommit, onCancel }: { value: number | undefined; spec: PropertySpec; italic: boolean; label: string;
  onPreview(value: number): void; onCommit(value: number, merge?: boolean): void; onCancel(): void }) {
  const [text, setText] = useState<string>();
  const drag = useRef<{ x: number; start: number; moved: boolean; last: number } | undefined>(undefined);
  const clamp = (next: number) => Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, next));
  const round = (next: number) => Math.round(next / spec.step) * spec.step;
  const down = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (value === undefined) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start: value, moved: false, last: value };
  };
  const move = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const current = drag.current;
    if (!current) return;
    const factor = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const next = clamp(round(current.start + (event.clientX - current.x) * spec.step * factor));
    if (next === current.last) return;
    current.moved = true; current.last = next;
    onPreview(next);
  };
  const up = () => { const current = drag.current; drag.current = undefined; if (current?.moved) onCommit(current.last); };
  return <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
    <span className="ve-scrub" aria-hidden="true" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = undefined; onCancel(); }}
      onKeyDown={event => { if (event.key === "Escape") { drag.current = undefined; onCancel(); } }}>⇔</span>
    <input className={`ve-input${italic ? " ve-italic" : ""}`} aria-label={label} inputMode="decimal" value={text ?? fmt(value)}
      onFocus={event => event.currentTarget.select()} onChange={event => setText(event.target.value)}
      onBlur={() => { if (text !== undefined && Number.isFinite(Number(text)) && text.trim() !== "") onCommit(clamp(Number(text))); setText(undefined); }}
      onKeyDown={event => {
        if (event.key === "Enter") { event.currentTarget.blur(); return; }
        if (event.key === "Escape") { setText(undefined); event.currentTarget.blur(); return; }
        if ((event.key === "ArrowUp" || event.key === "ArrowDown") && value !== undefined) {
          event.preventDefault(); event.stopPropagation();
          onCommit(clamp(round(value + (event.key === "ArrowUp" ? 1 : -1) * spec.step * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1))), true);
        }
      }}/>
    {spec.unit && <span style={{ color: "var(--ve-dim)" }}>{spec.unit}</span>}
  </span>;
}
type RowProps = { track: TrackAddress; spec: PropertySpec; kind?: "number" | "color" | "boolean" | "enum"; options?: readonly string[]; label?: string; fallback?: number | string };
function PropertyRow({ track, spec, kind = "number", options, label, fallback }: RowProps) {
  const { snapshot } = useEditor();
  const actions = usePropertyActions();
  const { state, host, store } = actions;
  const doc = state.draft as Doc;
  const authored = toAuthored(doc, host.session.timeMs);
  const raw = valueAt(doc, track, stateAt(doc, host.session.timeMs), snapshot) ?? fallback;
  const value = kind === "boolean" ? (typeof raw === "number" ? raw : 0) : kind === "enum" ? (typeof raw === "number" ? raw : 0) : raw;
  const animated = isAnimated(doc, track, state.ui.armed);
  const existing = findTrack(doc, track);
  const atKey = keyAtPlayhead(doc, track, authored);
  const italic = animated && !atKey;
  const name = label ?? spec.label ?? spec.name;
  const key = trackKey(track);
  const times: number[] = existing?.keyframes.map((frame: { timeMs: number }) => frame.timeMs) ?? [];
  const seekTo = (authoredMs: number | undefined) => { if (authoredMs !== undefined) host.session.seek(toPresentation(doc, authoredMs)); };
  const stopwatch = () => {
    if (animated) {
      if (existing && existing.keyframes.length > 1 && typeof confirm === "function" && !confirm(`Remove ${existing.keyframes.length} keyframes of ${name}? (Undo restores them.)`)) return;
      actions.commit({ kind: "stopwatch", track, on: false, value: value ?? 0 });
      store.setUi({ armed: state.ui.armed.filter(entry => entry !== key) });
    } else {
      actions.commit({ kind: "stopwatch", track, on: true, value: value ?? 0 });
      store.setUi({ armed: [...state.ui.armed, key] });
    }
  };
  const set = (next: number | string, merge = false) => actions.commit({ kind: "set", track, value: next }, merge);
  const selected = state.selection.tracks.some(entry => trackKey(entry) === key);
  return <div className="ve-prop" role="group" aria-label={name} data-property={key} style={selected ? { background: "#1d3347" } : undefined}
    onFocusCapture={() => { actions.focus(track, value ?? 0); store.select({ tracks: [track] }); }}>
    <button className="ve-watch" aria-pressed={animated} aria-label={`${animated ? "Stop animating" : "Animate"} ${name}`} title="Stopwatch" onClick={stopwatch}>⏱</button>
    <label title={name}>{name}{existing && existing.keyframes.length === 1 && !animated ? <span style={{ color: "var(--ve-dim)" }}> · static</span> : null}</label>
    <span className="ve-nav">
      <button aria-label={`Previous ${name} keyframe`} disabled={!times.some(time => time < authored - 1e-6)} onClick={() => seekTo([...times].reverse().find(time => time < authored - 1e-6))}>◀</button>
      <button aria-label={`${atKey ? "Remove" : "Add"} ${name} keyframe at playhead`} data-on={atKey} onClick={() => actions.commit({ kind: "toggle-key", track, value: value ?? 0 })}>{atKey ? "◆" : "◇"}</button>
      <button aria-label={`Next ${name} keyframe`} disabled={!times.some(time => time > authored + 1e-6)} onClick={() => seekTo(times.find(time => time > authored + 1e-6))}>▶</button>
    </span>
    {kind === "number" ? <NumberField value={typeof value === "number" ? value : undefined} spec={spec} italic={italic} label={`${name} value`}
      onPreview={next => actions.preview({ kind: "set", track, value: next })} onCommit={(next, merge) => set(next, merge)} onCancel={() => store.cancel()}/>
      : kind === "color" ? <span style={{ display: "flex", gap: 4 }}>
        <input type="color" aria-label={`${name} color`} value={toHex(value)} onChange={event => set(event.target.value)} style={{ width: 28, height: 22, padding: 0, border: 0, background: "none" }}/>
        <input className={`ve-input${italic ? " ve-italic" : ""}`} aria-label={`${name} value`} defaultValue={fmt(value)} key={fmt(value)} onKeyDown={event => { if (event.key === "Enter") set(event.currentTarget.value.trim()); }}/>
      </span>
        : kind === "boolean" ? <input type="checkbox" aria-label={`${name} value`} checked={Number(value) >= 0.5} onChange={event => set(event.target.checked ? 1 : 0)}/>
          : <select className="ve-input" aria-label={`${name} value`} value={Math.round(Number(value))} onChange={event => set(Number(event.target.value))}>
            {(options ?? []).map((option, index) => <option key={option} value={index}>{option}</option>)}
          </select>}
  </div>;
}
function toHex(value: unknown): string {
  const text = String(value ?? "");
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  const match = /^rgb\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(text);
  return match ? "#" + match.slice(1, 4).map(part => Math.round(Number(part)).toString(16).padStart(2, "0")).join("") : "#000000";
}
const Group = ({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) =>
  <details className="ve-group" open={open}><summary>{title}</summary>{children}</details>;
function LensRow() {
  const { store, host, controller } = useEditor();
  const state = useEditorState(store);
  const [holdFraming, setHoldFraming] = useState(true);
  const doc = state.draft as Doc;
  const perspective = Number(valueAt(doc, { target: { kind: "camera" }, property: "perspective" }, stateAt(doc, host.session.timeMs), undefined) ?? 1400);
  const height = host.frame.height || 980;
  const mm = focalLengthForPerspective(perspective, height);
  const apply = (next: number) => {
    try {
      const value = perspectiveForFocalLength(next, height);
      const ops = intentToOps({ kind: "set", track: { target: { kind: "camera" }, property: "perspective" }, value }, store.committed(),
        { timeMs: toAuthored(store.committed(), host.session.timeMs), fps: host.fps, autoKey: state.ui.autoKey, armed: state.ui.armed });
      store.commit(ops, `Lens ${next} mm`);
    } catch (error) { controller.notify((error as Error).message); }
  };
  return <div className="ve-prop"><span/><label>Lens</label><span/>
    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <input key={Math.round(mm * 10)} className="ve-input" aria-label="Lens millimetres" defaultValue={Math.round(mm * 10) / 10} onKeyDown={event => { if (event.key === "Enter") apply(Number(event.currentTarget.value)); }}/>
    </span>
    <span/><label><input type="checkbox" checked={holdFraming} onChange={event => setHoldFraming(event.target.checked)}/> Hold framing</label><span/>
    <span style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>{LensPresetSchema.options.map(preset => <button type="button" className="ve-btn" key={preset}
      aria-label={preset} onClick={() => {
        const hold = holdFraming ? "framing" : "position";
        try {
          const review = applyLens(doc.definition, preset, { hold });
          const issues = store.commit([{ op: "lens.apply", preset, hold }], `Apply ${preset}`);
          const first = issues[0] ?? review.issues[0];
          if (first) controller.notify(first.message);
        } catch (error) { controller.notify((error as Error).message); }
      }}>{LENS_PRESETS[preset].mm}{preset === "24mm-drone" ? " drone" : ""}</button>)}</span>
  </div>;
}

function RackControls() {
  const { store, host, snapshot, controller } = useEditor();
  const { ui } = useEditorState(store);
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const layers = (snapshot?.depth ?? []).flatMap((surface, source) => surface.layers.flatMap(({ match }, index) => {
    const focus = surface.focus?.[index];
    const label = "anchor" in match ? match.anchor : match.selector;
    return focus ? [{ id: `depth:${source}:${index}`, label, focus }] : [];
  }));
  if (!snapshot) return null;
  const options = [...snapshot.bindings.map(node => ({ id: node.id, label: node.id })), ...layers];
  const field = (label: string, value: string, update: (value: string) => void) => <select aria-label={label} className="ve-input" value={value} onChange={event => update(event.target.value)}>
    <option value="">{label}</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
  </select>;
  return <div style={{ padding: "4px 10px" }}>
    <div style={{ display: "flex", gap: 4 }}>{field("Rack from", from, setFrom)}{field("Rack to", to, setTo)}
      <button type="button" className="ve-btn" disabled={!from || !to || from === to} onClick={() => {
        const doc = store.committed(), time = host.session.timeMs;
        const start = toAuthored(doc, ui.workArea?.startMs ?? time), end = toAuthored(doc, ui.workArea?.endMs ?? Math.min(host.session.durationMs, time + 1500));
        const rack = rackOps(doc, snapshot, from, to, start, end, host.fps);
        if (!rack) { controller.notify("Choose two visible layers and a work area with room for the rack."); return; }
        const issues = store.commit(rack.ops, "Rack focus");
        if (issues.length) controller.notify(issues[0].message);
      }}>Add rack</button>
    </div>
    {layers.map(({ id, label, focus }) => <div key={id} title={label}>{label} · {focus.signed.toFixed(1)} px {focus.signed < 0 ? "front" : "back"} · {focus.blur.toFixed(2)} px blur</div>)}
  </div>;
}
function EasingAtPlayhead() {
  const { store, host, controller } = useEditor();
  const state = useEditorState(store);
  const doc = state.draft as Doc;
  const track = state.selection.tracks[0];
  if (!track) return <p style={{ padding: "4px 10px", color: "var(--ve-dim)" }}>Focus an animated property to see the easing of its keyframe at the playhead.</p>;
  const found = findTrack(doc, track);
  const authored = toAuthored(doc, host.session.timeMs);
  const frame = found?.keyframes.filter((entry: { timeMs: number }) => entry.timeMs <= authored + 1e-6).pop();
  const last = found && frame === found.keyframes[found.keyframes.length - 1];
  if (!found || !frame || last) return <p style={{ padding: "4px 10px", color: "var(--ve-dim)" }}>No outgoing segment at the playhead.</p>;
  const easing = frame.easing ?? "cinematic";
  const named = typeof easing === "string" ? easing : "custom";
  return <div className="ve-prop"><span/><label>@ {Math.round(frame.timeMs)} ms</label><span/>
    <select className="ve-input" aria-label="Easing of the segment at the playhead" value={named} onChange={event => {
      const value = event.target.value;
      if (value === "custom") { controller.open("easing"); return; }
      store.commit([{ op: "key.ease", track, atMs: frame.timeMs, easing: value } as EditOp]);
    }}>
      {named === "custom" && <option value="custom">{JSON.stringify(easing).slice(0, 28)}</option>}
      {["auto", ...EASING_NAMES].map(name => <option key={name} value={name}>{name}</option>)}
    </select></div>;
}
function MotionGroup() {
  const { store, controller } = useEditor();
  const state = useEditorState(store);
  const motion = (state.draft as Doc).definition?.motion;
  const set = (patch: Record<string, unknown>) => { const issues = store.commit([{ op: "motion.set", ...patch } as EditOp]); if (issues.length) controller.notify(issues[0].message); };
  return <>
    <div className="ve-prop"><span/><label>Duration</label><span/>
      <input className="ve-input" aria-label="Scene duration in milliseconds" defaultValue={motion?.durationMs ?? 0} key={motion?.durationMs ?? 0}
        onKeyDown={event => { if (event.key === "Enter") set({ durationMs: Number(event.currentTarget.value) }); }}/></div>
    <div className="ve-prop"><span/><label>Speed</label><span/>
      <input className="ve-input" aria-label="Playback speed" defaultValue={motion?.speed ?? 0.5} key={motion?.speed ?? 0.5}
        onKeyDown={event => { if (event.key === "Enter") set({ speed: Number(event.currentTarget.value) }); }}/></div>
    <div className="ve-prop"><span/><label>Loop</label><span/>
      <input type="checkbox" aria-label="Loop preview" checked={!!motion?.loop} onChange={event => set({ loop: event.target.checked ? true : null })}/></div>
  </>;
}
function Constraints({ surface }: { surface?: string }) {
  const { store, controller } = useEditor();
  const state = useEditorState(store);
  const constraints = ((state.draft as Doc).definition?.scene?.constraints ?? []) as { kind: string; target: { surface?: string; point?: number[] }; weight?: unknown }[];
  const commit = (op: EditOp) => { const issues = store.commit([op]); if (issues.length) controller.notify(issues[0].message); };
  return <div style={{ padding: "4px 10px", display: "grid", gap: 4 }}>
    {constraints.map((constraint, index) => <div key={index} style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span>{constraint.kind} → {constraint.target.surface ?? JSON.stringify(constraint.target.point)}</span>
      <input className="ve-input" style={{ width: 56 }} aria-label={`Weight of ${constraint.kind} constraint`} defaultValue={typeof constraint.weight === "number" ? constraint.weight : 1}
        onKeyDown={event => { if (event.key === "Enter") commit({ op: "constraint.set", index, constraint: { ...constraint, weight: Math.max(0, Math.min(1, Number(event.currentTarget.value))) } } as EditOp); }}/>
      <button className="ve-btn" onClick={() => commit({ op: "constraint.remove", index })} aria-label={`Remove ${constraint.kind} constraint`}>Remove</button>
    </div>)}
    {surface && <div style={{ display: "flex", gap: 6 }}>
      <button className="ve-btn" onClick={() => commit({ op: "constraint.set", constraint: { kind: "lookAt", target: { surface } } } as EditOp)}>Aim camera here</button>
      <button className="ve-btn" onClick={() => commit({ op: "constraint.set", constraint: { kind: "focusFollow", target: { surface } } } as EditOp)}>Follow focus here</button>
    </div>}
  </div>;
}
function StyleVars({ id }: { id: string }) {
  const { store, host, controller } = useEditor();
  const state = useEditorState(store);
  const doc = state.draft as Doc;
  const vars = listTracks(doc).filter(entry => entry.address.target.kind === "style" && "id" in entry.address.target && entry.address.target.id === id && !entry.clip);
  const [name, setName] = useState("--");
  const [value, setValue] = useState("");
  return <>
    {vars.map(entry => <PropertyRow key={entry.key} track={entry.address} spec={{ name: entry.address.property, step: 1 }} kind={typeof entry.track.keyframes[0].value === "string" ? "color" : "number"}/>)}
    <div style={{ display: "flex", gap: 4, padding: "4px 10px" }}>
      <input className="ve-input" aria-label="New CSS variable name" value={name} onChange={event => setName(event.target.value)}/>
      <input className="ve-input" aria-label="New CSS variable value" placeholder="12 or #ff8800" value={value} onChange={event => setValue(event.target.value)}/>
      <button className="ve-btn" onClick={() => {
        const parsed = /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value.trim();
        const ops = intentToOps({ kind: "set", track: { target: { kind: "style", id }, property: name.trim() }, value: parsed }, store.committed(),
          { timeMs: toAuthored(store.committed(), host.session.timeMs), fps: host.fps, autoKey: state.ui.autoKey, armed: state.ui.armed });
        const issues = store.commit(ops, `Add ${name.trim()}`);
        if (issues.length) controller.notify(issues[0].message); else { setName("--"); setValue(""); }
      }}>Add var</button>
    </div>
  </>;
}
function AnimatableProperties({ entries, objectLabels = false }: { entries: SceneSnapshot["animatables"]; objectLabels?: boolean }) {
  return <>{entries.flatMap(entry => Object.entries(entry.spec).map(([prop, spec]) =>
    <PropertyRow key={`${entry.id}.${prop}`} track={{ target: { kind: "channel", id: `${entry.id}.${prop}` }, property: "value" }}
      label={objectLabels ? (spec.label ?? prop) : `${entry.id}.${prop}`}
      spec={{ name: prop, step: spec.type === "number" ? (spec.step ?? 1) : 1, ...(spec.type === "number" ? { unit: spec.unit, min: spec.min, max: spec.max } : {}) }}
      kind={spec.type} options={spec.type === "enum" ? spec.options : undefined}
      fallback={spec.type === "boolean" ? (spec.default ? 1 : 0) : spec.type === "enum" ? Math.max(0, spec.options.indexOf(spec.default)) : spec.default}/>))}</>;
}
function DepthProperties({ id }: { id: string }) {
  const { store, snapshot, controller } = useEditor();
  const state = useEditorState(store);
  const authored = DepthConfigSchema.safeParse((state.draft as Doc).definition?.depth?.[id]);
  const live = snapshot?.depth?.some(entry => entry.surface === id);
  const config: DepthConfig = authored.data ?? { mode: live ? "auto" : "off" };
  const light = { ...DEFAULT_DEPTH_LIGHT, ...config.light };
  const update = (patch: Partial<DepthConfig>, preview = false) => {
    const base = DepthConfigSchema.safeParse((store.committed() as Doc).definition?.depth?.[id]).data ?? config;
    const op: EditOp = { op: "depth.set", surface: id, config: { ...base, ...patch } };
    if (preview) store.preview([op]);
    else {
      const issues = store.commit([op]);
      if (issues.length) controller.notify(issues[0].message);
    }
  };
  const sliders = [
    { name: "azimuthDeg", label: "Light azimuth", unit: "°", min: -360, max: 360, step: 1 },
    { name: "elevationDeg", label: "Light elevation", unit: "°", min: 5, max: 90, step: 1 },
    { name: "sheen", label: "Sheen", min: 0, max: 1, step: 0.01 },
  ] as const;
  return <>
    <label className="ve-prop">Depth mode<select className="ve-input" value={config.mode} onChange={event => update({ mode: DepthModeSchema.parse(event.target.value), resolved: undefined, light })}>
      {DepthModeSchema.options.map(mode => <option key={mode}>{mode}</option>)}
    </select></label>
    {config.mode !== "off" && <>
      <label className="ve-prop">Depth intensity<select className="ve-input" value={config.intensity ?? "standard"} onChange={event => update({ intensity: DepthIntensitySchema.parse(event.target.value) })}>
        {DepthIntensitySchema.options.map(intensity => <option key={intensity}>{intensity}</option>)}
      </select></label>
      {sliders.map(spec => <div className="ve-prop" key={spec.name}><span>{spec.label}</span>
        <NumberField value={light[spec.name]} spec={spec} label={spec.label} italic={false}
          onPreview={value => update({ light: { ...light, [spec.name]: value } }, true)}
          onCommit={value => update({ light: { ...light, [spec.name]: value } })} onCancel={() => store.cancel()}/>
      </div>)}
      <PropertyRow track={{ target: { kind: "surface", id }, property: "elevation" }} spec={{ name: "elevation", step: 0.05, min: 0, max: 4, unit: "×" }} />
      {config.resolved && <button className="ve-btn" onClick={() => update({ resolved: undefined })}>Use live depth</button>}
    </>}
  </>;
}
export function Inspector() {
  const { store, snapshot } = useEditor();
  const state = useEditorState(store);
  const subject = state.selection.layers[0];
  const doc = state.draft as Doc;
  let body: React.ReactNode;
  if (!subject) body = <p style={{ padding: 10, color: "var(--ve-dim)" }}>Select a layer, the camera or focus to edit its properties.</p>;
  else if (subject === "camera") body = <>
    <Group title="Camera">{CAMERA_PROPS.map(spec => <PropertyRow key={spec.name} track={{ target: { kind: "camera" }, property: spec.name }} spec={spec}/>)}<LensRow/></Group>
    <Group title="Constraints"><Constraints/></Group>
    <Group title="Easing at playhead"><EasingAtPlayhead/></Group>
  </>;
  else if (subject === "focus") body = <>
    <Group title="Focus">{FOCUS_PROPS.map(spec => <PropertyRow key={spec.name} track={{ target: { kind: "focus" }, property: spec.name }} spec={spec}/>) }<RackControls/></Group>
    <Group title="Constraints"><Constraints/></Group>
    <Group title="Easing at playhead"><EasingAtPlayhead/></Group>
  </>;
  else if (subject === "motion") body = <Group title="Motion"><MotionGroup/></Group>;
  else if (subject === "look") body = <Group title="Look">
    <pre style={{ padding: "4px 10px", whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(doc.definition?.look, null, 2)}</pre>
    <div style={{ padding: "4px 10px" }}><button className="ve-btn" onClick={() => store.commit([{ op: "look.set", look: null }])}>Remove look</button></div>
  </Group>;
  else if (subject.startsWith("clip:")) {
    const id = subject.slice(5);
    const entry = listClips(doc).find(({ clip }) => clip.id === id);
    body = entry && <Group title={entry.clip.label ?? `Clip ${id}`}><ClipInspector clip={entry.clip} root={!entry.parent}/></Group>;
  } else if (subject.startsWith("three:")) {
    const entry = snapshot?.animatables.find(entry => entry.id === subject && entry.kind === "three");
    body = entry && <><Group title={entry.label ?? subject}><AnimatableProperties entries={[entry]} objectLabels/></Group>
      <Group title="Easing at playhead"><EasingAtPlayhead/></Group></>;
  } else {
    const animatables = (snapshot?.animatables ?? []).filter(entry => entry.owner === subject && entry.kind !== "three");
    body = <>
      <Group title="Transform">{TRANSFORM_PROPS.map(spec => <PropertyRow key={spec.name} track={{ target: { kind: "surface", id: subject }, property: spec.name }} spec={spec}/>)}</Group>
      <Group title="Visual and grade" open={false}>{VISUAL_PROPS.map(spec => <PropertyRow key={spec.name} track={{ target: { kind: "surface", id: subject }, property: spec.name }} spec={spec}/>)}</Group>
      <Group title="Depth" open={false}><DepthProperties id={subject}/></Group>
      <Group title="Style vars" open={false}><StyleVars id={subject}/></Group>
      {animatables.length > 0 && <Group title="Props"><AnimatableProperties entries={animatables}/></Group>}
      <Group title="Constraints" open={false}><Constraints surface={subject}/></Group>
      <Group title="Easing at playhead"><EasingAtPlayhead/></Group>
    </>;
  }
  return <div className="ve-panel" data-velora-editor-inspector="">
    <div className="ve-h"><span>Inspector</span><span style={{ textTransform: "none", letterSpacing: 0 }}>{subject?.replace(/^clip:/, "clip ") ?? ""}</span></div>
    {body}
  </div>;
}
