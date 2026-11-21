import type { PointerEvent } from "react";
import { audioPlacement, type AudioTrack, type MediaPeaks } from "../../core";
import { Waveform } from "./Waveform";

export function audioEnd(track: AudioTrack, compositionEnd: number, media?: MediaPeaks): number {
  const sourceLength = Math.max(0, (media?.durationMs ?? Infinity) - track.offsetMs);
  return Math.min(compositionEnd, track.startMs + Math.min(track.durationMs ?? Infinity, sourceLength));
}
export function AudioLane({ track, media, error, fps, durationMs, pxPerMs, selected, onSelect, onDrag }: {
  track: AudioTrack; media?: MediaPeaks; error?: string; fps: number; durationMs: number; pxPerMs: number; selected: boolean;
  onSelect(): void; onDrag(event: PointerEvent, handle: "body" | "in" | "out" | "gain" | "fadeInMs" | "fadeOutMs"): void;
}) {
  const start = audioPlacement(track, fps).startMs;
  const span = Math.max(0, audioEnd({ ...track, startMs: start }, durationMs, media) - start);
  const width = Math.max(8, span * pxPerMs);
  const left = Math.min(width, track.fadeInMs * pxPerMs);
  const right = Math.max(0, width - track.fadeOutMs * pxPerMs);
  const badge = error ? "Waveform unavailable" : `${track.gain.toFixed(2)}×`;
  return <div className="vc-clip vc-audio" data-audio-clip={track.id} data-selected={selected} style={{ left: start * pxPerMs, width }}>
    {media && span > 0 && <Waveform media={media} offsetMs={track.offsetMs} durationMs={span}/>}
    <button className="vc-clip-body" aria-label={`Audio ${track.id}, ${badge}`} aria-pressed={selected} title={error ?? track.assetId} onPointerDown={event => onDrag(event, "body")} onClick={onSelect}>
      <strong>{track.id}</strong><small>{badge}</small>
    </button>
    <button className="vc-edge vc-edge-in" aria-label={`Trim ${track.id} in`} onPointerDown={event => onDrag(event, "in")} onClick={onSelect}/>
    <button className="vc-edge vc-edge-out" aria-label={`Trim ${track.id} out`} onPointerDown={event => onDrag(event, "out")} onClick={onSelect}/>
    <button className="vc-gain" aria-label={`Drag ${track.id} gain`} style={{ top: `${84 - track.gain * 32}%`, left: Math.min(left, right), width: Math.max(8, right - left) }} onPointerDown={event => onDrag(event, "gain")} onClick={onSelect}/>
    <button className="vc-fade" aria-label={`Drag ${track.id} fade in`} style={{ left: Math.max(8, left) }} onPointerDown={event => onDrag(event, "fadeInMs")} onClick={onSelect}>◢</button>
    <button className="vc-fade" aria-label={`Drag ${track.id} fade out`} style={{ left: Math.max(8, Math.min(width - 8, right)) }} onPointerDown={event => onDrag(event, "fadeOutMs")} onClick={onSelect}>◣</button>
  </div>;
}
