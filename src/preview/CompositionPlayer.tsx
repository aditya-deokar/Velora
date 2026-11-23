import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { audioPlacement, CompositionSchema, layersAt, localTime, motionDuration, rigLayersFromAnchors, timelineFromComposition, velocityBlurAt, type Composition, type BoundRecipe, type CaptionCue, type LookInput, type PreviewDefinitionInput } from "../core";
import { createSceneInspector, Scene, SceneErrorBoundary, useSceneInspector } from "../react";
import { BrandProvider, LookLayer, type CaptionCueInput, type CaptionStyle } from "../kit";
import { usePreviewSession } from "./session";
import { useTransportKeys } from "./transport";
import { OverlayMenu, StudioOverlays, useOverlays } from "./overlays";
import { activeCue, audioStateAt, blendStyle, playerFrame, syncMedia } from "./player";
import { previewTheme } from "./theme";
import { CaptionPicture, useCaptionCues } from "./CaptionsScene";
import { useProjectBrand } from "./TemplateLayout";
import { projectFileUrl } from "./projectFiles";

/** SOURCE OF TRUTH: CompositionPlayer.
 * WHAT: watch a whole composition like an editor reviews a cut: the active segment's bound scene at
 * its local time, the next segment preloaded, gaps as black void, audio and captions, a segment
 * strip and keyboard transport.
 * WHY: one cursor (usePreviewSession timeline mode) drives picture, audio and captions, so the review
 * matches `velora render`; audio elements follow the cursor with drift correction, never lead it.
 * WHERE: SceneLibrary's Compositions tab. No capture bridge: export stays `velora render`.
 * Editor chrome is optional. Both modes use the same A/B layers and presentation cursor.
 */
