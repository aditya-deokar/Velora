import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { applyEdits, compositionSourceRanges, LOOK_PRESET_NAMES, PACING, planCompositionSnap, reviewComposition, sceneMetadata,
  TRANSITION_CATALOG, type BoundRecipe, type Composition, type CompositionCaptions, type EditOp, type TransitionType } from "../../core";
import { CompositionPlayer, type CompositionPlayerProps, type CompositionPlayerSlots } from "../../preview/CompositionPlayer";
import { createBridgeClient, takeBridgeFragment, type BridgeClient } from "../bridge";
import { AskAgent } from "../AskAgent";
import { commandForPlatform, editBatchCommand, editorHandoff } from "../handoff";
import { createEditorStore, type Doc, type EditorStore } from "../store";
import { Lanes, transitionOp, type PeakResult } from "./Lanes";
import { TRANSITION_DRAG_TYPE } from "./TransitionHandle";
import { byStart, CUT_TOOLS, type CutSelection, type CutTool } from "./tools";
import { compositionTheme } from "./theme";
import { readCutCheckpoint, saveCutCheckpoint, type CutView } from "./session";

type Props = Omit<CompositionPlayerProps, "renderEditor" | "editHref"> & { onOpenScene(recipe: string, localMs: number, globalMs: number): void };
const SAVE = { saved: "● Saved", saving: "◌ Saving…", unsaved: "○ Not saved (read-only)", conflict: "▲ Changed on disk", offline: "✕ Bridge disconnected" };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const switchPage = (event: MouseEvent<HTMLAnchorElement>, onBack?: () => void) => {
  if (onBack && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onBack(); }
};

export function CompositionEditor(props: Props) {
  const { path, document } = props;
  const [client] = useState(() => {
    const address = takeBridgeFragment();
    return address ? createBridgeClient(address) : undefined;
  });
  const [checkpoint] = useState(() => readCutCheckpoint(path));
  const [store] = useState(() => createEditorStore({ sceneId: path, base: (document ?? {}) as Doc, target: "composition", readOnly: true, writer: client?.writer(path, "compositions"), checkpoint: checkpoint?.editor }));
  const view = useRef(checkpoint?.view);
  const [initialTime] = useState(() => {
    const reloading = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload";
    return reloading ? view.current?.cursor ?? props.initialTimeMs : props.initialTimeMs ?? view.current?.cursor;
  });
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [connectionError, setConnectionError] = useState("");
  const [canReadPeaks, setCanReadPeaks] = useState(false);
  useEffect(() => {
    const save = () => saveCutCheckpoint(path, store.checkpoint(), view.current);
    window.addEventListener("pagehide", save);
    return () => { window.removeEventListener("pagehide", save); save(); };
  }, [path, store]);
  useEffect(() => { if (!client) store.external((document ?? {}) as Doc, undefined, JSON.stringify(document ?? {})); }, [client, document, store]);
  useEffect(() => {
    if (!client) return;
    const abort = new AbortController();
    const refresh = async () => {
      const read = await client.readComposition(path);
      if (!abort.signal.aborted) store.external(read.doc, read.sha, read.text);
      return read;
    };
    void (async () => {
      let attempt = 0;
      while (!abort.signal.aborted) {
        try {
          const greeting = await client.hello();
          if (!greeting.capabilities.includes("compositions")) throw new Error("Restart the edit bridge with a version that supports compositions.");
          const read = await refresh();
          if (abort.signal.aborted) return;
          store.setReadOnly(greeting.readOnly, read.sha);
          setCanReadPeaks(greeting.capabilities.includes("media-peaks"));
          setConnectionError("");
          attempt = 0;
          await client.events(event => {
            const data = event.data as { path?: string; sha?: string | null } | null;
            if (event.event === "file-changed" && data?.path === path && data.sha !== store.getState().sha)
              void refresh().catch(error => { if (!abort.signal.aborted) setConnectionError((error as Error).message); });
          }, abort.signal);
          if (!abort.signal.aborted) setConnectionError("The bridge disconnected. Pending edits will retry when it reconnects.");
        } catch (error) {
          if (!abort.signal.aborted) setConnectionError((error as Error).message);
        }
        if (!abort.signal.aborted) await wait(Math.min(30_000, 500 * 2 ** attempt++));
      }
    })();
    return () => abort.abort();
  }, [client, path, store]);
  if (!document && !state.sha) return <main data-velora-preview-chrome="" style={{ padding: 24 }}>
    <h1>{path}</h1><p role="status">{connectionError || (client ? "Reading the composition…" : "Open this composition through the edit bridge.")}</p>
    {props.backHref && <a href={props.backHref} onClick={event => switchPage(event, props.onBack)}>Back to compositions</a>}
  </main>;
  return <CompositionPlayer {...props} initialTimeMs={initialTime} document={state.draft} renderEditor={slots => <Workspace {...slots} path={path} scenes={props.scenes}
    backHref={props.backHref} onBack={props.onBack} openScene={props.onOpenScene} connectionError={connectionError} client={canReadPeaks ? client : undefined} store={store}
    initialView={checkpoint?.view} rememberView={next => { view.current = next; }}/>}/>;
}

