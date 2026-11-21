import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { isOverlapTransition, localTime, transitionMode, type BoundRecipe, type CaptionCue, type Composition, type CompositionIssue, type EditOp, type EditorialAdvisory, type MediaPeaks, type TransitionType } from "../../core";
import { Ruler } from "../timeline/Ruler";
import { quantize, snapTime, type SnapCandidate } from "../timeline/snap";
import { AudioLane, audioEnd } from "./AudioLane";
import { SegmentClip } from "./SegmentClip";
import { TransitionHandle } from "./TransitionHandle";
import { MarkersLane } from "./MarkersLane";
import { byStart, clipEnd, cutSnapCandidates, overlayRows, segmentGesture, type CutSelection, type CutTool } from "./tools";

export type PeakResult = { media?: MediaPeaks; error?: string };
type Builder = (deltaMs: number, pointerMs: number, deltaY: number) => EditOp[];
type Gesture = { x: number; y: number; pointerId: number; anchor: number; px: number; candidates: SnapCandidate[]; build: Builder; snap: boolean; label?: string; moved: boolean };
const LABEL_WIDTH = 90;
export function transitionOp(composition: Composition, id: string, type: TransitionType, durationMs?: number): EditOp {
  const ordered = byStart(composition.scenes), index = ordered.findIndex(clip => clip.id === id);
  const room = Math.min(ordered[index]?.durationMs ?? 1, ordered[index - 1]?.durationMs ?? Infinity);
  return { op: "transition.set", segmentId: id, type, durationMs: durationMs ?? Math.max(1, Math.min(400, room / 3)), mode: transitionMode({ type }) };
}

