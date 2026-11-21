import { useState } from "react";
import { MotionTrackSchema, PresetSchema, applyPreset, presetFromClip, presetFromTracks, presetTargetKind, type EditOp, type EasingInput, type MotionClipInput, type Preset, type TrackAddress } from "../core";
import { surfaceLayers } from "./commands";
import { compatibleBehaviorTargets } from "./Behaviors";
import { useEditor, useEditorState } from "./context";
import { CurveThumbnail, EASING_PRESETS, easingSelectionOps } from "./EasingLibrary";
import { nextClipId } from "./group";
import { findTrack, listClips, listTracks, trackKey } from "./model";
import { MotionPanel, extendForClips, selectClip } from "./MotionDesign";
import { stateAt, toAuthored, valueAt } from "./properties";
import { useProjectPresets } from "./preset-library";

export function Presets({ onClose, saveEasing = false }: { onClose(): void; saveEasing?: boolean }) {
  const { store, host, snapshot, client, notify } = useEditor();
  const state = useEditorState(store);
  const { connected, entries, problem, reload } = useProjectPresets();
  const [saving, setSaving] = useState(saveEasing);
  const [kind, setKind] = useState<"motion" | "easing" | "behavior">(saveEasing ? "easing" : "motion");
  const [values, setValues] = useState<"relative" | "absolute">("relative");
  const [title, setTitle] = useState("");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const layers = surfaceLayers(state);
  const selectedClip = listClips(state.draft).find(({ clip }) => state.selection.clips.includes(clip.id))?.clip as MotionClipInput | undefined;
  const source = selectedClip?.source && "behavior" in selectedClip.source ? selectedClip.source : undefined;
  const ref = state.selection.keys[0];
  const selectedEase = ref ? findTrack(state.draft, ref.track)?.keyframes.find((frame: { timeMs: number }) => frame.timeMs === ref.atMs)?.easing : selectedClip?.ease;
  const useSelectedEase = selectedEase !== undefined && selectedEase !== "auto";
  const [curve, setCurve] = useState(useSelectedEase ? "selection" : "cubic.out");
  const commit = (ops: EditOp[], label: string, clips?: string[]) => {
    const issues = store.commit(ops, label);
    if (issues.length) { setError(issues[0].message); return; }
    if (clips?.[0]) selectClip(store, clips[0]);
    notify(label);
    onClose();
  };
  const apply = (preset: Preset) => {
    setError("");
    const doc = store.committed();
    if (preset.kind === "easing") return;
    const targetKind = presetTargetKind(preset);
    const animatables = preset.kind === "behavior" && layers.length ? compatibleBehaviorTargets(preset.body.behavior, snapshot, layers) : [];
    const targets = targetKind === "surface" ? layers.map(surface => ({ surface }))
      : targetKind === "camera" ? state.selection.layers.some(layer => layer === "camera" || layer === "focus") ? [{ camera: true as const }] : []
        : animatables.length === 1 ? [{ animatable: animatables[0].id }] : [];
    if (!targets.length) { setError(targetKind === "camera" ? "Select Camera or Focus." : targetKind === "animatable" ? "Select a layer with one compatible animatable." : "Select one or more layers."); return; }
    const atMs = toAuthored(doc, host.session.timeMs), motion = stateAt(doc, host.session.timeMs);
    const clips: MotionClipInput[] = [];
    for (const target of targets) {
      const name = "surface" in target ? target.surface : "animatable" in target ? target.animatable : "camera";
      const clipId = nextClipId(doc, `${preset.id.slice(0, 25)}-${name.replace(/[^\w-]+/g, "-")}`.slice(0, 50) + (targets.length > 1 ? `-${clips.length + 1}` : ""));
      const input = preset.kind === "behavior" && preset.body.behavior === "typewriter" && animatables[0]?.max !== undefined
        ? { ...preset, body: { ...preset.body, params: { to: animatables[0].max, ...preset.body.params } } } : preset;
      const applied = applyPreset(input, target, { atMs, clipId, base: track => {
        if (track.property === "position") return ["x", "y", "z"].map(property => Number(valueAt(doc, { ...track, property } as TrackAddress, motion, snapshot) ?? 0));
        const value = valueAt(doc, track as TrackAddress, motion, snapshot);
        return typeof value === "number" ? value : undefined;
      } });
      if (!applied.ok) { setError(applied.message); return; }
      clips.push(applied.clip);
    }
    commit([...extendForClips(doc, clips), ...clips.map(clip => ({ op: "clip.set", clip } as const))], `Apply ${preset.title}`, clips.map(clip => clip.id));
  };
  const save = async () => {
    if (!client || busy) return;
    setBusy(true); setError("");
    try {
      const doc = store.committed();
      const { selection } = store.getState();
      const refs = selection.keys.length ? selection.keys.map(ref => ref.track) : selection.tracks;
      const keys = new Set(refs.map(trackKey));
      const clip = !keys.size && selection.clips.length === 1 ? listClips(doc).find(entry => entry.clip.id === selection.clips[0])?.clip as MotionClipInput | undefined : undefined;
      const tracks = listTracks(doc).filter(({ key, clip, address }) => keys.size ? keys.has(key)
        : selection.clips.length ? !!clip && selection.clips.includes(clip)
          : !clip && selection.layers.includes("id" in address.target ? address.target.id : address.target.kind)).map(({ track, key }) => {
        const selected = selection.keys.filter(ref => trackKey(ref.track) === key);
        return selected.length ? { ...track, keyframes: track.keyframes.filter((frame: { timeMs: number }) => selected.some(ref => ref.atMs === frame.timeMs)) } : track;
      });
      const easing = (curve === "selection" ? selectedEase : EASING_PRESETS.find(entry => entry.id === curve)?.easing) as EasingInput;
      const meta = { id, title: title.trim(), values };
      const preset = kind === "easing" ? PresetSchema.parse({ version: 1, id, title: meta.title, kind, body: { curves: [{ name: meta.title.slice(0, 64), easing }] } })
        : kind === "behavior" ? PresetSchema.parse({ version: 1, id, title: meta.title, kind, body: { behavior: source?.behavior, params: source?.params } })
          : clip ? presetFromClip(clip, meta) : presetFromTracks(MotionTrackSchema.array().parse(tracks), meta);
      const reply = await client.writePreset(preset, null);
      if (reply.status === "conflict") throw new Error(`A preset named ${id} already exists. Use a new preset ID.`);
      if (reply.status === "invalid") throw new Error(reply.message);
      notify(`Saved ${title.trim()}`); reload(); setSaving(false);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <MotionPanel title="Project presets" onClose={onClose}>
    {!connected && <p>Connect a project edit bridge to browse or save presets.</p>}
    {(error || problem) && <p role="alert">{error || problem}</p>}
    {connected && !entries.length && <p>No project presets yet.</p>}
    {entries.map(preset => preset.kind === "easing" ? <section key={preset.id} aria-label={preset.title}>
      {preset.body.curves.map(({ name, easing }) => <button key={name} className="ve-btn ve-preset" onClick={() => {
        const ops = easingSelectionOps(store.committed(), state.selection, easing);
        if (ops.length) commit(ops, `Apply ${name}`); else setError("Select a clip or keyframes with outgoing segments.");
      }}><CurveThumbnail easing={easing}/>{name}</button>)}
    </section> : <button key={preset.id} className="ve-btn ve-preset" onClick={() => apply(preset)} aria-label={`Apply preset ${preset.title}`}>
      <CurveThumbnail easing={preset.kind === "motion" ? preset.body.ease ?? "linear" : "cinematic"}/><span>{preset.title}</span>
    </button>)}
    {connected && !state.readOnly && !saving && <button className="ve-btn" onClick={() => { setError(""); setSaving(true); }}>Save selection as preset</button>}
    {saving && <form className="ve-motion-fields" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>Preset type<select className="ve-input" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="motion">Motion</option><option value="easing">Easing</option>{source && <option value="behavior">Behavior</option>}</select></label>
      <label>Preset title<input className="ve-input" value={title} required maxLength={80} onChange={event => {
        const value = event.target.value;
        const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "");
        if (!id || id === slug(title)) setId(slug(value)); setTitle(value);
      }}/></label>
      <label>Preset ID<input className="ve-input" value={id} required maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={event => setId(event.target.value)}/></label>
      {kind === "motion" ? <label>Motion values<select className="ve-input" value={values} onChange={event => setValues(event.target.value as typeof values)}><option>relative</option><option>absolute</option></select></label>
        : kind === "easing" ? <label>Curve<select className="ve-input" value={curve} onChange={event => setCurve(event.target.value)}>
          {useSelectedEase && <option value="selection">Selected curve</option>}{EASING_PRESETS.filter(entry => entry.easing !== "auto").map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label> : null}
      <button className="ve-btn" type="submit" disabled={busy}>Save preset</button>
    </form>}
  </MotionPanel>;
}
