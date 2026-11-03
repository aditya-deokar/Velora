import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ASPECT_FRAMES, BLUEPRINT_CATALOG, SUBJECT_ID, TEMPLATE_CATALOG, projectSubject, resolveTemplateParams, templateDefinition, type Aspect, type TemplateManifest } from "../core";
import { quickShotSearch } from "./QuickShot";
import { Scene, SceneErrorBoundary, Surface } from "../react";
import { SlotPlaceholder } from "../kit";
import { TemplateLayout } from "./TemplateLayout";

/** SOURCE OF TRUTH: TemplateGallery, templateStoryboard.
 * WHAT: browse the shipped templates and blueprints. Every card draws a schematic storyboard
 * (the subject plane projected at start, middle and end, from buildShot output, no render);
 * only the hovered or focused card runs one live mini preview, so idle cost is zero live scenes.
 * WHY: picking a starting point should take seconds and cost nothing until a card is chosen.
 * WHERE: SceneLibrary's Templates tab; cards open QuickShot through the quick-shot URL contract.
 */
export function templateStoryboard(manifest: TemplateManifest, aspect: Aspect = "16:9") {
  const { params } = resolveTemplateParams(manifest, {});
  const definition = templateDefinition(manifest, params, aspect);
  const subject = ASPECT_FRAMES[aspect].subject;
  const duration = definition.motion.durationMs;
  return { definition, width: definition.width, height: definition.height,
    frames: [0, duration / 2, duration].map(time => projectSubject(definition, subject, time)) };
}
const ALL = "all";
function Storyboard({ manifest }: { manifest: TemplateManifest }) {
  const board = useMemo(() => templateStoryboard(manifest), [manifest]);
  const path = (points: ({ x: number; y: number } | null)[]) => points.every(Boolean) ? "M" + points.map(point => `${point!.x.toFixed(1)} ${point!.y.toFixed(1)}`).join("L") + "Z" : "";
  const stroke = board.width / 240;
  return <svg viewBox={`0 0 ${board.width} ${board.height}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" data-storyboard={manifest.id}>
    <rect width={board.width} height={board.height} fill="#050506"/>
    {board.frames.map((points, index) => <path key={index} d={path(points)} fill={index === 2 ? "rgba(245,245,247,.16)" : "none"}
      stroke={index === 2 ? "#f5f5f7" : "rgba(245,245,247,.38)"} strokeWidth={stroke} strokeDasharray={index === 0 ? `${stroke * 4} ${stroke * 3}` : undefined}/>)}
  </svg>;
}
// The one live preview: a placeholder subject on its own looping clock, alive only while hovered.
function LivePreview({ manifest }: { manifest: TemplateManifest }) {
  const { definition } = useMemo(() => templateStoryboard(manifest), [manifest]);
  const [time, setTime] = useState(0);
  const [width, setWidth] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setWidth(box.current?.clientWidth ?? 0);
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setTime(definition.motion.durationMs); return; }
    const started = performance.now();
    let frame = requestAnimationFrame(function tick(now) { setTime((now - started) % definition.motion.durationMs); frame = requestAnimationFrame(tick); });
    return () => cancelAnimationFrame(frame);
  }, [definition]);
  const subject = ASPECT_FRAMES["16:9"].subject;
  return <div ref={box} data-live-preview={manifest.id} style={{ position: "absolute", inset: 0 }}>
    {width > 0 && <div style={{ width: definition.width, height: definition.height, transform: `scale(${width / definition.width})`, transformOrigin: "0 0" }}>
      <SceneErrorBoundary><Scene camera={definition.scene.camera} focus={definition.scene.focus} motion={definition.motion} timeMs={time} style={{ width: definition.width, height: definition.height }}>
        {"layout" in definition
          ? <TemplateLayout layout={definition.layout} slot={props => <SlotPlaceholder name="Your page" width={Number(props.width)} height={Number(props.height)}/>}/>
          : <Surface id={SUBJECT_ID} style={{ width: subject.width, height: subject.height }}><SlotPlaceholder name="Your page" width={subject.width} height={subject.height}/></Surface>}
      </Scene></SceneErrorBoundary>
    </div>}
  </div>;
}
export function TemplateGallery({ onOpen }: { onOpen?: (search: string) => void }) {
  const [tag, setTag] = useState(ALL);
  const [aspect, setAspect] = useState<Aspect | typeof ALL>(ALL);
  const [live, setLive] = useState<string>();
  const tags = useMemo(() => [...new Set(TEMPLATE_CATALOG.flatMap(entry => entry.tags))].sort(), []);
  const visible = TEMPLATE_CATALOG.filter(entry => (tag === ALL || (entry.tags as string[]).includes(tag)) && (aspect === ALL || entry.aspects.includes(aspect)));
  const link = (manifest: TemplateManifest) => {
    return quickShotSearch({ template: manifest.id, aspect: aspect === ALL ? "16:9" : aspect, overrides: {} }, typeof location === "undefined" ? "" : location.search);
  };
  const open = (event: MouseEvent<HTMLAnchorElement>, search: string) => {
    if (!onOpen || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onOpen(search);
  };
  return <section className="velora-gallery" aria-label="Templates">
    <div className="velora-gallery-filters" role="toolbar" aria-label="Filter templates">
      {[ALL, ...tags].map(value => <button key={value} aria-pressed={tag === value} onClick={() => setTag(value)}>{value === ALL ? "All" : value}</button>)}
      <select aria-label="Aspect" value={aspect} onChange={event => setAspect(event.target.value as Aspect | typeof ALL)}>
        <option value={ALL}>Any aspect</option>{Object.keys(ASPECT_FRAMES).map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </div>
    <div className="velora-gallery-grid">
      {visible.map(manifest => {
        const search = link(manifest);
        return <article key={manifest.id} className="velora-card" data-template={manifest.id}
          onMouseEnter={() => setLive(manifest.id)} onMouseLeave={() => setLive(value => value === manifest.id ? undefined : value)}
          onFocus={() => setLive(manifest.id)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setLive(value => value === manifest.id ? undefined : value); }}>
          <div className="velora-card-media">{live === manifest.id ? <LivePreview manifest={manifest}/> : <Storyboard manifest={manifest}/>}</div>
          <h2>{manifest.title}</h2>
          <p>{manifest.summary}</p>
          <div className="velora-card-tags">{manifest.tags.map(value => <span key={value}>{value}</span>)}</div>
          <a className="velora-card-open" href={search} onClick={event => open(event, search)} aria-label={`Try ${manifest.title} on your app`}>Try on your app</a>
        </article>;
      })}
      {visible.length === 0 && <p>No template matches these filters.</p>}
    </div>
    {tag === ALL && aspect === ALL && <>
      <h2 style={{ maxWidth: 1240, margin: "40px auto 16px", fontSize: 18, fontWeight: 550 }}>Blueprints</h2>
      <div className="velora-gallery-grid">{BLUEPRINT_CATALOG.map(blueprint => <article key={blueprint.id} className="velora-card" data-blueprint={blueprint.id}>
        <h2>{blueprint.title}</h2><p>{blueprint.summary}</p>
        <code style={{ fontSize: 11, color: "#ddd", overflowWrap: "anywhere" }}>npx velora new video --blueprint {blueprint.id} --id {blueprint.id.split("-")[0]} --route / --json</code>
      </article>)}</div>
    </>}
  </section>;
}
