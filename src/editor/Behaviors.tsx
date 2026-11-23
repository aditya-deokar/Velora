import { useState } from "react";
import {
  BEHAVIOR_CATALOG, BEHAVIOR_INTENSITIES, animatableChannel, behaviorById, behaviorChannelProperty, buildBehavior, buildStaggeredBehavior, resolveBehaviorParams,
  type BehaviorIntensity, type BehaviorParams, type BehaviorSpec, type EditOp, type MotionClipInput,
} from "../core";
import type { SceneSnapshot } from "../react";
import { surfaceLayers } from "./commands";
import { useEditor, useEditorState } from "./context";
import { nextClipId } from "./group";
import { MotionPanel, NumericField, extendForClips, selectClip } from "./MotionDesign";
import { toAuthored } from "./properties";

export function compatibleBehaviorTargets(id: string, snapshot: SceneSnapshot | undefined, layers: readonly string[]) {
  const property = behaviorChannelProperty(id);
  if (!property) return [];
  return (snapshot?.animatables ?? []).flatMap(entry => {
    if (layers.length && !layers.includes(entry.owner ?? "")) return [];
    const reveal = property === "reveal.progress";
    if (reveal && !entry.id.endsWith(".reveal")) return [];
    const spec = entry.spec[reveal ? "progress" : property];
    return spec?.type === "number" ? [{ id: reveal ? entry.id.slice(0, -7) : entry.id, max: spec.max }] : [];
  });
}

