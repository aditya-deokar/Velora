import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScenePreview, usePreviewHost } from "../preview/ScenePreview";
import type { PreviewHot } from "../preview/connection";
import { useSceneInspector, type ThreeSelection } from "../react";
import { behaviorById, describeTrack, type EditOp, type MotionClipInput } from "../core";
import { createEditorStore, DEFAULT_UI, type Doc, type EditorUi, type EditorStore } from "./store";
import { createBridgeClient, takeBridgeFragment, type BridgeHello } from "./bridge";
import { EditorContext, useEditor, useEditorState, type EditorContextValue } from "./context";
import { EDITOR_COMMANDS, commandById, matchShortcut, type EditorController, type EditorPanel } from "./commands";
import { Layers } from "./Layers";
import { Inspector } from "./Inspector";
import { Advisories, useAdvisories } from "./Advisories";
import { History, copyText, opsCommand } from "./History";
import { AskAgent } from "./AskAgent";
import { commandForPlatform } from "./handoff";
import { Palette } from "./Palette";
import { EasingLibrary } from "./EasingLibrary";
import { Timeline } from "./timeline/Timeline";
import { copyKeyframes, parseClipboard, pasteOps, type ClipboardPayload } from "./timeline/clipboard";
import { snapToFrame } from "./model";
import { toAuthored } from "./properties";
import { editorTheme } from "./theme";
import { Overlay } from "./viewport/Overlay";
import { Behaviors } from "./Behaviors";
import { CameraMoves } from "./CameraMoves";
import { Presets } from "./Presets";
import { StaggerTool } from "./StaggerTool";
import { Timing, Ungroup } from "./MotionDesign";
import { findRootClip } from "./group";
import { PromoteDialog } from "./source/PromoteDialog";
import type { SourceHint } from "./source/pick";

/** The studio editor (Edit mode, Phase 04/05): ScenePreview in editor layout with Layers, Inspector and the
 * timeline in its slots, one store, one session cursor, and the edit bridge for saving. Every editor element
 * is chrome-marked; the capture viewport only ever contains the scene. */
