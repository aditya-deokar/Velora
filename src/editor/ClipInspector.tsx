import { EASING_NAMES, behaviorById, type EditOp } from "../core";
import { useEditor } from "./context";
import type { Doc } from "./store";

export function ClipInspector({ clip, root }: { clip: Doc; root: boolean }) {
  const { store, controller, notify } = useEditor();
  const update = (fields: Omit<Extract<EditOp, { op: "clip.update" }>, "op" | "id">, label: string) => {
    const issues = store.commit([{ op: "clip.update", id: clip.id, ...fields }], label);
    if (issues.length) notify(issues[0].message);
    return !issues.length;
  };
  const source = clip.source;
  return <div className="ve-motion-fields">
    <label>Clip ease<select className="ve-input" value={typeof clip.ease === "string" ? clip.ease : clip.ease ? "custom" : ""} onChange={event => {
      update({ ease: (event.target.value || null) as (typeof EASING_NAMES)[number] | null }, "Change clip ease");
    }}>
      <option value="">None</option>{clip.ease && typeof clip.ease !== "string" && <option value="custom" disabled>Custom</option>}
      {EASING_NAMES.map(name => <option key={name}>{name}</option>)}
    </select></label>
    <ClipNumber key={`${clip.id}-speed`} label="Clip speed" value={clip.speed ?? 1} min={0.05} max={4} step="any" commit={speed => update({ speed }, "Retime clip")}/>
    <ClipNumber key={`${clip.id}-loop`} label="Play count" value={clip.loop || 1} min={1} max={10000} commit={value => update({ loop: value === 1 ? null : value }, "Change clip play count")}/>
    <label><input type="checkbox" checked={clip.mode === "add"} onChange={event => update({ mode: event.target.checked ? "add" : null }, "Change clip blend mode")}/> Layer this on top</label>
    {clip.stagger && <ClipNumber key={`${clip.id}-stagger`} label="Stagger delay (authored ms)" value={clip.stagger.eachMs} min={0} step="any" commit={eachMs => {
      const issues = store.commit([{ op: "stagger.set", clipId: clip.id, members: clip.members, ...clip.stagger, eachMs }], "Adjust stagger");
      if (issues.length) notify(issues[0].message);
      return !issues.length;
    }}/>}
    {source && <p>{source.behavior ? behaviorById(source.behavior)?.label ?? source.behavior : source.shot ?? source.preset}</p>}
    {root && source?.behavior && behaviorById(source.behavior) && <button className="ve-btn" onClick={() => controller.open("behaviors")}>Edit behavior parameters</button>}
    {root && <button className="ve-btn" onClick={() => controller.open("ungroup")}>Ungroup clip</button>}
  </div>;
}

function ClipNumber({ label, value, min, max, step = 1, commit }: { label: string; value: number; min: number; max?: number; step?: number | "any"; commit(value: number): boolean }) {
  return <label>{label}<input key={value} className="ve-input" type="number" defaultValue={value} min={min} max={max} step={step}
    onBlur={event => {
      const input = event.currentTarget, next = input.valueAsNumber;
      if (!Number.isFinite(next) || !input.checkValidity() || (next !== value && !commit(next))) input.value = String(value);
    }} onKeyDown={event => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { event.stopPropagation(); event.currentTarget.value = String(value); event.currentTarget.blur(); }
    }}/></label>;
}