function usePeaks(client: BridgeClient | undefined, path: string, composition?: Composition) {
  const [peaks, setPeaks] = useState<Record<string, PeakResult>>({});
  const assetKey = JSON.stringify(composition?.assets.filter(asset => asset.type === "audio" && composition.audio.some(track => track.assetId === asset.id)).map(asset => [asset.id, asset.path]) ?? []);
  useEffect(() => {
    setPeaks({});
    if (!client) return;
    const abort = new AbortController();
    const assets = JSON.parse(assetKey) as [string, string][];
    for (const [id] of assets) void client.mediaPeaks(path, id, abort.signal).then(media => {
      if (!abort.signal.aborted) setPeaks(previous => ({ ...previous, [id]: { media } }));
    }, error => {
      if (!abort.signal.aborted) setPeaks(previous => ({ ...previous, [id]: { error: (error as Error).message } }));
    });
    return () => abort.abort();
  }, [client, path, assetKey]);
  return peaks;
}

function Workspace({ composition, cues, session, transport, viewport, issues, path, scenes, store, client, connectionError, backHref, onBack, openScene, initialView, rememberView }: CompositionPlayerSlots & {
  path: string; scenes: readonly BoundRecipe[]; store: EditorStore; client?: BridgeClient; connectionError: string; backHref?: string; onBack?(): void; openScene: Props["onOpenScene"];
  initialView?: CutView; rememberView(view: CutView): void;
}) {
  const state = store.getState();
  const [tool, setTool] = useState<CutTool>(initialView?.tool ?? "select");
  const [selected, select] = useState<CutSelection | undefined>(initialView?.selected);
  rememberView({ cursor: session.timeMs, tool, selected });
  const [platform, setPlatform] = useState("default");
  const [beatPlan, showBeatPlan] = useState<{ source: Composition; plan: ReturnType<typeof planCompositionSnap> }>();
  const [palette, showPalette] = useState(false);
  const [askAgent, showAgent] = useState(false);
  const [cutMenu, showCutMenu] = useState(false);
  const [feedback, setFeedback] = useState("");
  const peaks = usePeaks(client, path, composition);
  const warnings = useMemo(() => composition ? compositionSourceRanges(composition, { scenes }) : [], [composition, scenes]);
  const advisories = useMemo(() => composition ? reviewComposition(composition, scenes, { platform }).advisories : [], [composition, scenes, platform]);
  const commit = (ops: EditOp[], label?: string) => { setFeedback(""); store.commit(ops, label); };
  const zoom = (direction: number) => store.setUi({ zoom: direction === 0 ? 1 : Math.max(1, Math.min(12, state.ui.zoom * (direction > 0 ? 1.5 : 1 / 1.5))) });
  const mark = () => {
    if (!composition) return;
    commit([{ op: "marker.add", atMs: session.timeMs }]);
    select({ lane: "marker", index: composition.markers.length });
  };
  const remove = () => {
    if (!selected) return;
    const op: EditOp = selected.lane === "captions" ? { op: "captions.set", captions: null }
      : selected.lane === "marker" ? { op: "marker.remove", index: selected.index, fromMs: composition?.markers[selected.index]?.atMs }
      : selected.lane === "segment" ? { op: "segment.remove", id: selected.id, ripple: tool === "ripple" }
      : selected.lane === "overlay" ? { op: "overlay.remove", id: selected.id } : { op: "audio.remove", id: selected.id };
    if (!store.commit([op]).length) select(undefined);
  };
  const snapAll = () => { if (composition) showBeatPlan({ source: composition, plan: planCompositionSnap(composition) }); };
  const keyboard = useRef<(event: KeyboardEvent) => void>(() => {});
  keyboard.current = event => {
    if (event.defaultPrevented) return;
    const key = event.key.toLowerCase(), chord = event.ctrlKey || event.metaKey;
    if (key === "escape") { showPalette(false); showBeatPlan(undefined); store.cancel(); select(undefined); return; }
    if (chord && key === "k") { event.preventDefault(); showPalette(open => !open); return; }
    if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
    if (chord && (key === "z" || key === "y")) {
      event.preventDefault(); if (event.shiftKey || key === "y") store.redo(); else store.undo(); return;
    }
    if (chord || event.altKey || !composition) return;
    const next = CUT_TOOLS.find(([, shortcut]) => shortcut.toLowerCase() === key);
    if (next) setTool(next[0]);
    else if (key === "m") mark();
    else if (key === "-" || key === "=" || key === "\\") zoom(key === "-" ? -1 : key === "=" ? 1 : 0);
    else if (key === "delete" || key === "backspace") { event.preventDefault(); remove(); }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => keyboard.current(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const beatPlanCurrent = beatPlan?.source === composition;
  const beatCheck = beatPlan && beatPlanCurrent && applyEdits(state.draft, beatPlan.plan.ops, { target: "composition" });
  const ops = store.unsavedOps();
  const file = `'${path.replaceAll("'", "'\\''")}'`;
  const selectedClip = selected?.lane === "segment" ? composition?.scenes.find(clip => clip.id === selected.id)
    : selected?.lane === "overlay" ? composition?.overlays.find(clip => clip.id === selected.id)
    : selected?.lane === "audio" ? composition?.audio.find(clip => clip.id === selected.id) : undefined;
  const handoff = { target: { composition: path }, timeMs: session.timeMs, sha: state.sha,
    selection: selected && "id" in selected ? [`${selected.lane} ${selected.id}`]
      : selected?.lane === "marker" ? [`marker ${selected.index}`] : selected ? [selected.lane] : [],
    range: selectedClip && { startMs: selectedClip.startMs, endMs: selectedClip.durationMs === undefined ? session.durationMs : selectedClip.startMs + selectedClip.durationMs },
    history: state.undo.map(entry => entry.label) };
  const clipboard = async (prompt = false) => {
    try {
      await navigator.clipboard.writeText(prompt ? editorHandoff({ ...handoff, intent: `Review and apply these pending operations.\n${JSON.stringify(ops, null, 2)}` })
        : commandForPlatform(editBatchCommand(handoff.target, ops, state.sha)));
      setFeedback("Copied");
    } catch { setFeedback("Clipboard unavailable."); }
  };
  return <div className="vc-editor" data-velora-composition-editor="">
    <style>{compositionTheme}</style>
    <header className="vc-header vc-chrome" data-velora-preview-chrome="" role="banner">
      {backHref && <a href={backHref} onClick={event => switchPage(event, onBack)}>Compositions</a>}
      <h1>{composition?.title ?? path}</h1>
      <div className="vc-tools" role="group" aria-label="Composition tools">
        {CUT_TOOLS.map(([id, key, title]) => <button key={id} aria-pressed={tool === id} title={`${title} (${key})`} onClick={() => setTool(id)}>{title} <kbd>{key}</kbd></button>)}
        <button title="Add marker (M)" onClick={mark}>Marker <kbd>M</kbd></button>
      </div>
      <button aria-label="Undo" disabled={!state.undo.length} onClick={store.undo}>↶</button><button aria-label="Redo" disabled={!state.redo.length} onClick={store.redo}>↷</button>
      <button title="Commands (Ctrl/⌘+K)" onClick={() => showPalette(open => !open)}>Commands</button>
      <button onClick={() => showAgent(true)}>Ask agent</button>
      <span className="vc-save" data-testid="composition-save-state" role="status">{SAVE[state.save]}</span>
    </header>
    <section className="vc-view" aria-label="Viewport">{viewport}</section>
    <aside className="vc-inspector vc-chrome" aria-label="Composition inspector" data-velora-preview-chrome="">
      {composition && <Inspector composition={composition} scenes={scenes} selected={selected} cursor={session.timeMs} commit={commit} remove={remove}/>}
      <details><summary>Export</summary><code>velora render --composition {file} --out {composition?.id ?? "composition"}.mp4</code></details>
      {state.readOnly && <section className="vc-feedback">
        <p>To save to disk, run <code>velora edit --composition {file}</code>.</p>
        <button disabled={!ops.length} onClick={() => void clipboard()}>Copy as command</button> <button disabled={!ops.length} onClick={() => void clipboard(true)}>Copy agent prompt</button>
      </section>}
      {connectionError && <p role="status">{connectionError}</p>}
      {state.conflict && <div role="alert"><p>{state.conflict.reason}</p><button onClick={() => store.resolve("mine")}>Keep mine</button> <button onClick={() => store.resolve("disk")}>Take disk</button></div>}
      {state.save === "offline" && <button onClick={store.retry}>Retry save</button>}
      {([...issues, ...state.issues.map(issue => `${issue.code} · ${issue.message}`), feedback]).filter(Boolean).map((message, index) => <p key={index} className="vc-feedback" role="status">{message}</p>)}
      {warnings.map(warning => <p className="vc-feedback" role="status" key={warning.path}>{warning.message}</p>)}
    </aside>
    <section className="vc-timeline vc-chrome" aria-label="Timeline" data-velora-preview-chrome="">
      <div className="vc-timeline-bar">
        {transport}
        <button aria-pressed={state.ui.snap} title="Hold Shift during a drag to suspend snapping" onClick={() => store.setUi({ snap: !state.ui.snap })}>Snap</button>
        <button aria-label="Zoom out" onClick={() => zoom(-1)}>−</button><button aria-label="Zoom to fit" onClick={() => zoom(0)}>Fit</button><button aria-label="Zoom in" onClick={() => zoom(1)}>+</button>
        <button onClick={snapAll}>Snap all cuts to beats</button>
        <select aria-label="Editorial review platform" value={platform} onChange={event => setPlatform(event.currentTarget.value)}>{Object.keys(PACING).map(key => <option key={key} value={key}>{key === "default" ? "General pacing" : key}</option>)}</select>
      </div>
      {composition && <Lanes composition={composition} scenes={scenes} durationMs={session.durationMs} cursor={session.timeMs} cues={cues} peaks={peaks}
        advisories={advisories} warnings={warnings} tool={tool} selected={selected} snap={state.ui.snap} zoom={state.ui.zoom} select={select} seek={session.seek}
        preview={store.preview} commit={commit} cancel={store.cancel} openScene={openScene} openMenu={() => showCutMenu(true)}/>}
    </section>
    {beatPlan && <Popup label="Snap cuts preview" close={() => showBeatPlan(undefined)}>
      {!beatPlan.plan.beatCount ? <p>Add beat markers with <code>velora audio beats --composition {file} --write-markers</code>.</p> : <>
        {beatPlan.plan.changes.length ? <ul>{beatPlan.plan.changes.filter(change => change.field === "startMs").map(change => <li key={change.id}>{change.id} · {Math.round(change.from)} → {Math.round(change.to)} ms ({change.to >= change.from ? "+" : ""}{Number((change.to - change.from).toFixed(2))} ms)</li>)}</ul> : <p>No cuts would move.</p>}
        {!!beatPlan.plan.unsnapped.length && <p>No nearby beat for {beatPlan.plan.unsnapped.join(", ")}.</p>}
        {!beatPlanCurrent && <p>The cut changed. Open a new preview.</p>}
        {beatCheck && !beatCheck.ok && <p role="alert">{beatCheck.issues[0]?.message}</p>}
        <button disabled={!beatPlan.plan.ops.length || !beatCheck || !beatCheck.ok} onClick={() => { commit(beatPlan.plan.ops, "Snap cuts to beats"); showBeatPlan(undefined); }}>Apply beat snap</button>
      </>}
    </Popup>}
    {palette && <Popup label="Composition commands" close={() => showPalette(false)}>
      <div className="vc-tools">{CUT_TOOLS.map(([id, key, title]) => <button key={id} onClick={() => { setTool(id); showPalette(false); }}>{title} <kbd>{key}</kbd></button>)}</div>
      <button onClick={() => { mark(); showPalette(false); }}>Add marker</button> <button onClick={() => { snapAll(); showPalette(false); }}>Snap all cuts to beats</button>
      <button onClick={() => { store.undo(); showPalette(false); }}>Undo</button> <button onClick={() => { store.redo(); showPalette(false); }}>Redo</button>
      <button onClick={() => { remove(); showPalette(false); }}>Delete selected item</button> <button onClick={() => { zoom(0); showPalette(false); }}>Fit timeline</button>
      <button onClick={() => { showPalette(false); showAgent(true); }}>Ask agent</button>
      <p>Space play · J/K/L shuttle · ←/→ frame · [ ] cut</p>
    </Popup>}
    {cutMenu && <Popup label="Clip actions" close={() => showCutMenu(false)}>
      <button onClick={() => { showCutMenu(false); showAgent(true); }}>Ask agent</button>
      <button onClick={() => { remove(); showCutMenu(false); }}>Delete selected item</button>
    </Popup>}
    {askAgent && <AskAgent context={handoff} onClose={() => showAgent(false)}/>}
  </div>;
}

function Popup({ label, close, children }: { label: string; close(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="vc-popup vc-chrome" ref={ref} aria-label={label} data-velora-preview-chrome="" onCancel={event => { event.preventDefault(); close(); }}>
    <h2>{label}</h2>{children}<button onClick={close}>Close</button>
  </dialog>;
}

function NumberField({ label, value, change, min, max }: { label: string; value: number; change(value: number): void; min?: number; max?: number }) {
  return <label>{label}<input key={value} aria-label={label} type="number" step="any" min={min} max={max} defaultValue={Number(value.toFixed(3))} onBlur={event => {
    const next = event.currentTarget.valueAsNumber;
    if (Number.isFinite(next) && next !== Number(value.toFixed(3))) change(next);
    else event.currentTarget.value = String(Number(value.toFixed(3)));
  }} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); event.currentTarget.value = String(Number(value.toFixed(3))); event.currentTarget.blur(); }
    if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
  }}/></label>;
}

