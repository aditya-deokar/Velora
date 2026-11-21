import type { TimelineRow } from "./Rows";

export const staggerHandleX = (row: Extract<TimelineRow, { kind: "clip" }>, x: (time: number) => number) =>
  Math.max(x(row.start) + 8, x(row.start + (row.staggerHandle?.offset ?? 0)));

/** A clip bar: label, speed, loop, ease and add-mode badges; stagger member offsets as ticks.
 * Edges (6 px) trim; the body moves; Alt-drag changes speed (handled by the timeline). */
export function ClipBar({ row, x, y, pxPerMs, selected }: { row: Extract<TimelineRow, { kind: "clip" }>; x: (time: number) => number; y: number; pxPerMs: number; selected: boolean }) {
  const left = x(row.start), width = Math.max(4, (row.end - row.start) * pxPerMs);
  const badges = [`${row.speed}×`, row.loop ? `loop ${row.loop}` : "", row.ease ? `ease ${row.ease}` : "", row.mode === "add" ? "add" : ""].filter(Boolean).join(" · ");
  return <g data-clip={row.clipId}>
    <rect x={left} y={y + 3} width={width} height={18} rx={4} fill={row.mode === "add" ? "#3a2f5c" : "#24425c"} stroke={selected ? "#ff8a3d" : "#7cc4ff88"} strokeWidth={selected ? 2 : 1}/>
    <rect x={left} y={y + 3} width={6} height={18} fill="#7cc4ff55" data-edge="start"/>
    <rect x={left + width - 6} y={y + 3} width={6} height={18} fill="#7cc4ff55" data-edge="end"/>
    <text x={left + 10} y={y + 16} fontSize={11} fill="#ececf1" style={{ pointerEvents: "none" }}>{row.label} ({badges})</text>
    {row.members?.map(member => <line key={member.id} x1={left + member.offset * pxPerMs} x2={left + member.offset * pxPerMs} y1={y + 18} y2={y + 23} stroke="#ffd166"><title>{member.id}</title></line>)}
    {row.staggerHandle && <path data-stagger-handle={row.clipId} d={`M${staggerHandleX(row, x)} ${y + 12} l5 5 l-5 5 l-5 -5 z`} fill="#ffd166" stroke="#000" strokeWidth={0.8}><title>Drag to change the stagger</title></path>}
  </g>;
}
