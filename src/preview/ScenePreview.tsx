import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SUPPORTED_EXPORT_FPS, ExportFrameRateSchema, QualityPresetSchema, VideoCodecSchema, CODEC_CONTAINERS, type CameraInput, type PreviewDefinitionInput, type QualityPreset, type VideoCodec } from "../core";
import { Scene, SceneErrorBoundary, useSceneCapture, createSceneInspector, type SceneInspector, type ThreeSelection } from "../react";
import { LookLayer } from "../kit";
import { decodeBase64Url, hasExportFinishing, resolveLook, LookSchema, type LookInput } from "../core";
import { usePreviewSession } from "./session";
import { usePreviewConnection, type PreviewHot } from "./connection";
import { BrandAttribution } from "./BrandAttribution";
import { GettingStarted } from "./GettingStarted";
import { previewTheme } from "./theme";
import { OverlayMenu, StudioOverlays, useOverlays } from "./overlays";
import { useTransportKeys } from "./transport";
import { StageChip } from "./StageChip";
import type { Stage } from "../core/stage";
import type { DepthDisplay } from "../react/depth";

/** SOURCE OF TRUTH: ScenePreview.
 * WHAT: the product's shared browser viewport, playback, source recovery and export entry.
 * WHY: installed projects and the product entry share actual controls, not demo replicas.
 * WHERE: session owns lifecycle; core validates/evaluates; Scene renders original children.
 * Stable portals place the canvas inside the viewport and canonical recovery outside capture.
 * data-velora-preview-chrome marks overlay pixels for the export service to hide in its page.
 * Export opens upward in the scrollable overlay; no viewport space is reserved for controls.
 * Keep children referentially stable during playback. No clone, snapshot or host CSS reset.
 * Guides (overlays) and keyboard transport are preview-only; aside hosts studio panels outside capture.
 */
export type ScenePreviewProps = {
  definition?: PreviewDefinitionInput;
  children?: ReactNode;
  title?: string;
  backHref?: string;
  /** Intercept ordinary back navigation; modified link clicks keep backHref. */
  onBack?: () => void;
  backLabel?: string;
  initialTimeMs?: number;
  revision?: unknown;
  hot?: PreviewHot;
  /** Optional timeline descriptor: rescales the single cursor's span and adds
   * segment-boundary jumps. No second clock; undefined keeps scene behavior. */
  timeline?: { durationMs: number; boundaries: number[] };
  /** Frame grid for arrow-key stepping (default 60). */
  fps?: number;
  /** Export frame size for the copied command (quick shots pass their aspect's frame). */
  exportSize?: { width: number; height: number };
  /** Studio panel rendered beside the viewport, outside capture (chrome-marked by its owner). */
  aside?: ReactNode;
  /** Edit mode layout: panels around a contained viewport. Without it the preview is unchanged. */
  layout?: "editor";
  /** Editor slots (layout="editor"); overlay renders inside the scaled frame, chrome-marked. */
  slots?: { left?: ReactNode; right?: ReactNode; bottom?: ReactNode; toolbar?: ReactNode; overlay?: ReactNode };
  /** Shows an Edit link in the scene header (opens Edit mode). */
  editHref?: string;
  sceneId?: string;
  onStage?: (stage: Stage) => void;
  /** Editor-only director viewpoint (layout="editor"): replaces the camera for display only; the
   * capture viewport is marked data-velora-view="director" and exports refuse it. */
  viewCamera?: CameraInput;
  threeSelection?: ThreeSelection;
  /** Editor-only: force focus peaking on (the focus tool turns it on while active). */
  peaking?: boolean;
  depthDisplay?: DepthDisplay;
};
/** What editor panels read from the one preview: the session (single cursor), the Scene inspector
 * channel and the frame geometry. Provided only in layout="editor". */
