import { applyEasing, type EasingInput } from "../../core";
import { springStats } from "./handles";

/** Spring and steps segments: parameters with a live curve (the canonical applyEasing), settle time and
 * overshoot (springs), or count and jump (steps). */
export function SpringPanel({ easing, durationMs, onChange, sample }: { easing: unknown; durationMs: number; onChange(easing: EasingInput): void; sample(progress: number): number }) {
  const value = easing as { spring?: { stiffness?: number; damping?: number; mass?: number }; steps?: number; jump?: "start" | "end" };
  const curve = Array.from({ length: 81 }, (_, i) => `${i ? "L" : "M"}${(i / 80) * 180} ${70 - sample(i / 80) * 50}`).join("");
  if (value.steps !== undefined) return <div className="ve-panel" style={{ width: 220, padding: 8, borderLeft: "1px solid var(--ve-line)" }} aria-label="Steps">
    <strong>Steps</strong>
    <svg width={180} height={80}><path d={curve} fill="none" stroke="#7cc4ff"/></svg>
    <label style={{ display: "grid" }}>Count<input className="ve-input" type="number" min={1} max={240} defaultValue={value.steps} onKeyDown={event => { if (event.key === "Enter") onChange({ steps: Number(event.currentTarget.value), jump: value.jump ?? "end" }); }}/></label>
    <label style={{ display: "grid" }}>Jump<select className="ve-input" value={value.jump ?? "end"} onChange={event => onChange({ steps: value.steps!, jump: event.target.value as "start" | "end" })}><option>end</option><option>start</option></select></label>
  </div>;
  const spring = { stiffness: 170, damping: 26, mass: 1, ...value.spring };
  const stats = springStats(progress => applyEasing({ spring }, progress), durationMs);
  const field = (key: "stiffness" | "damping" | "mass") => <label key={key} style={{ display: "grid" }}>{key}
    <input className="ve-input" type="number" step="any" defaultValue={spring[key]} key={spring[key]} onKeyDown={event => { if (event.key === "Enter") onChange({ spring: { ...spring, [key]: Number(event.currentTarget.value) } }); }}/></label>;
  return <div className="ve-panel" style={{ width: 220, padding: 8, borderLeft: "1px solid var(--ve-line)" }} aria-label="Spring">
    <strong>Spring</strong>
    <svg width={180} height={80} aria-hidden="true"><line x1={0} x2={180} y1={20} y2={20} stroke="#ffffff33"/><path d={curve} fill="none" stroke="#7cc4ff"/></svg>
    {field("stiffness")}{field("damping")}{field("mass")}
    <p style={{ margin: "6px 0 0", color: "var(--ve-dim)" }}>Settles in {Math.round(stats.settleMs)} ms · overshoot {(stats.overshoot * 100).toFixed(1)}%</p>
  </div>;
}
