import { useEffect, useState } from "react";
import { BEHAVIOR_CATALOG, EASING_NAMES, MEMBER_PLACEHOLDER, PresetSchema, STAGGER_ORDERS, buildStaggeredBehavior, type EditOp, type MotionClipInput } from "../core";
import { surfaceLayers } from "./commands";
import { useEditor, useEditorState } from "./context";
import { nextClipId } from "./group";
import { listTracks } from "./model";
import { MotionPanel, NumericField, extendForClips, selectClip } from "./MotionDesign";
import { toAuthored } from "./properties";

export function StaggerTool({ onClose }: { onClose(): void }) {
  const { store, host, client, hello, notify } = useEditor();
  const state = useEditorState(store);
  const [template, setTemplate] = useState("animation");
  const [eachMs, setEachMs] = useState<number | undefined>(80);
  const [order, setOrder] = useState<(typeof STAGGER_ORDERS)[number] | "random">("forward");
  const [seed, setSeed] = useState<number | undefined>(1);
  const [ease, setEase] = useState<(typeof EASING_NAMES)[number]>("linear");
  const [presets, setPresets] = useState<Awaited<ReturnType<NonNullable<typeof client>["listPresets"]>>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const layers = surfaceLayers(state);
  useEffect(() => {
    if (!client || !hello?.capabilities.includes("presets")) return;
    let active = true;
    client.listPresets().then(items => { if (active) setPresets(items); }).catch(problem => { if (active) setError((problem as Error).message); });
    return () => { active = false; };
  }, [client, hello]);
  const valid = eachMs !== undefined && eachMs >= 0 && (order !== "random" || (seed !== undefined && Number.isInteger(seed) && seed >= 0 && seed <= 4294967295));
  const apply = async () => {
    if (!valid || layers.length < 2) return;
    const doc = store.committed();
    const id = nextClipId(doc, "stagger");
    const stagger = { eachMs, order: order === "random" ? { random: seed! } : order, ...(ease === "linear" ? {} : { ease }) };
    const startMs = toAuthored(doc, host.session.timeMs);
    const ops: EditOp[] = [];
    let clip: MotionClipInput;
    setBusy(true);
    setError("");
    try {
      if (template.startsWith("behavior:")) clip = buildStaggeredBehavior(template.slice(9), { startMs }, layers, stagger, id);
      else if (template.startsWith("preset:") && client) {
        const preset = PresetSchema.parse((await client.readPreset(template.slice(7))).preset);
        if (store.committed() !== doc) throw new Error("The scene changed while loading the preset. Apply it again.");
        if (preset.kind === "behavior") clip = buildStaggeredBehavior(preset.body.behavior, { ...preset.body.params, startMs }, layers, stagger, id);
        else {
          if (preset.kind !== "motion" || preset.body.clips?.length || !preset.body.tracks.length || preset.body.tracks.some(track => !["surface", "style"].includes((track.target as { kind: string }).kind)))
            throw new Error("Choose a layer behavior or a motion preset saved from layer tracks.");
          const relative = preset.body.values === "relative";
          if (relative && preset.body.tracks.some(track => (track.keyframes as { value: unknown }[]).some(frame => typeof frame.value !== "number")))
            throw new Error("Staggering a relative preset requires numeric offsets. Save an absolute preset for color or position paths.");
          const tracks = preset.body.tracks.map(track => ({ ...track, target: { ...(track.target as object), id: MEMBER_PLACEHOLDER } })) as MotionClipInput["tracks"];
          clip = { id, startMs, label: preset.title.slice(0, 80), tracks, mode: relative ? "add" : preset.body.mode, ease: preset.body.ease };
        }
        clip = { ...clip, source: { preset: preset.id, version: 1 } };
      } else {
        const source = listTracks(doc).filter(({ address, clip }) => !clip && (address.target.kind === "surface" || address.target.kind === "style") && address.target.id === layers[0]);
        if (!source.length) throw new Error("The first selected layer needs root animation tracks. Choose a behavior or preset to start from a template.");
        const first = Math.min(...source.map(({ track }) => track.keyframes[0].timeMs as number));
        ops.push(...source.map(({ address }) => ({ op: "track.remove", track: address } as const)));
        const tracks = source.map(({ track }) => ({ ...track, target: { ...track.target, id: MEMBER_PLACEHOLDER }, keyframes: track.keyframes.map((frame: { timeMs: number }) => ({ ...frame, timeMs: frame.timeMs - first })) })) as MotionClipInput["tracks"];
        clip = { id, startMs: first, label: "Stagger", tracks };
      }
      ops.unshift(...extendForClips(doc, [{ ...clip, members: layers, stagger }]));
      ops.push({ op: "clip.set", clip }, { op: "stagger.set", clipId: id, members: layers, ...stagger });
      const issues = store.commit(ops, `Stagger ${layers.length} layers`);
      if (issues.length) setError(issues[0].message);
      else { selectClip(store, id); onClose(); }
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  };
  return <MotionPanel title="Stagger layers" onClose={onClose}>
    <p>{layers.length ? `Layers: ${layers.join(", ")}` : "Select two or more layers."}</p>
    <label>Template<select className="ve-input" value={template} onChange={event => setTemplate(event.target.value)}>
      <option value="animation">First layer’s animation</option>
      <optgroup label="Behaviors">{BEHAVIOR_CATALOG.filter(entry => entry.target === "surface").map(entry => <option key={entry.id} value={`behavior:${entry.id}`}>{entry.label}</option>)}</optgroup>
      <optgroup label="Project presets">{presets.filter(preset => !preset.issues?.length && (preset.kind === "motion" || preset.kind === "behavior")).map(preset => <option key={preset.id} value={`preset:${preset.id}`}>{preset.title ?? preset.id}</option>)}</optgroup>
    </select></label>
    <NumericField label="Delay per layer (authored ms)" value={eachMs} onChange={setEachMs} min={0}/>
    <label>Order<select className="ve-input" value={order} onChange={event => setOrder(event.target.value as typeof order)}>
      {[...STAGGER_ORDERS, "random"].map(value => <option key={value}>{value}</option>)}
    </select></label>
    {order === "random" && <NumericField label="Random seed" value={seed} onChange={setSeed} min={0} max={4294967295}/>}
    <label>Distribution ease<select className="ve-input" value={ease} onChange={event => setEase(event.target.value as typeof ease)}>
      {EASING_NAMES.map(value => <option key={value}>{value}</option>)}
    </select></label>
    {error && <p role="alert">{error}</p>}
    <button className="ve-btn" disabled={layers.length < 2 || !valid || busy} onClick={() => void apply()}>Create stagger</button>
  </MotionPanel>;
}