export type CompositionPlayerProps = {
  path: string; document: unknown; scenes: readonly BoundRecipe[]; bindings: Record<string, ComponentType>;
  assetUrls?: Record<string, string>; onBack?: () => void; backHref?: string;
  editHref?: string; initialTimeMs?: number;
  renderEditor?: (slots: CompositionPlayerSlots) => ReactNode;
};
export type CompositionPlayerSlots = { viewport: ReactNode; transport: ReactNode; session: ReturnType<typeof usePreviewSession>; composition?: Composition; cues: readonly CaptionCue[]; issues: string[] };
const timeLabel = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1000 / 100))}`;
const assetUrl = (urls: Record<string, string> | undefined, file: string) => urls?.["/" + file.replace(/^\.?\//, "")] ?? urls?.[file];
function StyledCaptions({ cues, style, timeMs, width, height }: { cues: CaptionCueInput[]; style: CaptionStyle; timeMs: number; width: number; height: number }) {
  const brand = useProjectBrand();
  return <div data-overlay="captions" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
    <BrandProvider brand={brand}><Scene timeMs={timeMs} style={{ width, height }}>
      <CaptionPicture cues={cues} style={style} width={width} height={height}/>
    </Scene></BrandProvider>
  </div>;
}
function CompositionScene({ definition, Component, timeMs, width, height, look }: {
  definition: BoundRecipe["definition"]; Component: ComponentType; timeMs: number; width: number; height: number; look?: LookInput;
}) {
  const [inspector] = useState(createSceneInspector);
  const activeInspector = look?.velocityBlur ? inspector : undefined;
  const snapshot = useSceneInspector(activeInspector);
  const velocity = look?.velocityBlur ? velocityBlurAt({ ...definition, width, height, look }, timeMs, { layers: rigLayersFromAnchors(snapshot?.targets ?? []) }) : undefined;
  const scene = <SceneErrorBoundary><Scene stage={definition.stage} depth={definition.depth} camera={definition.scene.camera} focus={definition.scene.focus}
    constraints={definition.scene.constraints} motion={definition.motion} timeMs={timeMs} inspector={activeInspector} style={{ width, height }}><Component/></Scene></SceneErrorBoundary>;
  return look ? <LookLayer look={look} velocity={velocity} timeMs={timeMs} width={width} height={height}>{scene}</LookLayer> : scene;
}
export function CompositionPlayer({ path, document, scenes, bindings, assetUrls, onBack, backHref, editHref, initialTimeMs, renderEditor }: CompositionPlayerProps) {
  const editing = !!renderEditor;
  const parsed = useMemo(() => CompositionSchema.safeParse(document), [document]);
  const composition = parsed.success ? parsed.data : undefined;
  const timeline = useMemo(() => composition ? timelineFromComposition(composition) : undefined, [composition]);
  const missing = composition ? composition.scenes.filter(scene => !scenes.some(entry => entry.id === scene.recipe)).map(scene => scene.recipe) : [];
  // The cursor's carrier: a valid, motionless frame of the composition's size; the timeline sets the span.
  const carrier = useMemo<PreviewDefinitionInput | undefined>(() => composition && { width: composition.width, height: composition.height,
    scene: { nodes: [{ id: "velora-composition" }] }, motion: { durationMs: Math.max(1, timeline!.durationMs), speed: 1, tracks: [] } }, [composition, timeline]);
  const descriptor = useMemo(() => timeline && { durationMs: timeline.durationMs, boundaries: [...new Set(timeline.segments.flatMap(segment => [segment.startMs, segment.startMs + segment.durationMs]))] }, [timeline]);
  const session = usePreviewSession(carrier, path, descriptor, initialTimeMs);
  useTransportKeys(session, composition?.fps ?? 30, !!composition && missing.length === 0);
  const [overlays, setOverlays] = useOverlays();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element); measure();
    return () => observer?.disconnect();
  }, []);
  // Captions: core parser; the active cue is drawn in a chrome-marked layer.
  const captionsFile = composition?.captions?.file;
  const { cues: loadedCues, error: captionError } = useCaptionCues(editing || (captionsFile && assetUrl(assetUrls, captionsFile)) ? captionsFile : undefined,
    editing ? composition?.captions?.wordsFile : undefined, assetUrls);
  const cues = loadedCues ?? [];
  // Audio follows the cursor: one element per track, resynced past the drift budget.
  const media = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    if (!composition) return;
    for (const track of composition.audio) {
      const element = media.current.get(track.id);
      if (!element) continue;
      const placement = editing || track.durationMs !== undefined ? { ...track, startMs: audioPlacement(track, composition.fps).startMs } : track;
      syncMedia(element, audioStateAt(placement, session.timeMs, timeline!.durationMs), session.playing, session.rate);
    }
  }, [composition, editing, timeline, session.timeMs, session.playing, session.rate]);
  useEffect(() => () => { for (const element of media.current.values()) element.pause(); }, []);
  const issues = !parsed.success ? parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) :
    missing.map(id => `Scene recipe "${id}" was not found in src/velora/scenes.`);
  if (editing && captionError) issues.push(captionError);
  const frame = timeline ? playerFrame(timeline, session.timeMs) : { localMs: 0 };
  // The frame sits above the controls (about 250px) instead of under them.
  const scale = composition && size.width && size.height ? Math.min((size.width - 32) / composition.width, (size.height - (editing ? 32 : 270)) / composition.height) : 1;
  // Layers at the cursor: one segment, two inside an overlap transition (CSS-approximated), plus the preloaded next one.
  // The final instant still shows the last frame (spans are end-exclusive).
  const layers = timeline ? layersAt(timeline, Math.min(session.timeMs, Math.max(0, timeline.durationMs - 0.001))) : { segments: [] };
  const shown = layers.segments.map(entry => entry.segment);
  const visible = [...shown, ...(frame.next && !shown.includes(frame.next) ? [frame.next] : [])];
  const localFor = (id: string) => layers.segments.find(entry => entry.segment.id === id)?.localMs ?? 0;
  const tracks = composition?.overlays.filter(track => session.timeMs >= track.startMs && session.timeMs < track.startMs + track.durationMs) ?? [];
  const cue = activeCue(cues, session.timeMs);
  const captionStyle = composition?.captions?.style;
  const renderScene = (recipe: BoundRecipe, Component: ComponentType, timeMs: number, inheritLook: boolean) => {
    const look = recipe.definition.look ?? (inheritLook ? composition?.look : undefined);
    const localMs = (editing || look?.velocityBlur) && recipe.definition.motion ? Math.min(timeMs, motionDuration(recipe.definition.motion)) : timeMs;
    return <CompositionScene definition={recipe.definition} Component={Component} timeMs={localMs} width={composition!.width} height={composition!.height}
      look={editing || look?.velocityBlur ? look : undefined}/>;
  };
  const picture = <div className="velora-viewport" ref={viewport} aria-label="Composition preview" style={{ alignItems: "flex-start", paddingTop: 16 }}>
      {composition && <div ref={frameRef} data-velora-player-frame="" style={{ position: "absolute", left: "50%", top: 16, width: composition.width, height: composition.height, transform: `translateX(-50%) scale(${Math.max(0.05, scale)})`, transformOrigin: "50% 0", background: "#000", overflow: "hidden" }}>
        {visible.map(segment => {
          const recipe = scenes.find(entry => entry.id === segment.recipe);
          const Component = recipe && bindings[recipe.binding];
          const current = shown.includes(segment);
          if (!recipe || !Component) return null;
          const side = layers.blend ? (segment === shown[0] ? "a" : "b") : undefined;
          const blend = side && layers.blend ? blendStyle(layers.blend.transition.type, layers.blend.progress, side, layers.blend.transition.direction) : {};
          const localMs = current ? localFor(segment.id) : segment.inMs ?? 0;
          return <div key={segment.id} data-segment={segment.id} data-active={current ? "true" : "false"} data-local-ms={localMs} aria-hidden={!current}
            style={{ position: "absolute", inset: 0, visibility: current ? "visible" : "hidden", ...blend }}>
            {renderScene(recipe, Component, localMs, true)}
          </div>;
        })}
        {tracks.map(track => {
          const recipe = scenes.find(entry => entry.id === track.recipe);
          const Component = recipe && bindings[recipe.binding];
          if (!recipe || !Component) return null;
          return <div key={track.id} data-overlay={track.id} style={{ position: "absolute", inset: 0, opacity: track.opacity, mixBlendMode: track.blend === "normal" ? undefined : track.blend }}>
            {renderScene(recipe, Component, localTime(track, session.timeMs), false)}
          </div>;
        })}
        {editing && loadedCues && captionStyle && captionStyle !== "burn"
          ? <StyledCaptions cues={loadedCues} style={captionStyle} timeMs={session.timeMs} width={composition.width} height={composition.height}/>
          : cue && <div className="velora-captions" data-velora-preview-chrome="" role="status" style={{ fontSize: composition.height / 22 }}>{cue.text}</div>}
        <StudioOverlays width={composition.width} height={composition.height} state={overlays} root={frameRef} timeMs={session.timeMs}/>
      </div>}
    </div>;
  const transport = <div className="velora-dock">
    <button className="velora-control velora-primary" disabled={!session.valid || missing.length > 0} onClick={session.toggle} aria-label={session.playing ? "Pause" : "Play"}>{session.playing ? "Pause" : "Play"}</button>
    <input className="velora-timeline" type="range" aria-label="Composition time" min={0} max={session.durationMs || 1} step={1000 / (composition?.fps ?? 30)}
      value={session.timeMs} disabled={!session.valid} onChange={event => session.seek(Number(event.target.value))}/>
    <output className="velora-time" data-testid="composition-time">{timeLabel(session.timeMs)} / {timeLabel(session.durationMs)}{session.rate !== 1 && session.playing ? ` · ${session.rate}×` : ""}</output>
  </div>;
  return <main data-velora-preview="" data-velora-player={composition?.id ?? ""}>
    <style>{previewTheme + "[data-overlay] [data-velora-scene]{background:transparent!important;background-color:transparent!important}"}</style>
    {composition?.audio.map(track => {
      const asset = composition.assets.find(entry => entry.id === track.assetId);
      const url = asset && (assetUrl(assetUrls, asset.path) ?? (editing && typeof location !== "undefined" ? projectFileUrl(asset.path).href : undefined));
      return url ? <audio key={track.id} preload="auto" src={url} data-track={track.id} ref={element => { if (element) media.current.set(track.id, element); else media.current.delete(track.id); }}/> : null;
    })}
    {renderEditor ? renderEditor({ viewport: picture, transport, session, composition, cues, issues }) : <>{picture}<footer className="velora-footer velora-chrome" data-velora-preview-chrome="" aria-label="Composition controls">
      <div className="velora-controls" style={{ maxWidth: 1100 }}>
        {issues.length > 0 && <section className="velora-message" role="alert"><strong>This composition needs a correction</strong><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></section>}
        <div className="velora-header">
          <div className="velora-heading">
            {(onBack || backHref) && <a className="velora-control" href={backHref ?? "#"} onClick={event => { if (onBack && event.button === 0 && !event.metaKey && !event.ctrlKey) { event.preventDefault(); onBack(); } }}>Back to compositions</a>}
            <h1 className="velora-title">{composition?.title ?? path}</h1>
          </div>
          <div className="velora-header-tools">{editHref && <a className="velora-control" href={editHref}>Edit</a>}<OverlayMenu state={overlays} onChange={setOverlays}/></div>
        </div>
        {composition && timeline && <div className="velora-strip" role="group" aria-label="Segments">
          {timeline.segments.map(segment => {
            const recipe = scenes.find(entry => entry.id === segment.recipe);
            const transition = composition.scenes.find(scene => scene.id === segment.id)?.transition;
            return <button key={segment.id} aria-current={segment === frame.segment} title={`${recipe?.title ?? segment.recipe}${transition ? ` (${transition.type} in)` : ""}`}
              style={{ position: "absolute", top: 0, bottom: 0, left: `${(segment.startMs / timeline.durationMs) * 100}%`, width: `calc(${(segment.durationMs / timeline.durationMs) * 100}% - 2px)` }}
              onClick={() => session.seek(segment.startMs)}>
              {recipe?.snapshot && <img src={recipe.snapshot.image} alt=""/>}<span>{transition && transition.type !== "cut" ? "◆ " : ""}{recipe?.title ?? segment.recipe}</span>
            </button>;
          })}
          {cues.map((entry, index) => <b key={index} style={{ left: `${(entry.startMs / timeline.durationMs) * 100}%` }}/>)}
          <i style={{ left: `${(session.timeMs / Math.max(1, timeline.durationMs)) * 100}%` }}/>
        </div>}
        {transport}
        <p className="velora-status" role="status">Space play · J/K/L shuttle · ←/→ frame · [ ] segment · Export with <code style={{ background: "#111", color: "#eee", padding: "2px 6px", borderRadius: 6 }}>npx velora render --composition {path.replace(/^\//, "")} --out {composition?.id ?? "video"}.mp4</code></p>
      </div>
    </footer></>}
  </main>;
}