export type PreviewHost = {
  session: ReturnType<typeof usePreviewSession>;
  inspector: SceneInspector;
  fps: number;
  frame: { width: number; height: number; scale: number };
};
const PreviewHostContext = createContext<PreviewHost | null>(null);
export function usePreviewHost(): PreviewHost | null { return useContext(PreviewHostContext); }
/** The export URL: Edit mode and its bridge fragment never reach a capture page. */
export function exportUrl(href: string): string {
  const url = new URL(href);
  if (!url.searchParams.has("velora-edit")) return href;
  for (const key of ["velora-edit", "velora-from-composition", "velora-cut-time", "velora-local-time"]) url.searchParams.delete(key);
  url.hash = "";
  return url.href;
}
const timeLabel = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2,"0")}`;
function Glyph({kind}: {kind: "play" | "pause" | "restart" | "export"}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    {kind === "play" ? <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/> :
      kind === "pause" ? <path d="M8 5v14M16 5v14" strokeWidth="4"/> :
      kind === "restart" ? <path d="M5 9a8 8 0 1 1 0 7M5 3v6h6"/> : <path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/>}
  </svg>;
}
function Capture({durationMs, seek, look, stage}: {durationMs: number; seek: (ms: number) => void; look?: LookInput; stage?: Stage}) {
  useSceneCapture({durationMs, seek, look, stage});
  return null;
}
function ExportMenu({disabled, panelHost, size}: {disabled: boolean; panelHost: HTMLDivElement | null; size?: {width: number; height: number}}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  useEffect(() => {
    if (disabled) setOpen(false);
    else if (open) panelHost?.querySelector("select")?.focus();
  }, [disabled, open, panelHost]);
  const details = useRef<HTMLDetailsElement>(null);
  const [fps, setFps] = useState(60);
  const [quality, setQuality] = useState<QualityPreset>("standard");
  const [codec, setCodec] = useState<VideoCodec>("h264");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  // Shell quoting is presentation only; the CLI owns request validation and file effects.
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  // Defaults stay out of the command so the common case reads exactly as before.
  const command = `npx velora export --url ${quote(typeof location === "undefined" ? "http://localhost:5173" : exportUrl(location.href))} --output scene-${fps}${CODEC_CONTAINERS[codec][0]} --fps ${fps}${size ? ` --width ${size.width} --height ${size.height}` : ""}`
    + (quality !== "standard" ? ` --quality ${quality}` : "") + (codec !== "h264" ? ` --codec ${codec}` : "");
  return disabled ? <button className="velora-control" disabled><Glyph kind="export"/>Export</button> :
    <details className="velora-export" ref={details} onToggle={event => setOpen(event.currentTarget.open)}><summary className="velora-control velora-primary" aria-controls={open && panelHost ? panelId : undefined}><Glyph kind="export"/>Export</summary>
      {open && panelHost && createPortal(<div id={panelId} role="region" aria-label="Export your scene" className="velora-export-panel velora-chrome" onKeyDown={event => {
        if (event.key === "Escape" && details.current) {
          details.current.open = false;
          setOpen(false);
          details.current.querySelector("summary")?.focus();
        }
      }}><strong>Export your scene</strong>
        <p>Run this in your project to save an MP4. Use a new filename for each export.</p>
        <label>Frame rate<select aria-label="Export frame rate" value={fps} onChange={event => {setFps(ExportFrameRateSchema.parse(Number(event.target.value)));setCopied(false);}}>
          {SUPPORTED_EXPORT_FPS.map(value => <option key={value} value={value}>{value} fps</option>)}
        </select></label>
        <label>Quality<select aria-label="Export quality" value={quality} onChange={event => {setQuality(QualityPresetSchema.parse(event.target.value));setCopied(false);}}>
          <option value="draft">Draft (fast)</option><option value="standard">Standard</option><option value="master">Master (2x, motion blur)</option>
        </select></label>
        <label>Format<select aria-label="Export format" value={codec} onChange={event => {setCodec(VideoCodecSchema.parse(event.target.value));setCopied(false);}}>
          <option value="h264">MP4 (H.264)</option><option value="hevc">MP4 (HEVC)</option><option value="vp9">WebM (VP9)</option>
          <option value="av1">MP4 (AV1)</option><option value="prores4444">MOV (ProRes 4444)</option><option value="gif">GIF</option>
        </select></label><code>{command}</code>
        <button className="velora-control velora-primary" onClick={async () => {
          try { await navigator.clipboard.writeText(command);setCopied(true);setCopyError(false); }
          catch { setCopyError(true); }
        }}>{copied ? "Copied" : "Copy command"}</button>
        <p role="status">{copyError ? "Select and copy the command above." : "Requires Chromium and FFmpeg on your machine."}</p>
      </div>, panelHost)}
    </details>;
}

export function ScenePreview({definition: input, children, title = "Untitled scene", backHref, onBack, backLabel, initialTimeMs, revision, hot, timeline, fps = 60, exportSize, aside, layout, slots, editHref, sceneId, onStage, viewCamera, threeSelection, peaking, depthDisplay}: ScenePreviewProps) {
  const editor = layout === "editor";
  const [inspector] = useState(() => editor ? createSceneInspector() : undefined);
  const session = usePreviewSession(input, revision, timeline, initialTimeMs);
  const [overlays, setOverlays] = useOverlays();
  const frame = useRef<HTMLDivElement>(null);
  const connection = usePreviewConnection(hot, session.pause);
  const [renderError, setRenderError] = useState("");
  const [size, setSize] = useState({width: 0, height: 0});
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [exportPanel, setExportPanel] = useState<HTMLDivElement | null>(null);
  const resetKey = useMemo(() => ({revision, input, generation: connection.generation}), [revision, input, connection.generation]);
  const failure = useCallback((error: unknown) => {
    session.pause(); setRenderError(error instanceof Error ? error.message : String(error));
  }, [session.pause]);
  useEffect(() => {
    const element = viewport;
    if (!element) return;
    const measure = () => setSize({width: element.clientWidth, height: element.clientHeight});
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element); measure();
    return () => observer?.disconnect();
  }, [viewport]);
  const definition = session.definition;
  const blocked = !session.valid || !connection.connected || !!connection.error || !!renderError;
  const outputScale = definition?.stage ? Math.min(1, 3840 / Math.max(definition.width, definition.height)) : 1;
  const outputSize = exportSize ?? (definition?.stage ? {
    width: Math.max(64, Math.round(definition.width * outputScale / 2) * 2),
    height: Math.max(64, Math.round(definition.height * outputScale / 2) * 2),
  } : undefined);
  const stageChip = sceneId && definition && typeof window !== "undefined" &&
    !(window as Window & { __VELORA_CAPTURING__?: boolean }).__VELORA_CAPTURING__ && !new URLSearchParams(location.search).has("velora-capture")
    ? <StageChip sceneId={sceneId} stage={definition.stage} apply={onStage}/> : null;
  // A scene's own look wins; a composition render passes its default as velora-look (base64url JSON).
  const look = useMemo<LookInput | undefined>(() => {
    if (definition?.look) return definition.look;
    if (typeof location === "undefined") return undefined;
    const packed = new URLSearchParams(location.search).get("velora-look");
    if (!packed) return undefined;
    try { const parsed = LookSchema.safeParse(JSON.parse(decodeBase64Url(packed) ?? "")); return parsed.success ? parsed.data : undefined; } catch { return undefined; }
  }, [definition?.look]);
  const exportOnly = useMemo(() => { try { return hasExportFinishing(resolveLook(look)); } catch { return false; } }, [look]);
  useTransportKeys(session, fps, !blocked);
  const targetDiagnostic = session.issues.length > 0 && session.issues.every(issue => issue.code === "target-missing" || issue.code === "target-ambiguous");
  // The capture bridge checks live target diagnostics after the next seek settles.
  const captureBlocked = blocked && (!targetDiagnostic || !connection.connected || !!connection.error || !!renderError);
  const captureSeek = useCallback((ms: number) => {
    if (captureBlocked) {
      const problem = session.issues[0]?.message;
      throw new Error(problem ? `Correct the scene before exporting. ${problem}` : "Correct the scene before exporting.");
    }
    session.seek(ms);
  }, [captureBlocked, session.seek, session.issues]);
  // The preview covers its viewport; the editor contains the whole frame so every edge stays editable.
  const scale = definition && size.width && size.height ? (editor ? Math.min : Math.max)(size.width / definition.width, size.height / definition.height) : 1;
  const stateText = !connection.connected ? "Reconnecting to your app…" : connection.error ? "Source needs a correction" :
    connection.updating ? "Updating scene…" : renderError || session.issues.length ? "Scene needs a correction" :
    !definition ? "Waiting for a scene" : session.playing ? "Playing" : "Live preview";
  const capture = <SceneErrorBoundary resetKey={resetKey} onError={failure} onReset={() => setRenderError("")}>
    {definition && viewport && createPortal(
      <div className="velora-canvas" data-velora-capture="scene" data-velora-valid={captureBlocked ? "false" : "true"}
        data-velora-view={editor && viewCamera ? "director" : undefined} style={{width: "100%", height: "100%"}}>
        <div ref={frame} style={{position: "absolute", left: "50%", top: "50%", width: definition.width, height: definition.height, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: "center"}}>
          <LookLayer look={look} timeMs={session.timeMs} width={definition.width} height={definition.height}>
            <Scene stage={definition.stage} depth={definition.depth} depthDisplay={editor ? depthDisplay : undefined} camera={definition.scene.camera} focus={definition.scene.focus} constraints={definition.scene.constraints} motion={definition.motion}
              timeMs={session.timeMs} onDiagnostics={session.onDiagnostics} style={{width: definition.width, height: definition.height}} {...(inspector ? {inspector, threeSelection} : {})}
              {...(editor && viewCamera ? {viewCamera} : {})}>
              {children}
            </Scene>
          </LookLayer>
          <StudioOverlays width={definition.width} height={definition.height} state={peaking && !overlays.peaking ? {...overlays, peaking: true} : overlays} root={frame} timeMs={session.timeMs}/>
          {slots?.overlay && <div data-velora-preview-chrome="" data-velora-editor-overlay="" style={{position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none"}}>{slots.overlay}</div>}
        </div>
        <Capture durationMs={session.durationMs} seek={captureSeek} look={look} stage={definition.stage}/>
      </div>, viewport)}
  </SceneErrorBoundary>;
  const host = useMemo<PreviewHost | null>(() => editor && inspector ? {session, inspector, fps, frame: {width: definition?.width ?? 0, height: definition?.height ?? 0, scale}} : null,
    [editor, inspector, session, fps, definition?.width, definition?.height, scale]);
  if (editor) return <main data-velora-preview="" data-velora-layout="editor" data-velora-state={blocked ? "unavailable" : "ready"}>
    <style>{previewTheme}</style>
    <PreviewHostContext.Provider value={host}>
      <div className="velora-editor-grid">
        <header className="velora-editor-top velora-chrome" data-velora-preview-chrome="" role="banner">
          <div className="velora-heading">
            {backHref ? <a className="velora-control" href={backHref} onClick={event => {
              if (onBack && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onBack(); }
            }}>{backLabel ?? (onBack ? "Scenes" : "Back to app")}</a> : onBack && <button className="velora-control" onClick={onBack}>Scenes</button>}
            <h1 className="velora-title">{title}</h1>
          </div>
          <div className="velora-editor-toolbar">{slots?.toolbar}{stageChip}</div>
          <div className="velora-header-tools"><OverlayMenu state={overlays} onChange={setOverlays}/>
            <div className="velora-export-slot velora-editor-export" ref={setExportPanel}/>
            <ExportMenu disabled={blocked || !session.durationMs} panelHost={exportPanel} size={outputSize}/></div>
        </header>
        <nav className="velora-editor-left velora-chrome" data-velora-preview-chrome="" aria-label="Layers">{slots?.left}</nav>
        <section className="velora-editor-center" aria-label="Viewport">
          <div className="velora-viewport" ref={setViewport} aria-label="Scene preview"/>
          {(session.issues.length > 0 || connection.error || !connection.connected || renderError) && <section className="velora-message velora-chrome velora-editor-message" data-velora-preview-chrome="" role="alert">
            <strong>{stateText}</strong>
            {session.issues.length > 0 && <ul>{session.issues.map((issue, index) => <li key={index}>{issue.path}: {issue.message}</li>)}</ul>}
            {connection.error && <p>{connection.error}</p>}
            {renderError && <p>{renderError}</p>}
          </section>}
        </section>
        <aside className="velora-editor-right velora-chrome" data-velora-preview-chrome="" aria-label="Inspector">{slots?.right}</aside>
        <section className="velora-editor-bottom velora-chrome" data-velora-preview-chrome="" aria-label="Timeline">{slots?.bottom}</section>
      </div>
      {capture}
    </PreviewHostContext.Provider>
  </main>;
  return <main data-velora-preview="" data-velora-state={blocked ? "unavailable" : "ready"}>
    <style>{previewTheme}</style>
    <div className="velora-viewport" ref={setViewport} aria-label="Scene preview">
      {!definition && <div className="velora-empty velora-chrome">
        <span className="velora-empty-symbol" aria-hidden="true">↗</span>
        <h1>A new perspective<br/>on your product.</h1>
        <p>Your live scene will appear here. Open Velora inside your app, then ask your coding agent to compose its first scene.</p>
      </div>}
    </div>
    <div className="velora-bottom-blur" data-velora-preview-chrome="" aria-hidden="true"><i/><i/><i/></div>
    <footer className="velora-footer velora-chrome" data-velora-preview-chrome="" aria-label="Scene controls">
      <div className="velora-controls">
        <div className="velora-export-slot" ref={setExportPanel}/>
        {(session.issues.length > 0 || connection.error || !connection.connected) && <section className="velora-message velora-chrome" role="alert">
          <strong>{stateText}</strong>
          {session.issues.length > 0 && <><p>Your last valid scene settings are retained. Correct the source to continue.</p>
            <ul>{session.issues.map((issue,index) => <li key={index}>{issue.path}: {issue.message}</li>)}</ul></>}
          {connection.error && <p>{connection.error}</p>}
          {!connection.connected && <p>Keep your development server running. The preview reconnects automatically.</p>}
        </section>}
        {/* Recovery stays in the controls; only live scene content enters the capture viewport. */}
        <SceneErrorBoundary resetKey={resetKey} onError={failure} onReset={() => setRenderError("")}>
          {definition && viewport && createPortal(
            <div className="velora-canvas" data-velora-capture="scene" data-velora-valid={captureBlocked ? "false" : "true"}
              style={{width: "100%", height: "100%"}}>
              {/* One aspect-preserving cover frame fills preview and capture; overflow is cropped, never stretched. */}
              <div ref={frame} style={{position: "absolute", left: "50%", top: "50%", width: definition.width, height: definition.height, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: "center"}}>
                <LookLayer look={look} timeMs={session.timeMs} width={definition.width} height={definition.height}>
                  <Scene stage={definition.stage} depth={definition.depth} camera={definition.scene.camera} focus={definition.scene.focus} constraints={definition.scene.constraints} motion={definition.motion}
                    timeMs={session.timeMs} onDiagnostics={session.onDiagnostics} style={{width: definition.width, height: definition.height}} {...(inspector ? {inspector, threeSelection} : {})}>
                    {children}
                  </Scene>
                </LookLayer>
                <StudioOverlays width={definition.width} height={definition.height} state={overlays} root={frame} timeMs={session.timeMs}/>
                {editor && slots?.overlay && <div data-velora-preview-chrome="" data-velora-editor-overlay="" style={{position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none"}}>{slots.overlay}</div>}
              </div>
              <Capture durationMs={session.durationMs} seek={captureSeek} look={look} stage={definition.stage}/>
            </div>, viewport)}
        </SceneErrorBoundary>
        <div className="velora-header">
          <div className="velora-heading">
            {backHref ? <a className="velora-control" href={backHref} onClick={event => {
              if (onBack && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                event.preventDefault(); onBack();
              }
            }}>{onBack ? "Back to scenes" : "Back to app"}</a> : onBack && <button className="velora-control" onClick={onBack}>Back to scenes</button>}
            <h1 className="velora-title">{title}</h1>
            {stageChip}
          </div>
          <div className="velora-header-tools">{editHref && <a className="velora-control" href={editHref} data-velora-edit-link="">Edit</a>}<OverlayMenu state={overlays} onChange={setOverlays}/>
            <ExportMenu disabled={blocked || !session.durationMs} panelHost={exportPanel} size={outputSize}/></div>
        </div>
        {!definition && <GettingStarted/>}
        <div className="velora-dock">
          <button className="velora-control velora-primary velora-icon" disabled={blocked || !session.durationMs}
            aria-label={session.playing ? "Pause" : session.timeMs >= session.durationMs && session.durationMs ? "Replay" : "Play"} onClick={session.toggle}>
            <Glyph kind={session.playing ? "pause" : "play"}/>
          </button>
          <button className="velora-control velora-icon" aria-label="Restart" disabled={!definition} onClick={() => session.seek(0)}><Glyph kind="restart"/></button>
          <input className="velora-timeline" aria-label="Scene time" aria-valuetext={timeLabel(session.timeMs)} type="range"
            min={0} max={session.durationMs || 1} step={10} value={session.timeMs} disabled={blocked || !session.durationMs}
            onChange={event => session.seek(Number(event.target.value))}/>
          <output className="velora-time" data-testid="scene-time">{timeLabel(session.timeMs)} / {timeLabel(session.durationMs)}</output>
        </div>
        {exportOnly && <p className="velora-status">Bloom, halation, aberration, sharpen and LUT are export finishing: preview them with <code>velora shot --finish</code>.</p>}
        <div className="velora-preview-meta"><span className="velora-status" role="status"><span className="velora-status-dot"/>{stateText}</span><BrandAttribution/></div>
      </div>
    </footer>
    {aside}
  </main>;
}
