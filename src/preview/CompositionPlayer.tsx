import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { CompositionSchema, layersAt, parseCaptions, timelineFromComposition, type BoundRecipe, type CaptionCue, type PreviewDefinitionInput } from "../core";
import { Scene, SceneErrorBoundary } from "../react";
import { usePreviewSession } from "./session";
import { useTransportKeys } from "./transport";
import { OverlayMenu, StudioOverlays, useOverlays } from "./overlays";
import { activeCue, audioStateAt, blendStyle, playerFrame, syncMedia } from "./player";
import { previewTheme } from "./theme";

/** SOURCE OF TRUTH: CompositionPlayer.
 * WHAT: watch a whole composition like an editor reviews a cut: the active segment's bound scene at
 * its local time, the next segment preloaded, gaps as black void, audio and captions, a segment
 * strip and keyboard transport.
 * WHY: one cursor (usePreviewSession timeline mode) drives picture, audio and captions, so the review
 * matches `velora render`; audio elements follow the cursor with drift correction, never lead it.
 * WHERE: SceneLibrary's Compositions tab. No capture bridge: export stays `velora render`.
 * Transitions are drawn as markers only; true A/B transitions arrive with the editorial phase.
 */
export type CompositionPlayerProps = {
  path: string; document: unknown; scenes: readonly BoundRecipe[]; bindings: Record<string, ComponentType>;
  assetUrls?: Record<string, string>; onBack?: () => void; backHref?: string;
};
const timeLabel = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1000 / 100))}`;
const assetUrl = (urls: Record<string, string> | undefined, file: string) => urls?.["/" + file.replace(/^\.?\//, "")] ?? urls?.[file];
export function CompositionPlayer({ path, document, scenes, bindings, assetUrls, onBack, backHref }: CompositionPlayerProps) {
  const parsed = useMemo(() => CompositionSchema.safeParse(document), [document]);
  const composition = parsed.success ? parsed.data : undefined;
  const timeline = useMemo(() => composition ? timelineFromComposition(composition) : undefined, [composition]);
  const missing = composition ? composition.scenes.filter(scene => !scenes.some(entry => entry.id === scene.recipe)).map(scene => scene.recipe) : [];
  // The cursor's carrier: a valid, motionless frame of the composition's size; the timeline sets the span.
  const carrier = useMemo<PreviewDefinitionInput | undefined>(() => composition && { width: composition.width, height: composition.height,
    scene: { nodes: [{ id: "velora-composition" }] }, motion: { durationMs: Math.max(1, timeline!.durationMs), speed: 1, tracks: [] } }, [composition, timeline]);
  const descriptor = useMemo(() => timeline && { durationMs: timeline.durationMs, boundaries: [...new Set(timeline.segments.flatMap(segment => [segment.startMs, segment.startMs + segment.durationMs]))] }, [timeline]);
  const session = usePreviewSession(carrier, path, descriptor);
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
  const [cues, setCues] = useState<CaptionCue[]>([]);
  const captionsFile = composition?.captions?.file;
  useEffect(() => {
    setCues([]);
    const url = captionsFile && assetUrl(assetUrls, captionsFile);
    if (!url) return;
    let active = true;
    fetch(url).then(response => response.text()).then(text => {
      const result = parseCaptions(text, captionsFile!.toLowerCase().endsWith(".vtt") ? "vtt" : "srt");
      if (active && "cues" in result) setCues(result.cues);
    }).catch(() => {});
    return () => { active = false; };
  }, [captionsFile, assetUrls]);
  // Audio follows the cursor: one element per track, resynced past the drift budget.
  const media = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    if (!composition) return;
    for (const track of composition.audio) {
      const element = media.current.get(track.id);
      if (!element) continue;
      syncMedia(element, audioStateAt(track, session.timeMs, timeline!.durationMs), session.playing, session.rate);
    }
  }, [composition, timeline, session.timeMs, session.playing, session.rate]);
  useEffect(() => () => { for (const element of media.current.values()) element.pause(); }, []);
  const issues = !parsed.success ? parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) :
    missing.map(id => `Scene recipe "${id}" was not found in src/velora/scenes.`);
  const frame = timeline ? playerFrame(timeline, session.timeMs) : { localMs: 0 };
  // The frame sits above the controls (about 250px) instead of under them.
  const scale = composition && size.width && size.height ? Math.min((size.width - 32) / composition.width, (size.height - 270) / composition.height) : 1;
  // Layers at the cursor: one segment, two inside an overlap transition (CSS-approximated), plus the preloaded next one.
  // The final instant still shows the last frame (spans are end-exclusive).
  const layers = timeline ? layersAt(timeline, Math.min(session.timeMs, Math.max(0, timeline.durationMs - 0.001))) : { segments: [] };
  const shown = layers.segments.map(entry => entry.segment);
  const visible = [...shown, ...(frame.next && !shown.includes(frame.next) ? [frame.next] : [])];
  const localFor = (id: string) => layers.segments.find(entry => entry.segment.id === id)?.localMs ?? 0;
  const tracks = composition?.overlays.filter(track => session.timeMs >= track.startMs && session.timeMs < track.startMs + track.durationMs) ?? [];
  const cue = activeCue(cues, session.timeMs);
  return <main data-velora-preview="" data-velora-player={composition?.id ?? ""}>
    <style>{previewTheme + "[data-overlay] [data-velora-scene]{background:transparent!important;background-color:transparent!important}"}</style>
    <div className="velora-viewport" ref={viewport} aria-label="Composition preview" style={{ alignItems: "flex-start", paddingTop: 16 }}>
      {composition && <div ref={frameRef} data-velora-player-frame="" style={{ position: "absolute", left: "50%", top: 16, width: composition.width, height: composition.height, transform: `translateX(-50%) scale(${Math.max(0.05, scale)})`, transformOrigin: "50% 0", background: "#000", overflow: "hidden" }}>
        {visible.map(segment => {
          const recipe = scenes.find(entry => entry.id === segment.recipe);
          const Component = recipe && bindings[recipe.binding];
          const current = shown.includes(segment);
          if (!recipe || !Component) return null;
          const side = layers.blend ? (segment === shown[0] ? "a" : "b") : undefined;
          const blend = side && layers.blend ? blendStyle(layers.blend.transition.type, layers.blend.progress, side, layers.blend.transition.direction) : {};
          return <div key={segment.id} data-segment={segment.id} data-active={current ? "true" : "false"} aria-hidden={!current}
            style={{ position: "absolute", inset: 0, visibility: current ? "visible" : "hidden", ...blend }}>
            <SceneErrorBoundary><Scene camera={recipe.definition.scene.camera} focus={recipe.definition.scene.focus} constraints={recipe.definition.scene.constraints} motion={recipe.definition.motion}
              timeMs={current ? localFor(segment.id) : 0} style={{ width: composition.width, height: composition.height }}><Component/></Scene></SceneErrorBoundary>
          </div>;
        })}
        {tracks.map(track => {
          const recipe = scenes.find(entry => entry.id === track.recipe);
          const Component = recipe && bindings[recipe.binding];
          if (!recipe || !Component) return null;
          return <div key={track.id} data-overlay={track.id} style={{ position: "absolute", inset: 0, opacity: track.opacity, mixBlendMode: track.blend === "normal" ? undefined : track.blend }}>
            <SceneErrorBoundary><Scene camera={recipe.definition.scene.camera} focus={recipe.definition.scene.focus} constraints={recipe.definition.scene.constraints} motion={recipe.definition.motion}
              timeMs={session.timeMs - track.startMs + (track.inMs ?? 0)} style={{ width: composition.width, height: composition.height }}><Component/></Scene></SceneErrorBoundary>
          </div>;
        })}
        {cue && <div className="velora-captions" data-velora-preview-chrome="" role="status" style={{ fontSize: composition.height / 22 }}>{cue.text}</div>}
        <StudioOverlays width={composition.width} height={composition.height} state={overlays} root={frameRef} timeMs={session.timeMs}/>
      </div>}
    </div>
    {composition?.audio.map(track => {
      const asset = composition.assets.find(entry => entry.id === track.assetId);
      const url = asset && assetUrl(assetUrls, asset.path);
      return url ? <audio key={track.id} preload="auto" src={url} data-track={track.id} ref={element => { if (element) media.current.set(track.id, element); else media.current.delete(track.id); }}/> : null;
    })}
    <footer className="velora-footer velora-chrome" data-velora-preview-chrome="" aria-label="Composition controls">
      <div className="velora-controls" style={{ maxWidth: 1100 }}>
        {issues.length > 0 && <section className="velora-message" role="alert"><strong>This composition needs a correction</strong><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></section>}
        <div className="velora-header">
          <div className="velora-heading">
            {(onBack || backHref) && <a className="velora-control" href={backHref ?? "#"} onClick={event => { if (onBack && event.button === 0 && !event.metaKey && !event.ctrlKey) { event.preventDefault(); onBack(); } }}>Back to compositions</a>}
            <h1 className="velora-title">{composition?.title ?? path}</h1>
          </div>
          <div className="velora-header-tools"><OverlayMenu state={overlays} onChange={setOverlays}/></div>
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
        <div className="velora-dock">
          <button className="velora-control velora-primary" disabled={!session.valid || issues.length > 0} onClick={session.toggle} aria-label={session.playing ? "Pause" : "Play"}>{session.playing ? "Pause" : "Play"}</button>
          <input className="velora-timeline" type="range" aria-label="Composition time" min={0} max={session.durationMs || 1} step={1000 / (composition?.fps ?? 30)}
            value={session.timeMs} disabled={!session.valid} onChange={event => session.seek(Number(event.target.value))}/>
          <output className="velora-time" data-testid="composition-time">{timeLabel(session.timeMs)} / {timeLabel(session.durationMs)}{session.rate !== 1 && session.playing ? ` · ${session.rate}×` : ""}</output>
        </div>
        <p className="velora-status" role="status">Space play · J/K/L shuttle · ←/→ frame · [ ] segment · Export with <code style={{ background: "#111", color: "#eee", padding: "2px 6px", borderRadius: 6 }}>npx velora render --composition {path.replace(/^\//, "")} --out {composition?.id ?? "video"}.mp4</code></p>
      </div>
    </footer>
  </main>;
}