function Inspector({ composition, scenes, selected, cursor, commit, remove }: { composition: Composition; scenes: readonly BoundRecipe[]; selected?: CutSelection;
  cursor: number; commit(ops: EditOp[], label?: string): void; remove(): void }) {
  const ordered = byStart(composition.scenes);
  const shot = selected?.lane === "segment" ? ordered.find(clip => clip.id === selected.id) : undefined;
  const overlay = selected?.lane === "overlay" ? composition.overlays.find(clip => clip.id === selected.id) : undefined;
  const audio = selected?.lane === "audio" ? composition.audio.find(track => track.id === selected.id) : undefined;
  const markerIndex = selected?.lane === "marker" ? selected.index : -1;
  const marker = composition.markers[markerIndex];
  const previous = shot && ordered[ordered.indexOf(shot) - 1], next = shot && ordered[ordered.indexOf(shot) + 1];
  const chooseTransition = (type: TransitionType) => {
    if (shot && (previous || TRANSITION_CATALOG.find(item => item.type === type)?.mode === "entering")) commit([transitionOp(composition, shot.id, type)]);
  };
  const addVisual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget), recipe = String(data.get("recipe"));
    const source = scenes.find(scene => scene.id === recipe);
    if (!source) return;
    const durationMs = Number(data.get("duration")) || sceneMetadata(source).durationMs || 1000;
    commit([{ op: data.get("lane") === "picture" ? "segment.add" : "overlay.add", recipe, atMs: cursor, durationMs }]);
  };
  return <>
    <section className="vc-item"><h2>{shot?.id ?? overlay?.id ?? audio?.id ?? (marker ? marker.label || marker.kind : selected?.lane === "captions" ? "Captions" : "Composition")}</h2>
      {shot && <>
        <NumberField key={`shot-start-${shot.id}`} label="Start (ms)" min={0} value={shot.startMs} change={atMs => commit([{ op: "segment.move", id: shot.id, atMs }])}/>
        <NumberField key={`shot-duration-${shot.id}`} label="Duration (ms)" min={1} value={shot.durationMs} change={value => commit([{ op: "segment.trim", id: shot.id, edge: "out", mode: "ripple", deltaMs: value - shot.durationMs }])}/>
        <NumberField key={`shot-offset-${shot.id}`} label="Source in (ms)" min={0} value={shot.inMs ?? 0} change={value => commit([{ op: "segment.slip", id: shot.id, deltaMs: value - (shot.inMs ?? 0) }])}/>
        <div className="vc-tools">
          <button disabled={!previous} onClick={() => previous && commit([{ op: "segment.reorder", id: shot.id, beforeId: previous.id }])}>Move earlier</button>
          <button disabled={!next} onClick={() => commit([{ op: "segment.reorder", id: shot.id, beforeId: ordered[ordered.indexOf(shot) + 2]?.id ?? null }])}>Move later</button>
          <button onClick={() => commit([{ op: "segment.split", id: shot.id, atMs: cursor }])}>Split at cursor</button>
        </div>
        {previous && <NumberField key={`roll-${shot.startMs}`} label="Roll cut to (ms)" value={shot.startMs} change={value => commit([{ op: "segment.roll", leftId: previous.id, rightId: shot.id, deltaMs: value - shot.startMs }])}/>}
        {shot.transition && <>
          <NumberField label="Transition duration (ms)" value={shot.transition.durationMs} min={1} change={durationMs => commit([{ ...shot.transition!, op: "transition.set", segmentId: shot.id, durationMs }])}/>
          <label>Direction<select aria-label="Transition direction" value={shot.transition.direction ?? "right"} onChange={event => commit([{ ...shot.transition!, op: "transition.set", segmentId: shot.id, direction: event.currentTarget.value as "left" | "right" | "up" | "down" }])}>
            {["left", "right", "up", "down"].map(direction => <option key={direction}>{direction}</option>)}
          </select></label>
          <button onClick={() => commit([{ op: "transition.remove", segmentId: shot.id }])}>Remove transition</button>
        </>}
      </>}
      {overlay && <>
        <NumberField key={`overlay-start-${overlay.id}`} label="Overlay start (ms)" min={0} value={overlay.startMs} change={atMs => commit([{ op: "overlay.move", id: overlay.id, atMs }])}/>
        <NumberField key={`overlay-duration-${overlay.id}`} label="Overlay duration (ms)" min={1} value={overlay.durationMs} change={value => commit([{ op: "overlay.trim", id: overlay.id, edge: "out", deltaMs: value - overlay.durationMs }])}/>
        <NumberField key={`opacity-${overlay.id}`} label="Opacity" min={0} max={1} value={overlay.opacity} change={opacity => commit([{ op: "overlay.set", id: overlay.id, opacity }])}/>
        <label>Blend<select value={overlay.blend} onChange={event => commit([{ op: "overlay.set", id: overlay.id, blend: event.currentTarget.value as "normal" | "multiply" | "screen" }])}>
          {["normal", "multiply", "screen"].map(blend => <option key={blend}>{blend}</option>)}
        </select></label>
      </>}
      {audio && <>
        <NumberField key={`audio-start-${audio.id}`} label="Audio start (ms)" min={0} value={audio.startMs} change={atMs => commit([{ op: "audio.move", id: audio.id, atMs }])}/>
        {([["gain", "Gain", 2], ["offsetMs", "Audio source in (ms)", 120000], ["fadeInMs", "Fade in (ms)", 30000], ["fadeOutMs", "Fade out (ms)", 30000]] as const).map(([field, label, max]) =>
          <NumberField key={`${audio.id}-${field}`} label={label} min={0} max={max} value={audio[field]} change={value => commit([{ op: "audio.set", id: audio.id, [field]: value }])}/>)}
      </>}
      {marker && <NumberField key={`marker-${markerIndex}`} label="Marker time (ms)" min={0} value={marker.atMs} change={atMs => commit([{ op: "marker.move", index: markerIndex, fromMs: marker.atMs, atMs }])}/>}
      {selected && <button onClick={remove}>Delete selected item</button>}
    </section>
    <details open><summary>Transitions</summary>
      <div className="vc-catalog">{TRANSITION_CATALOG.map(item => <button key={item.type} title={item.description} draggable
        onDragStart={event => { event.dataTransfer.setData(TRANSITION_DRAG_TYPE, item.type); event.dataTransfer.effectAllowed = "copy"; }}
        onClick={() => chooseTransition(item.type)} aria-disabled={!shot || (item.mode === "overlap" && !previous)}>{item.type}</button>)}</div>
    </details>
    <details><summary>Add media at cursor</summary>
      <form onSubmit={addVisual}><label>Recipe<select name="recipe" required>{scenes.map(scene => <option value={scene.id} key={scene.id}>{scene.title}</option>)}</select></label>
        <label>Lane<select name="lane"><option value="picture">V1</option><option value="overlay">Overlay</option></select></label>
        <label>Duration (ms)<input type="number" name="duration" min={1} placeholder="Recipe duration"/></label><button>Add visual</button>
      </form>
      <form onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget), assetId = String(data.get("asset"));
        let id = assetId, suffix = 2;
        while (composition.audio.some(track => track.id === id)) id = `${assetId}-${suffix++}`;
        commit([{ op: "audio.add", id, assetId, kind: data.get("kind") as "music" | "voice" | "sfx", startMs: cursor }]);
      }}><label>Audio asset<select name="asset" required><option value="">Choose declared audio</option>{composition.assets.filter(asset => asset.type === "audio").map(asset => <option key={asset.id}>{asset.id}</option>)}</select></label>
        <label>Role<select name="kind"><option value="music">Music</option><option value="voice">Voice</option><option value="sfx">SFX</option></select></label><button>Add audio</button>
      </form>
      <form onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        commit([{ op: "marker.add", atMs: cursor, label: String(data.get("label")), kind: data.get("kind") as "cue" | "section" | "beat" | "downbeat" }]);
      }}><label>Marker label<input maxLength={80} name="label"/></label><label>Kind<select name="kind">{["cue", "section", "beat", "downbeat"].map(kind => <option key={kind}>{kind}</option>)}</select></label><button>Add marker</button></form>
    </details>
    <details open={selected?.lane === "captions" || undefined}><summary>Captions and look</summary>
      <form key={JSON.stringify(composition.captions)} onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget), style = String(data.get("style"));
        commit([{ op: "captions.set", captions: { file: String(data.get("file")), wordsFile: String(data.get("words") || "") || undefined,
          style: (style || undefined) as CompositionCaptions["style"],
          burnIn: data.get("burn") === "on" } }]);
      }}><label>Caption file<input name="file" required defaultValue={composition.captions?.file} placeholder="subtitles.srt"/></label>
        <label>Style<select name="style" defaultValue={composition.captions?.style ?? ""}>{["", "burn", "minimal", "karaoke", "bold-pop", "lower"].map(style => <option key={style} value={style}>{style || "Default"}</option>)}</select></label>
        <label>Word timings<input name="words" defaultValue={composition.captions?.wordsFile}/></label>
        <label>Burn in<input name="burn" type="checkbox" defaultChecked={composition.captions?.burnIn}/></label><button>Set captions</button>
      </form>
      <label>Default look<select aria-label="Default look" value={composition.look?.preset ?? (composition.look ? "custom" : "")} onChange={event => {
        const preset = event.currentTarget.value;
        commit([{ op: "look.set", look: preset ? { preset } : null }]);
      }}><option value="">None</option>{composition.look && !composition.look.preset && <option value="custom" disabled>Custom</option>}
        {LOOK_PRESET_NAMES.map(preset => <option key={preset}>{preset}</option>)}</select></label>
    </details>
  </>;
}
