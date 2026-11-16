import { applyEasing, type EasingInput, type EditOp } from "../core";
import { useEditor, useEditorState } from "./context";
import { findTrack } from "./model";

/** Easing library drawer (05.6): presets with curve thumbnails (sampled from applyEasing) and spacing dots
 * that show the motion feel. Applying sets the easing of every selected keyframe's outgoing segment. */
export type EasingPreset = { id: string; label: string; group: string; easing: EasingInput | "auto" };
export const EASING_PRESETS: readonly EasingPreset[] = Object.freeze([
  { id: "cinematic", label: "Velora cinematic", group: "Velora", easing: "cinematic" },
  { id: "ease-in-out", label: "Velora easeInOut", group: "Velora", easing: "easeInOut" },
  { id: "auto", label: "Auto bezier", group: "Velora", easing: "auto" },
  { id: "easy-ease", label: "Easy Ease", group: "After Effects", easing: { cubicBezier: [0.333, 0, 0.667, 1] } },
  { id: "easy-ease-in", label: "Ease In", group: "After Effects", easing: { cubicBezier: [0.333, 0, 1, 1] } },
  { id: "easy-ease-out", label: "Ease Out", group: "After Effects", easing: { cubicBezier: [0, 0, 0.667, 1] } },
  { id: "css-ease", label: "ease", group: "CSS", easing: { cubicBezier: [0.25, 0.1, 0.25, 1] } },
  { id: "css-ease-in", label: "ease-in", group: "CSS", easing: { cubicBezier: [0.42, 0, 1, 1] } },
  { id: "css-ease-out", label: "ease-out", group: "CSS", easing: { cubicBezier: [0, 0, 0.58, 1] } },
  { id: "css-ease-in-out", label: "ease-in-out", group: "CSS", easing: { cubicBezier: [0.42, 0, 0.58, 1] } },
  ...(["sine", "quad", "cubic", "quart", "expo", "circ", "back"] as const).flatMap(family => (["in", "out", "inOut"] as const).map(direction =>
    ({ id: `${family}.${direction}`, label: `${family}.${direction}`, group: "Penner", easing: `${family}.${direction}` as EasingInput }))),
  { id: "spring-gentle", label: "Spring gentle", group: "Springs", easing: { spring: { stiffness: 170, damping: 26, mass: 1 } } },
  { id: "spring-snappy", label: "Spring snappy", group: "Springs", easing: { spring: { stiffness: 300, damping: 30, mass: 1 } } },
  { id: "spring-bouncy", label: "Spring bouncy", group: "Springs", easing: { spring: { stiffness: 200, damping: 12, mass: 1 } } },
  { id: "spring-heavy", label: "Spring heavy", group: "Springs", easing: { spring: { stiffness: 120, damping: 30, mass: 3 } } },
  { id: "steps-4", label: "steps(4)", group: "Steps", easing: { steps: 4 } },
  { id: "hold", label: "Hold", group: "Steps", easing: "hold" },
  { id: "linear", label: "Linear", group: "Steps", easing: "linear" },
]);
function Thumb({ easing }: { easing: EasingPreset["easing"] }) {
  const sample = (p: number) => easing === "auto" ? p * p * (3 - 2 * p) : applyEasing(easing as never, p);
  const d = Array.from({ length: 41 }, (_, i) => `${i ? "L" : "M"}${(i / 40) * 56 + 2} ${46 - sample(i / 40) * 36}`).join("");
  return <svg width={60} height={64} aria-hidden="true"><rect x={2} y={10} width={56} height={36} fill="#0f0f12"/><path d={d} fill="none" stroke="#7cc4ff" strokeWidth={1.5}/>
    {[0, 0.25, 0.5, 0.75, 1].map(p => <circle key={p} cx={2 + Math.max(0, Math.min(1, sample(p))) * 56} cy={56} r={2.5} fill="#ffd166"/>)}</svg>;
}
export function EasingLibrary({ onClose }: { onClose(): void }) {
  const { store, notify } = useEditor();
  const state = useEditorState(store);
  const apply = (preset: EasingPreset) => {
    const doc = store.committed();
    const refs = state.selection.keys.filter(ref => { const track = findTrack(doc, ref.track); return track && track.keyframes[track.keyframes.length - 1].timeMs !== ref.atMs; });
    if (!refs.length) { notify("Select keyframes (not the last of a track) to apply an easing."); return; }
    const issues = store.commit(refs.map(ref => ({ op: "key.ease", track: ref.track, atMs: ref.atMs, easing: preset.easing } as EditOp)), `Ease: ${preset.label}`);
    if (issues.length) notify(issues[0].message);
  };
  const groups = [...new Set(EASING_PRESETS.map(preset => preset.group))];
  return <div className="ve-popover ve-panel" role="dialog" aria-label="Easing library" style={{ right: 16, bottom: 300, width: 520 }} data-velora-preview-chrome=""
    onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
    <div className="ve-h"><span>Easing library</span><span style={{ display: "flex", gap: 6 }}>
      <button className="ve-btn" disabled title="Saving custom curves arrives with presets (Phase 07)">Save curve</button>
      <button className="ve-btn" onClick={onClose}>Close</button></span></div>
    {groups.map(group => <section key={group} aria-label={group}>
      <h3 style={{ fontSize: 11, color: "var(--ve-dim)", margin: "8px 4px 4px" }}>{group}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 4 }}>
        {EASING_PRESETS.filter(preset => preset.group === group).map(preset => <button key={preset.id} className="ve-btn" style={{ flexDirection: "column" }} onClick={() => apply(preset)} aria-label={`Apply ${preset.label}`}>
          <Thumb easing={preset.easing}/><span style={{ fontSize: 10 }}>{preset.label}</span></button>)}
      </div>
    </section>)}
  </div>;
}
