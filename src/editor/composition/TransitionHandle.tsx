import type { PointerEvent } from "react";
import { TransitionTypeSchema, type CompositionScene, type TransitionType } from "../../core";

export const TRANSITION_DRAG_TYPE = "application/x-velora-transition";
export function TransitionHandle({ clip, left, width, onSelect, onDrag, onDrop }: { clip: CompositionScene; left: number; width: number;
  onSelect(): void; onDrag(event: PointerEvent): void; onDrop(type: TransitionType): void }) {
  return <button className="vc-transition" data-transition-cut={clip.id} data-has-transition={!!clip.transition} style={{ left, width: Math.max(20, width) }}
    aria-label={`Transition into ${clip.id}`} title={clip.transition ? `${clip.transition.type} · ${Math.round(clip.transition.durationMs)} ms` : `Drop a transition into ${clip.id}`}
    onClick={onSelect} onPointerDown={onDrag} onDragOver={event => {
      if (event.dataTransfer.types.includes(TRANSITION_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }
    }} onDrop={event => {
      const parsed = TransitionTypeSchema.safeParse(event.dataTransfer.getData(TRANSITION_DRAG_TYPE));
      if (!parsed.success) return;
      event.preventDefault();
      onDrop(parsed.data);
    }}>{clip.transition?.type ?? "◆"}</button>;
}