export function Behaviors({ onClose, clip }: { onClose(): void; clip?: MotionClipInput }) {
  const { store, host, snapshot, notify } = useEditor();
  const state = useEditorState(store);
  const source = clip?.source && "behavior" in clip.source ? clip.source : undefined;
  const initialSpec = source ? behaviorById(source.behavior) : undefined;
  const initialIntensity = BEHAVIOR_INTENSITIES.find(value => value === source?.params?.intensity) ?? "subtle";
  const [id, setId] = useState(initialSpec?.id ?? BEHAVIOR_CATALOG[0].id);
  const [intensity, setIntensity] = useState<BehaviorIntensity>(initialIntensity);
  const [duration, setDuration] = useState<number | undefined>(() => {
    const ms = source?.params?.durationMs;
    return typeof ms === "number" && initialSpec && ms !== resolveBehaviorParams(initialSpec, { intensity: initialIntensity }).durationMs ? ms : undefined;
  });
  const [values, setValues] = useState<Record<string, number | string>>(() => {
    if (!initialSpec) return {};
    const defaults = resolveBehaviorParams(initialSpec, { intensity: initialIntensity });
    return Object.fromEntries(initialSpec.params.flatMap(({ name }) => {
      const value = source?.params?.[name];
      return (typeof value === "string" || typeof value === "number") && value !== defaults[name] ? [[name, value]] : [];
    }));
  });
  const [animatable, setAnimatable] = useState("");
  const spec = behaviorById(id)!;
  const selected = surfaceLayers(state);
  const track = clip?.tracks?.[0];
  const targetId = track && "id" in track.target ? track.target.id : undefined;
  const prop = behaviorChannelProperty(id);
  const targets = compatibleBehaviorTargets(id, snapshot, selected);
  const target = targets.find(entry => entry.id === animatable) ?? targets[0];
  const current = target?.id;
  const characterCount = !clip && id === "typewriter" ? target?.max : undefined;
  const defaults = resolveBehaviorParams(spec, { intensity, to: characterCount });
  const available = clip ? !!targetId || !!clip.members : spec.target === "surface" ? selected.length > 0 : !!current;
  const apply = () => {
    const doc = store.committed();
    const params: BehaviorParams = { to: characterCount, ...values, intensity, durationMs: duration, startMs: clip?.startMs ?? toAuthored(doc, host.session.timeMs) };
    try {
      const place = (key: string, target: { surface: string } | { animatable: string }) => buildBehavior(id, { ...params, id: key }, target);
      let generated: MotionClipInput[];
      if (clip?.members && clip.stagger) {
        const result = buildStaggeredBehavior(id, params, clip.members, clip.stagger, clip.id);
        generated = [{ ...clip, ...result, stagger: clip.stagger }];
      } else if (clip && targetId) {
        const animatableId = prop ? targets.find(entry => animatableChannel(entry.id, prop) === targetId)?.id
          ?? targetId.slice(0, targetId.endsWith(`.${prop}`) ? -(prop.length + 1) : -".reveal".length) : "";
        const result = place(clip.id, spec.target === "animatable" ? { animatable: animatableId } : { surface: targetId });
        generated = [{ ...result, label: clip.label ?? result.label, speed: clip.speed, durationMs: clip.durationMs, inMs: clip.inMs, loop: clip.loop, ease: clip.ease, mode: clip.mode ?? result.mode }];
      } else {
        const ids = spec.target === "surface" ? selected : current ? [current] : [];
        const used: MotionClipInput[] = [];
        for (const target of ids) {
          const key = `${id}-${target}`.replace(/[^\w-]+/g, "-").slice(0, 57);
          const withGenerated = { definition: { motion: { clips: [...(doc.definition.motion?.clips ?? []), ...used] } } };
          used.push(place(nextClipId(withGenerated, key), spec.target === "surface" ? { surface: target } : { animatable: target }));
        }
        generated = used;
      }
      if (!generated.length) return;
      const ops: EditOp[] = [...extendForClips(doc, generated), ...generated.map(result => ({ op: "clip.set", clip: result } as const))];
      const issues = store.commit(ops, `${clip ? "Update" : "Apply"} ${spec.label}`);
      if (issues.length) notify(issues[0].message);
      else { selectClip(store, generated[0].id); onClose(); }
    } catch (error) { notify((error as Error).message); }
  };
  return <MotionPanel title={clip ? "Edit behavior" : "Behaviors"} onClose={onClose}>
    <label>Behavior<select className="ve-input" value={id} disabled={!!clip} onChange={event => { setId(event.target.value); setDuration(undefined); setValues({}); }}>
      {["enter", "exit", "emphasis", "data"].map(kind => <optgroup key={kind} label={kind}>{BEHAVIOR_CATALOG.filter(entry => entry.kind === kind).map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</optgroup>)}
    </select></label>
    <p>{spec.description}</p>
    {!clip && spec.target === "surface" && <p>{selected.length ? `Layers: ${selected.join(", ")}` : "Select at least one layer."}</p>}
    {!clip && spec.target === "animatable" && <label>Animatable<select className="ve-input" value={current ?? ""} onChange={event => setAnimatable(event.target.value)}>
      {!targets.length && <option value="">No compatible animatables</option>}{targets.map(entry => <option key={entry.id}>{entry.id}</option>)}
    </select></label>}
    <label>Intensity<select className="ve-input" value={intensity} onChange={event => setIntensity(event.target.value as BehaviorIntensity)}>
      {BEHAVIOR_INTENSITIES.map(value => <option key={value}>{value}</option>)}
    </select></label>
    <NumericField label="Duration (ms)" value={duration ?? defaults.durationMs} min={50} max={60000} onChange={setDuration}/>
    {spec.params.map(param => <Parameter key={`${id}-${param.name}`} param={param} value={values[param.name] ?? defaults[param.name]}
      onChange={value => setValues(previous => { const next = { ...previous }; if (value === undefined) delete next[param.name]; else next[param.name] = value; return next; })}/>)}
    <button className="ve-btn" onClick={apply} disabled={!available || (duration !== undefined && (duration < 50 || duration > 60000))}>{clip ? "Update behavior" : "Apply behavior"}</button>
  </MotionPanel>;
}

function Parameter({ param, value, onChange }: { param: BehaviorSpec["params"][number]; value: number | string; onChange(value: number | string | undefined): void }) {
  const label = param.unit ? `${param.label} (${param.unit})` : param.label;
  if (param.type === "number") return <NumericField label={label} value={Number(value)} min={param.min} max={param.max} step="any" onChange={onChange}/>;
  return <label>{label}{param.type === "enum" ? <select className="ve-input" value={value} onChange={event => onChange(event.target.value)}>
    {param.options?.map(option => <option key={option}>{option}</option>)}
  </select> : <input className="ve-input" value={value} onChange={event => onChange(event.target.value)}/>}</label>;
}