export function Lanes({ composition, scenes, durationMs, cursor, cues, peaks, advisories, warnings, tool, selected, snap, zoom, select, seek, preview, commit, cancel, openScene }: {
  composition: Composition; scenes: readonly BoundRecipe[]; durationMs: number; cursor: number; cues: readonly CaptionCue[];
  peaks: Record<string, PeakResult>; advisories: EditorialAdvisory[]; warnings: CompositionIssue[];
  tool: CutTool; selected?: CutSelection; snap: boolean; zoom: number; select(value?: CutSelection): void; seek(ms: number): void;
  preview(ops: EditOp[]): void; commit(ops: EditOp[], label?: string): void; cancel(): void;
  openScene(recipe: string, localMs: number, globalMs: number): void;
}) {
  const scroller = useRef<HTMLDivElement>(null), grid = useRef<HTMLDivElement>(null), active = useRef<Gesture>(undefined), suppress = useRef(false);
  const [width, setWidth] = useState(800);
  const [snapLine, setSnapLine] = useState<number>();
  const span = Math.max(1000, durationMs, ...composition.overlays.map(clipEnd), ...composition.markers.map(marker => marker.atMs), ...cues.map(cue => cue.endMs));
  const fittedPx = Math.max(160, width - LABEL_WIDTH - 12);
  const px = fittedPx * zoom / span;
  const gridWidth = Math.ceil(span * px) + 12;
  const ordered = useMemo(() => byStart(composition.scenes), [composition.scenes]);
  const layers = useMemo(() => overlayRows(composition.overlays), [composition.overlays]);
  const recipes = useMemo(() => new Map(scenes.map(recipe => [recipe.id, recipe])), [scenes]);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, []);
  const cancelGesture = () => { active.current = undefined; setSnapLine(undefined); cancel(); };
  useEffect(() => {
    const stop = (event: KeyboardEvent) => { if (event.key === "Escape" && active.current) cancelGesture(); };
    window.addEventListener("keydown", stop);
    return () => window.removeEventListener("keydown", stop);
  }, [cancel]);
  const timeAt = (clientX: number, scale = px) => Math.max(0, (clientX - (grid.current?.getBoundingClientRect().left ?? clientX) - LABEL_WIDTH) / scale);
  const begin = (event: PointerEvent, anchor: number, selection: CutSelection | undefined, build: Builder, label?: string, snapGesture = true, excluded = selection) => {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    suppress.current = false;
    active.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, anchor, px, build, snap: snapGesture,
      label, candidates: cutSnapCandidates(composition, cursor, excluded), moved: false };
    if (selection) select(selection);
  };
  const move = (event: PointerEvent, finish = false) => {
    const drag = active.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.moved ||= Math.hypot(dx, dy) >= 3;
    if (!drag.moved) { if (finish) cancelGesture(); return; }
    const pointerMs = timeAt(event.clientX, drag.px);
    const target = drag.snap ? snapTime(drag.anchor + dx / drag.px, { fps: composition.fps, pxPerMs: drag.px, enabled: snap && !event.shiftKey,
      candidates: drag.candidates }) : { timeMs: drag.anchor + dx / drag.px, kind: "frame" };
    const ops = drag.build(target.timeMs - drag.anchor, pointerMs, dy);
    if (finish) {
      suppress.current = true;
      cancelGesture();
      commit(ops, drag.label);
    } else {
      setSnapLine(target.kind === "frame" ? undefined : target.timeMs);
      preview(ops);
    }
  };
  const onSelect = (selection: CutSelection, time?: number) => {
    if (suppress.current) return;
    select(selection);
    if (time !== undefined) seek(Math.min(durationMs, time));
  };
  const row = (label: string, content: ReactNode, extra = "") => <div key={label} className={`vc-row ${extra}`} role="row">
    <span className="vc-lane-label" role="rowheader">{label}</span><div className="vc-lane" role="gridcell">{content}</div>
  </div>;
  const warningAt = (lane: "scenes" | "overlays", index: number) => warnings.find(warning => warning.path === `composition.${lane}.${index}`)?.message;
  const cuePosition = (pointerX: number) => quantize(timeAt(pointerX), composition.fps);
  const seekAt = (pointerX: number) => seek(Math.min(durationMs, cuePosition(pointerX)));
  const reviewPins = advisories.map((advisory, index) => {
    const [,, laneIndex] = advisory.path.split(".");
    const overlay = advisory.path.startsWith("composition.overlays.");
    const clip = (overlay ? composition.overlays : composition.scenes)[Number(laneIndex)];
    if (!clip) return null;
    const time = advisory.atMs ?? clip.startMs;
    return <button key={`${advisory.code}-${index}`} className="vc-review-pin" style={{ left: time * px, top: 3 + (index % 3) * 10 }}
      aria-label={advisory.message} title={advisory.message} onClick={() => onSelect({ lane: overlay ? "overlay" : "segment", id: clip.id }, time)}>!</button>;
  });
  return <div className="vc-scroll" ref={scroller}>
    <div className="vc-grid" ref={grid} role="grid" aria-label="Composition lanes" style={{ width: gridWidth + LABEL_WIDTH, gridTemplateColumns: `${LABEL_WIDTH}px ${gridWidth}px` }}
      onPointerMove={event => move(event)} onPointerUp={event => move(event, true)} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (active.current) cancelGesture(); }}
      onClickCapture={event => { if (suppress.current && event.detail > 0) { event.stopPropagation(); suppress.current = false; } }}>
      {row("Time", <div className="vc-ruler" data-testid="cut-ruler" onPointerDown={event => {
        if (event.button !== 0) return;
        suppress.current = false;
        seekAt(event.clientX);
      }} onPointerMove={event => { if (event.buttons === 1) seekAt(event.clientX); }}>
        <svg width={gridWidth} height={24} aria-hidden="true"><Ruler width={gridWidth} durationMs={durationMs} start={0} pxPerMs={px} markers={[]} playhead={cursor}/></svg>
      </div>, "vc-ruler-row")}
      {row("Markers / beats", <MarkersLane markers={composition.markers} pxPerMs={px} selected={selected?.lane === "marker" ? selected.index : undefined}
        onSelect={index => onSelect({ lane: "marker", index }, composition.markers[index].atMs)} onDrag={(event, index) => {
          const marker = composition.markers[index];
          begin(event, marker.atMs, { lane: "marker", index }, delta => [{ op: "marker.move", index, fromMs: marker.atMs, atMs: marker.atMs + delta }]);
        }}/>, "vc-marker-row")}
      {row("V1 Cuts", <>
        {ordered.map((clip, index) => {
          const previous = ordered[index - 1], pick = { lane: "segment", id: clip.id } as const;
          const duration = clip.transition?.durationMs ?? 0;
          const overlap = clip.transition && isOverlapTransition(clip.transition.type);
          return <TransitionHandle key={clip.id} clip={clip} left={clip.startMs * px} width={duration * px}
            onSelect={() => onSelect(pick, clip.startMs)} onDrop={type => { select(pick); commit([transitionOp(composition, clip.id, type)], `Apply ${type}`); }}
            onDrag={event => {
              if (!clip.transition || !previous) return;
              const { transition } = clip;
              const anchor = overlap ? clip.startMs : clip.startMs + duration;
              begin(event, anchor, pick, delta => [{ ...transition, op: "transition.set", segmentId: clip.id,
                durationMs: Math.max(1000 / composition.fps, duration + (overlap ? -delta : delta)) }], `Resize ${transition.type}`);
            }}/>;
        })}
      </>, "vc-transitions-row")}
      {row("V1", ordered.map(clip => {
        const recipe = recipes.get(clip.recipe), pick = { lane: "segment", id: clip.id } as const;
        return <SegmentClip key={clip.id} id={clip.id} label={recipe?.title ?? clip.recipe} snapshot={recipe?.snapshot?.image}
          left={clip.startMs * px} width={clip.durationMs * px} selected={selected?.lane === "segment" && selected.id === clip.id}
          warning={warningAt("scenes", composition.scenes.indexOf(clip))} badge={clip.inMs ? `In ${Math.round(clip.inMs)} ms` : undefined}
          onDrag={(event, edge) => {
            if (tool === "razor") { suppress.current = false; return; }
            begin(event, edge === "out" || (edge === "body" && tool === "ripple") ? clipEnd(clip) : clip.startMs, pick,
              (delta, pointer) => segmentGesture(tool, clip, edge, ordered, delta, pointer), undefined, tool !== "slip");
          }} onSelect={event => {
            if (tool === "razor") {
              select(pick);
              commit([{ op: "segment.split", id: clip.id, atMs: event.detail ? cuePosition(event.clientX) : cursor }]);
            } else onSelect(pick, cursor >= clip.startMs && cursor < clipEnd(clip) ? undefined : clip.startMs);
          }} onOpen={() => {
            if (!recipe || tool === "razor") return;
            const time = cursor >= clip.startMs && cursor < clipEnd(clip) ? cursor : clip.startMs;
            openScene(clip.recipe, localTime(clip, time), time);
          }}/>;
      }))}
      {layers.map((clips, index) => row(`V${index + 2}`, clips.map(clip => {
        const recipe = recipes.get(clip.recipe), pick = { lane: "overlay", id: clip.id } as const;
        return <SegmentClip key={clip.id} id={clip.id} label={recipe?.title ?? clip.recipe} snapshot={recipe?.snapshot?.image} overlay
          badge={`${Math.round(clip.opacity * 100)}% · ${clip.blend}`} warning={warningAt("overlays", composition.overlays.indexOf(clip))}
          left={clip.startMs * px} width={clip.durationMs * px} selected={selected?.lane === "overlay" && selected.id === clip.id}
          onSelect={() => onSelect(pick, clip.startMs)} onDrag={(event, edge) => begin(event, edge === "out" ? clipEnd(clip) : clip.startMs, pick, delta => [edge === "body"
            ? { op: "overlay.move", id: clip.id, atMs: clip.startMs + delta } : { op: "overlay.trim", id: clip.id, edge, deltaMs: delta }])}/>;
      })))}
      {row(`Captions${composition.captions?.style ? ` · ${composition.captions.style}` : ""}`, cues.map((cue, index) => <button className="vc-caption" key={index}
        title={cue.text} style={{ left: cue.startMs * px, width: Math.max(3, (cue.endMs - cue.startMs) * px) }} onClick={() => onSelect({ lane: "captions" }, cue.startMs)}>{cue.text}</button>), "vc-caption-row")}
      {composition.audio.map((track, index) => row(`A${index + 1} · ${track.kind ?? "Audio"}`, <AudioLane track={track} media={peaks[track.assetId]?.media} error={peaks[track.assetId]?.error}
        fps={composition.fps} durationMs={durationMs} pxPerMs={px} selected={selected?.lane === "audio" && selected.id === track.id}
        onSelect={() => onSelect({ lane: "audio", id: track.id }, track.startMs)} onDrag={(event, handle) => {
          const pick = { lane: "audio", id: track.id } as const;
          const end = audioEnd(track, durationMs, peaks[track.assetId]?.media);
          const anchor = handle === "out" ? end : handle === "fadeInMs" ? track.startMs + track.fadeInMs : handle === "fadeOutMs" ? end - track.fadeOutMs : track.startMs;
          begin(event, anchor, pick, (delta, _pointer, dy) => {
            if (handle === "gain") return [{ op: "audio.set", id: track.id, gain: Math.max(0, Math.min(2, Math.round((track.gain - dy / 24) * 100) / 100)) }];
            if (handle === "fadeInMs" || handle === "fadeOutMs") {
              const available = end - track.startMs - (handle === "fadeInMs" ? track.fadeOutMs : track.fadeInMs);
              return [{ op: "audio.set", id: track.id, [handle]: Math.max(0, Math.min(30_000, available, track[handle] + (handle === "fadeInMs" ? delta : -delta))) }];
            }
            if (handle === "body") return [{ op: "audio.move", id: track.id, atMs: track.startMs + delta }];
            return [{ op: "audio.trim", id: track.id, edge: handle, deltaMs: delta, endMs: end }];
          }, undefined, handle !== "gain");
        }}/>, "vc-audio-row"))}
      {row("Review", reviewPins, "vc-review-row")}
      <span className="vc-playhead" aria-hidden="true" style={{ left: LABEL_WIDTH + cursor * px }}/>
      {snapLine !== undefined && <span className="vc-playhead vc-snapline" aria-hidden="true" style={{ left: LABEL_WIDTH + snapLine * px }}/>}
    </div>
  </div>;
}
