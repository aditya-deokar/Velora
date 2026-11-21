import type { PointerEvent } from "react";

export function SegmentClip({ id, label, snapshot, badge, warning, selected, left, width, overlay, onSelect, onOpen, onDrag }: {
  id: string; label: string; snapshot?: string; badge?: string; warning?: string; selected: boolean; left: number; width: number; overlay?: boolean;
  onSelect(event: React.MouseEvent<HTMLButtonElement>): void; onOpen?(): void; onDrag(event: PointerEvent, edge: "in" | "out" | "body"): void;
}) {
  return <div className={`vc-clip${overlay ? " vc-overlay" : ""}`} data-cut-clip={id} data-selected={selected} style={{ left, width: Math.max(4, width) }}>
    {snapshot && <img src={snapshot} alt="" loading="lazy" decoding="async"/>}
    <button className="vc-clip-body" aria-label={[`${overlay ? "Overlay" : "Shot"} ${id}`, label, badge].filter(Boolean).join(", ")}
      aria-pressed={selected} aria-description={warning} title={warning ? `${label} · ${warning}` : label}
      onPointerDown={event => onDrag(event, "body")} onClick={onSelect} onDoubleClick={onOpen}>
      <strong>{label}</strong>{badge && <small>{badge}</small>}{warning && <span className="vc-warning" aria-hidden="true">⚠</span>}
    </button>
    <button className="vc-edge vc-edge-in" aria-label={`Trim ${id} in`} onPointerDown={event => onDrag(event, "in")} onClick={onSelect}/>
    <button className="vc-edge vc-edge-out" aria-label={`Trim ${id} out`} onPointerDown={event => onDrag(event, "out")} onClick={onSelect}/>
  </div>;
}