export type EditorProps = { sceneId: string; title: string; recipe: unknown; children?: ReactNode; hot?: PreviewHot; backHref?: string; onBack?: () => void; backLabel?: string; initialTimeMs?: number };
type Shared = {
  store: EditorStore; sceneId: string; hello?: BridgeHello; client?: ReturnType<typeof createBridgeClient>; panel?: EditorPanel; setPanel(panel?: EditorPanel): void;
  focused: { current: EditorController["focused"] }; clipboard: { current?: ClipboardPayload };
  sourcePicking: boolean; setSourcePicking(value: boolean): void; sourceHint?: SourceHint; pickSource(hint?: SourceHint): void;
  sourceUndo?: string; setSourceUndo(id?: string): void;
  toast?: { message: string; action?: { label: string; run(): void } }; notify(message: string, action?: { label: string; run(): void }): void;
};
const UI_KEYS: (keyof EditorUi)[] = ["autoKey", "snap", "animatedOnly", "view", "zoom", "solo", "hidden", "tool", "onion", "paths"];
function loadUi(key: string): Partial<EditorUi> {
  try { const value = JSON.parse(localStorage.getItem(key) ?? "{}"); return Object.fromEntries(UI_KEYS.filter(name => name in value).map(name => [name, value[name]])); } catch { return {}; }
}
function saveUi(key: string, ui: EditorUi) {
  try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(UI_KEYS.map(name => [name, ui[name]])))); } catch { /* storage may be unavailable */ }
}
const SharedContext = createContext<Shared | null>(null);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export function Editor({ sceneId, title, recipe, children, hot, backHref, onBack, backLabel, initialTimeMs }: EditorProps) {
  const [address] = useState(takeBridgeFragment);
  const [client] = useState(() => address ? createBridgeClient(address) : undefined);
  const uiKey = `velora-editor:${typeof location === "undefined" ? "" : location.pathname}:${sceneId}`;
  const [store] = useState(() => createEditorStore({ sceneId, base: recipe as Doc, readOnly: !client, ...(client ? { writer: client.writer(sceneId) } : {}),
    ui: { ...DEFAULT_UI, ...loadUi(uiKey) }, persistUi: ui => saveUi(uiKey, ui) }));
  const state = useEditorState(store);
  const [hello, setHello] = useState<BridgeHello>();
  const [panel, setPanel] = useState<EditorPanel>();
  const [sourcePicking, setSourcePicking] = useState(false);
  const [sourceHint, setSourceHint] = useState<SourceHint>();
  const [sourceUndo, setSourceUndo] = useState<string>();
  const pickSource = (hint?: SourceHint) => { setSourcePicking(false); setSourceHint(hint); setPanel("source"); };
  const [toast, setToast] = useState<Shared["toast"]>();
  const focused = useRef<EditorController["focused"]>(undefined);
  const clipboard = useRef<ClipboardPayload | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = (message: string, action?: { label: string; run(): void }) => {
    setToast({ message, ...(action ? { action } : {}) });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), action ? 9000 : 4000);
  };
  useEffect(() => { if (state.notice) notify(state.notice.message); }, [state.notice]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  // Connect: hello, read the file on disk (authoritative), then follow its changes.
  useEffect(() => {
    if (!client) return;
    let active = true;
    const abort = new AbortController();
    const refresh = async () => { const read = await client.readScene(sceneId); if (active) store.external(read.doc, read.sha, read.text); return read; };
    void (async () => {
      let attempt = 0;
      while (active) {
        try {
          const greeting = await client.hello();
          if (!active) return;
          setHello(greeting);
          const read = await refresh();
          store.setReadOnly(greeting.readOnly, read.sha);
          attempt = 0;
          await client.events(event => {
            const data = event.data as { path?: string; sha?: string | null; paths?: string[] } | null;
            if (event.event === "file-changed" && data?.path?.endsWith(`/${sceneId}.scene.json`) && data.sha && data.sha !== store.getState().sha) void refresh().catch(() => undefined);
            if (event.event === "source-changed" && data?.paths?.some(path => path.endsWith(`/${sceneId}.scene.json`))) void refresh().catch(() => undefined);
            if (event.event === "bridge-closing") store.setReadOnly(true);
          }, abort.signal);
        } catch { /* fall through to backoff */ }
        if (!active) return;
        if (!store.getState().readOnly) store.retry();
        await wait(Math.min(30_000, 500 * 2 ** attempt++));
      }
    })();
    return () => { active = false; abort.abort(); };
  }, [client, sceneId, store]);
  // Without a bridge, HMR delivers recipe changes (agent or IDE edits): adopt, rebase or conflict.
  useEffect(() => { if (!client) store.external(recipe as Doc, undefined, JSON.stringify(recipe)); }, [recipe, client, store]);
  const shared: Shared = { store, sceneId, hello, client, panel, setPanel, focused, clipboard, toast, notify, sourcePicking, setSourcePicking, sourceHint, pickSource, sourceUndo, setSourceUndo };
  const definition = (state.draft as Doc).definition;
  const selectedThree = state.selection.layers[0];
  const tool = state.ui.tool;
  const threeSelection = useMemo<ThreeSelection | undefined>(() => {
    if (!selectedThree?.startsWith("three:") || sourcePicking || tool === "camera" || tool === "focus" || tool === "pivot") return;
    return { id: selectedThree, mode: tool === "rotate" ? "rotate" : tool === "scale" ? "scale" : "translate" };
  }, [selectedThree, sourcePicking, tool]);
  return <ScenePreview definition={definition} title={title} backHref={backHref} onBack={onBack} backLabel={backLabel} initialTimeMs={initialTimeMs} hot={hot} revision={state.revision} layout="editor" threeSelection={threeSelection}
    {...(state.ui.director ? { viewCamera: state.ui.director } : {})} peaking={state.ui.tool === "focus"}
    slots={{
      overlay: <WithEditor shared={shared}><Overlay/></WithEditor>,
      toolbar: <WithEditor shared={shared}><Toolbar/><Effects/></WithEditor>,
      left: <WithEditor shared={shared}><Layers/></WithEditor>,
      right: <WithEditor shared={shared}><Inspector/></WithEditor>,
      bottom: <WithEditor shared={shared}><Timeline/></WithEditor>,
    }}>{children}</ScenePreview>;
}
/** Provides the editor context to one slot from the shared state and the preview host. */
function WithEditor({ shared, children }: { shared: Shared; children: ReactNode }) {
  const host = usePreviewHost();
  const snapshot = useSceneInspector(host?.inspector);
  const state = useEditorState(shared.store);
  const value = useMemo<EditorContextValue | null>(() => {
    if (!host) return null;
    const { store } = shared;
    const controller: EditorController = {
      store, state, session: host.session, fps: host.fps, focused: shared.focused.current, ...(snapshot ? { snapshot } : {}),
      open: panel => shared.setPanel(panel), notify: message => shared.notify(message),
      copy() {
        const payload = copyKeyframes(store.committed(), store.getState().selection.keys);
        if (!payload) return;
        shared.clipboard.current = payload;
        void copyText(JSON.stringify(payload));
        shared.notify(`Copied ${payload.tracks.reduce((count, track) => count + track.keyframes.length, 0)} keyframes.`);
      },
      cut() { this.copy(); commandById("keyframes.delete")!.run({ ...this, state: store.getState() }); },
      paste() {
        void (async () => {
          let payload = shared.clipboard.current;
          try { const text = await navigator.clipboard.readText(); payload = parseClipboard(text) ?? payload; } catch { /* clipboard read may be denied */ }
          if (!payload) { shared.notify("Copy keyframes first."); return; }
          const layer = store.getState().selection.layers[0];
          const source = payload.tracks[0]?.target;
          const onto = layer && source?.kind === "surface" && !["camera", "focus", "motion", "look"].includes(layer) && !layer.startsWith("clip:") && source.id !== layer ? { kind: "surface" as const, id: layer } : undefined;
          const atMs = snapToFrame(toAuthored(store.committed(), host.session.timeMs), host.fps);
          const result = pasteOps(payload, atMs, onto);
          if (!result.ok) { shared.notify(result.message); return; }
          const issues = store.commit(result.ops, `Paste ${result.ops.length} keyframes`);
          if (issues.length) shared.notify(issues[0].message);
        })();
      },
      duplicate() { this.copy(); this.paste(); },
      zoom(direction) {
        const ui = store.getState().ui;
        store.setUi(direction === 0 ? { zoom: 1, scroll: 0 } : { zoom: Math.min(400, Math.max(1, ui.zoom * (direction > 0 ? 1.5 : 1 / 1.5))) });
      },
    };
    return { store, host, snapshot, controller, hello: shared.hello, client: shared.client, sceneId: shared.sceneId, sourcePicking: shared.sourcePicking, pickSource: shared.pickSource, setFocused: next => { shared.focused.current = next; }, notify: shared.notify };
  }, [host, snapshot, state, shared]);
  if (!value) return null;
  return <SharedContext.Provider value={shared}><EditorContext.Provider value={value}><style>{editorTheme}</style>{children}</EditorContext.Provider></SharedContext.Provider>;
}
const SAVE_LABELS = { saved: "● Saved", saving: "◌ Saving…", unsaved: "○ Not saved (no bridge)", conflict: "▲ Changed on disk", offline: "✕ Bridge disconnected" } as const;
function Toolbar() {
  const { store, sceneId, controller } = useEditor();
  const shared = useContext(SharedContext)!;
  const state = useEditorState(store);
  const advisories = useAdvisories();
  const [copied, setCopied] = useState<string>();
  const ops: EditOp[] = store.unsavedOps();
  const command = opsCommand(sceneId, ops, state.sha);
  const run = (id: string) => commandById(id)!.run({ ...controller, state: store.getState() });
  return <div className="ve-panel" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} data-velora-editor-toolbar="">
    <button className="ve-btn" aria-pressed={state.ui.snap} onClick={() => run("snap.toggle")} title="Snapping (Shift suspends)">Snap</button>
    <button className="ve-btn" aria-pressed={state.ui.autoKey} onClick={() => run("autokey.toggle")} title="Auto-key: value changes create keyframes">Auto-key</button>
    <button className="ve-btn ve-icon" aria-label="Undo" disabled={!state.undo.length} onClick={() => store.undo()}>↶</button>
    <button className="ve-btn ve-icon" aria-label="Redo" disabled={!state.redo.length} onClick={() => store.redo()}>↷</button>
    <button className="ve-btn" onClick={() => controller.open("history")}>History</button>
    <button className="ve-btn" onClick={() => controller.open("agent")}>Ask agent</button>
    <button className="ve-btn" onClick={() => controller.open("advisories")}><span aria-hidden="true">⚠</span> Advisories ({advisories.length})</button>
    <button className="ve-btn" onClick={() => controller.open("behaviors")}>Behaviors</button>
    <button className="ve-btn" onClick={() => controller.open("camera-moves")}>Camera moves</button>
    <button className="ve-btn" onClick={() => controller.open("presets")}>Presets</button>
    {shared.hello?.capabilities.includes("source") && <>
      <button className="ve-btn" onClick={() => shared.pickSource()}>Source</button>
      <button className="ve-btn" aria-pressed={shared.sourcePicking} onClick={() => { shared.setPanel(undefined); shared.setSourcePicking(!shared.sourcePicking); }}>Pick source element</button>
    </>}
    <button className="ve-btn" onClick={() => controller.open("palette")} title="Ctrl/⌘+K">⌘K</button>
    <span className="ve-save" data-state={state.save} role="status" aria-live="polite" data-testid="editor-save-state">{SAVE_LABELS[state.save]}</span>
    {state.readOnly && <>
      <button className="ve-btn" disabled={!ops.length} onClick={async () => { if (await copyText(commandForPlatform(command))) setCopied("command"); }}>{copied === "command" ? "Copied" : "Copy as command"}</button>
      <button className="ve-btn" disabled={!ops.length} title="PowerShell" onClick={async () => { if (await copyText(command.powershell)) setCopied("powershell"); }}>{copied === "powershell" ? "Copied" : "PowerShell"}</button>
      <button className="ve-btn" disabled={!ops.length} onClick={async () => {
        const prompt = `Apply these Velora edit ops to scene "${sceneId}" with velora edit (dry run first, then --write with --expect-sha). Ops:\n${JSON.stringify(ops, null, 2)}`;
        if (await copyText(prompt)) setCopied("prompt");
      }}>{copied === "prompt" ? "Copied" : "Copy agent prompt"}</button>
      <span style={{ color: "var(--ve-dim)" }} title="Run npx velora edit --scene ID to save from the studio">Read-only: start <code>npx velora edit --scene {sceneId}</code> to save.</span>
    </>}
    {state.save === "conflict" && <span className="ve-banner" data-kind="conflict" role="alert">{state.conflict?.reason} Your edits do not apply cleanly to the new version.
      <button className="ve-btn" onClick={() => store.resolve("mine")}>Keep mine</button><button className="ve-btn" onClick={() => store.resolve("disk")}>Take disk</button></span>}
    {state.save === "offline" && <button className="ve-btn" onClick={() => store.retry()}>Retry save</button>}
  </div>;
}
/** One-per-editor effects: shortcuts, the work-area loop, solo/hide styles, popovers and toasts. */
function Effects() {
  const { store, host, controller } = useEditor();
  const shared = useContext(SharedContext)!;
  const state = useEditorState(store);
  const latest = useRef({ controller });
  latest.current = { controller };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest?.("input,select,textarea,[contenteditable=''],[contenteditable='true']");
      if (typing && event.key !== "Escape") return;
      if (event.key === "Escape") shared.setSourcePicking(false);
      const command = matchShortcut(event, store.getState());
      if (!command) return;
      // The viewport's pointer focus enables this shortcut without intercepting normal tab navigation.
      if (event.key === "Tab" && (event.shiftKey || !target?.closest?.("[data-velora-viewport-overlay],[data-velora-editor-overlay]"))) return;
      event.preventDefault();
      command.run({ ...latest.current.controller, state: store.getState() });
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [store]);
  // Work area: an editor-only loop range on the one session cursor (no new clock).
  const area = state.ui.workArea;
  const session = host.session;
  useEffect(() => {
    if (!area || !session.playing) return;
    if (session.timeMs >= area.endMs - 1e-6) { session.seek(area.startMs); session.toggle(); }
  }, [area, session.playing, session.timeMs, session]);
  const css = [
    ...state.ui.hidden.map(id => `[data-velora-layout=editor] [data-velora-id="${CSS.escape(id)}"]{visibility:hidden!important}`),
    ...(state.ui.solo.length ? [`[data-velora-layout=editor] [data-velora-content]{opacity:.12!important}`, ...state.ui.solo.map(id => `[data-velora-layout=editor] [data-velora-id="${CSS.escape(id)}"] [data-velora-content]{opacity:1!important}`)] : []),
    // Grouped Surfaces suppress pointer events on ordinary JSX. The picker reads through the SVG overlay.
    ...(shared.sourcePicking ? ["[data-velora-layout=editor] [data-velora-scene] *{pointer-events:auto!important}"] : []),
  ].join(" ");
  const close = () => shared.setPanel(undefined);
  const selectedClip = state.selection.clips[0] ? findRootClip(state.draft, state.selection.clips[0]) : undefined;
  const behaviorClip = selectedClip && behaviorById(selectedClip.source?.behavior) ? selectedClip as MotionClipInput : undefined;
  return <>
    {css && <style data-velora-preview-chrome="" data-velora-editor-visibility="">{css}</style>}
    {shared.panel === "palette" && <Palette onClose={close}/>}
    {shared.panel === "history" && <History onClose={close}/>}
    {shared.panel === "agent" && <AskAgent onClose={close} context={{ target: { scene: shared.sceneId }, timeMs: session.timeMs, range: area, sha: state.sha,
      selection: [...new Set([...state.selection.layers.map(id => `layer ${id}`), ...state.selection.clips.map(id => `clip ${id}`),
        ...state.selection.tracks.map(describeTrack), ...state.selection.keys.map(key => `${describeTrack(key.track)} @ ${key.atMs} authored ms`)])],
      history: state.undo.map(entry => entry.label) }}/>}
    {shared.panel === "advisories" && <Advisories onClose={close}/>}
    {shared.panel === "easing" && <EasingLibrary onClose={close}/>}
    {shared.panel === "behaviors" && <Behaviors key={behaviorClip?.id ?? "library"} clip={behaviorClip} onClose={close}/>}
    {shared.panel === "camera-moves" && <CameraMoves onClose={close}/>}
    {shared.panel === "presets" && <Presets onClose={close}/>}
    {shared.panel === "save-easing" && <Presets onClose={close} saveEasing/>}
    {shared.panel === "stagger" && <StaggerTool onClose={close}/>}
    {shared.panel === "timing" && <Timing onClose={close}/>}
    {shared.panel === "ungroup" && <Ungroup onClose={close}/>}
    {shared.panel === "source" && <PromoteDialog onClose={close} hint={shared.sourceHint} undoId={shared.sourceUndo} rememberUndo={shared.setSourceUndo}/>}
    {shared.toast?.message && <div className="ve-toast" role="status" data-velora-preview-chrome="" data-testid="editor-toast">{shared.toast.message}
      {shared.toast.action && <button className="ve-btn" onClick={() => { shared.toast!.action!.run(); shared.notify(""); }}>{shared.toast.action.label}</button>}</div>}
  </>;
}
export { EDITOR_COMMANDS };
