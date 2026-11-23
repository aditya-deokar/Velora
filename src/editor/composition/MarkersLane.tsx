import type { PointerEvent } from "react";
import type { Composition } from "../../core";

export function MarkersLane({ markers, pxPerMs, selected, onSelect, onDrag }: { markers: Composition["markers"]; pxPerMs: number; selected?: number;
  onSelect(index: number): void; onDrag(event: PointerEvent, index: number): void }) {
  return markers.map((marker, index) => <button key={index} className="vc-marker" data-kind={marker.kind} aria-pressed={index === selected}
    title={`${marker.label || marker.kind} · ${Math.round(marker.atMs)} ms`} aria-label={`${marker.kind} ${marker.label || `${Math.round(marker.atMs)} ms`}`}
    style={{ left: marker.atMs * pxPerMs }} onPointerDown={event => onDrag(event, index)} onClick={() => onSelect(index)}>
    {marker.kind === "beat" ? "│" : marker.kind === "downbeat" ? "▾" : marker.kind === "section" ? "⚑" : "◆"}
  </button>);
}
