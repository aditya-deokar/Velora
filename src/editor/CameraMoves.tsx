import { useMemo, useState } from "react";
import { BEHAVIOR_INTENSITIES, MotionClipSchema, SHOT_KINDS, applyEdits, buildShotClip, clipTiming, framingReport, shotVerdict, type EditOp, type ShotKind, type ShotVerdict } from "../core";
import { surfaceLayers } from "./commands";
import { useEditor, useEditorState } from "./context";
import { nextClipId } from "./group";
import { listTracks } from "./model";
import { MotionPanel, NumericField } from "./MotionDesign";
import { motionSpeed, toAuthored, toPresentation } from "./properties";
import type { Doc } from "./store";
import { toStage } from "./viewport/CameraTool";
import { sceneAt } from "./viewport/scene";

export function CameraMoves({ onClose }: { onClose(): void }) {
  const { store, host, snapshot, notify } = useEditor();
  const state = useEditorState(store);
  const [kind, setKind] = useState<ShotKind>("push-in");
  const [intensity, setIntensity] = useState<(typeof BEHAVIOR_INTENSITIES)[number]>("subtle");
  const [lens, setLens] = useState<number>();
  const [durationMs, setDuration] = useState<number>();
  const [replace, setReplace] = useState(false);
  const [applied, setApplied] = useState<ShotVerdict>();
  const layers = surfaceLayers(state);
  const selected = layers.length === 1 ? layers[0] : undefined;
  const doc = state.draft as Doc;
  const frame = host.frame;
  const time = host.session.timeMs;
  const cameraTracks = useMemo(() => listTracks(doc).filter(({ address }) => address.target.kind === "camera" || address.target.kind === "focus"), [doc]);
  const candidate = useMemo(() => {
    if (applied) return;
    if (!selected || !snapshot || !(frame.width > 0 && frame.height > 0)) return { error: "Select one measured layer for the camera move." };
    if (cameraTracks.length && !replace) return { error: "Enable replacement to apply a move over existing camera or focus tracks." };
    try {
      const existing = sceneAt(doc, snapshot, time);
      const node = existing.nodes.find(entry => entry.id === selected);
      if (!node || !existing.camera || !(node.width > 0 && node.height > 0)) return { error: "The selected layer has no measured area." };
      const center = toStage(existing.camera, [node.world[3], node.world[7], node.world[11]]);
      const subject = { width: node.width, height: node.height };
      const startMs = toAuthored(doc, time);
      const shot = buildShotClip({ kind, intensity, lens, durationMs }, { subject: { ...subject, center }, frame, sceneSpeed: motionSpeed(doc), clipId: nextClipId(doc, `shot-${kind}`), startMs });
      const endMs = Math.max(clipTiming(MotionClipSchema.parse(shot.clip)).endMs, startMs + shot.definition.motion.durationMs / (shot.clip.speed ?? 1));
      const ops: EditOp[] = cameraTracks.map(({ address }) => ({ op: "track.remove", track: address }));
      if (endMs > (doc.definition.motion?.durationMs ?? 0)) ops.push({ op: "motion.set", durationMs: Math.ceil(endMs) });
      ops.push({ op: "clip.set", clip: shot.clip });
      const trial = applyEdits(doc, ops);
      if (!trial.ok) return { error: trial.issues[0].message };
      const draft = trial.recipe as Doc;
      const times = Array.from({ length: 24 }, (_, index) => toPresentation(draft, startMs + (endMs - startMs) * index / 23));
      const report = framingReport({ ...shot.definition, width: frame.width, height: frame.height }, subject, { times, poseAt: at => {
        const evaluated = sceneAt(draft, snapshot, at);
        const subjectNode = evaluated.nodes.find(entry => entry.id === selected);
        if (!subjectNode || !evaluated.camera || !evaluated.focus) throw new Error("The selected layer could not be evaluated across the move.");
        return { world: subjectNode.world, perspective: evaluated.camera.perspective, focus: evaluated.focus };
      } });
      return { ops, verdict: shotVerdict(report, { lens, intensity }), extendsScene: endMs > (doc.definition.motion?.durationMs ?? 0) };
    } catch (error) { return { error: (error as Error).message }; }
  }, [kind, lens, durationMs, intensity, selected, snapshot, frame, cameraTracks, doc, time, replace, applied]);
  const result = applied ?? candidate?.verdict;
  return <MotionPanel title="Camera moves" onClose={onClose}>
    <label>Move<select className="ve-input" value={kind} onChange={event => { setKind(event.target.value as ShotKind); setApplied(undefined); }}>
      {SHOT_KINDS.map(value => <option key={value}>{value}</option>)}
    </select></label>
    <label>Intensity<select className="ve-input" value={intensity} onChange={event => { setIntensity(event.target.value as typeof intensity); setApplied(undefined); }}>
      {BEHAVIOR_INTENSITIES.map(value => <option key={value}>{value}</option>)}
    </select></label>
    <NumericField label="Lens (mm, optional)" value={lens} onChange={value => { setLens(value); setApplied(undefined); }} min={16} max={200}/>
    <NumericField label="Duration (ms, optional)" value={durationMs} onChange={value => { setDuration(value); setApplied(undefined); }} min={500} max={120000}/>
    {!!cameraTracks.length && !applied && <label><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)}/> Replace existing camera and focus tracks</label>}
    {candidate?.error && <p role="alert">{candidate.error}</p>}
    {candidate?.extendsScene && <p>This move extends the scene duration.</p>}
    {result && <div role="status" data-testid="camera-verdict">
      <strong>{applied ? "Applied. " : ""}{result.ok ? "Framing certified" : "Framing needs adjustment"}</strong>
      <p>In frame {(result.inFrame * 100).toFixed(0)}% · Depth margin {(result.depthMargin * 100).toFixed(0)}% · Focus blur {result.focusBlur.toFixed(2)} px</p>
      {!result.ok && <><strong>Adjust</strong><ul>{result.suggestions.map(suggestion => <li key={suggestion}>{suggestion}</li>)}</ul></>}
    </div>}
    <button className="ve-btn" disabled={!candidate?.ops} onClick={() => {
      if (!candidate?.ops || !candidate.verdict) return;
      const issues = store.commit(candidate.ops, `Apply ${kind} camera move`);
      if (issues.length) notify(issues[0].message); else setApplied(candidate.verdict);
    }}>{result && !result.ok ? "Apply camera move anyway" : "Apply camera move"}</button>
  </MotionPanel>;
}
