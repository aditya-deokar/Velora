import { useMemo, useState } from "react";
import { buildRig, describeElementTarget, rigLayersFromAnchors, rigSmoothness, RigRequestSchema, RIG_MASSES, type EditOp, type RigKind, type RigLayer } from "../core";
import { useEditor, useEditorState } from "./context";
import type { Doc } from "./store";

export function CameraRigFields({ kind }: { kind: RigKind }) {
  const { store, snapshot, host, notify } = useEditor();
  const state = useEditorState(store);
  const definition = (state.draft as Doc).definition;
  const existing = definition.motion?.clips?.find((clip: Doc) => clip.source?.rig === kind && clip.id === "camera-rig");
  const prior = existing?.source.params as Record<string, unknown> | undefined;
  const [params, setParams] = useState<Record<string, unknown>>(prior ?? {});
  const [waypoints, setWaypoints] = useState(() => prior?.waypoints ? JSON.stringify(prior.waypoints) : "");
  const update = (name: string, value: unknown) => setParams(current => ({ ...current, ...(name === "durationMs" ? { speed: undefined } : {}), [name]: value }));
  const geometry = useMemo(() => rigLayersFromAnchors(snapshot?.targets ?? []), [snapshot?.targets]);
  const candidate = useMemo(() => {
    try {
      const values = kind === "drone-flyover" && waypoints.trim() ? { ...params, waypoints: JSON.parse(waypoints) } : params;
      const request = RigRequestSchema.parse({ kind, params: values });
      const built = buildRig(request, { frame: host.frame, stage: definition.stage, layers: geometry, startMs: existing?.startMs });
      const smoothness = rigSmoothness(built.definition, request.params.mass);
      const op: EditOp = existing ? { op: "rig.update", clipId: existing.id, params: request.params, geometry }
        : { op: "rig.apply", kind, params: request.params, geometry };
      return { op, built, smoothness };
    } catch (error) { return { error: error instanceof SyntaxError ? "Enter a JSON array of waypoints." : error instanceof Error ? error.message : "Choose the rig targets." }; }
  }, [kind, params, waypoints, host.frame, definition.stage, geometry, existing]);
  const target = (field: string, label: string) => <label>{label}<select className="ve-input"
    value={params[field] ? describeElementTarget(params[field] as NonNullable<RigLayer["target"]>) : ""}
    onChange={event => update(field, geometry.find(row => row.id === event.target.value)?.target)}>
    <option value="">Choose an element</option>
    {[...new Set(geometry.filter(row => row.target).map(row => row.id))].map(id => <option key={id}>{id}</option>)}
  </select></label>;
  const number = (field: string, label: string, fallback: number, min: number, max: number, step = 1) =>
    <label>{label}<input className="ve-input" type="number" min={min} max={max} step={step} value={Number(params[field] ?? fallback)}
      onChange={event => update(field, event.target.value === "" ? undefined : Number(event.target.value))}/></label>;
  return <div className="ve-motion-fields">
    <label>Mass<select className="ve-input" value={typeof params.mass === "string" ? params.mass : kind === "telephoto-parallax-orbit" ? "heavy" : kind === "drone-flyover" ? "medium" : "light"}
      onChange={event => update("mass", event.target.value)}>{Object.keys(RIG_MASSES).map(name => <option key={name}>{name}</option>)}</select></label>
    {number("durationMs", "Duration (ms)", kind === "whip-pan-macro" ? 720 : kind === "drone-flyover" ? 5000 : 4000, 150, kind === "whip-pan-macro" ? 900 : 120000)}
    {kind === "drone-flyover" ? <>
      <label>Add waypoint<select className="ve-input" value="" onChange={event => {
        const anchor = geometry.find(layer => layer.id === event.target.value)?.target;
        if (!anchor) return;
        try { setWaypoints(JSON.stringify([...(waypoints ? JSON.parse(waypoints) : []), anchor])); }
        catch { notify("Correct the waypoint list before adding another element."); }
      }}><option value="">Choose an element</option>{[...new Set(geometry.filter(row => row.target).map(row => row.id))].map(id => <option key={id}>{id}</option>)}</select></label>
      <label>Waypoints<textarea className="ve-input" rows={3} value={waypoints} onChange={event => setWaypoints(event.target.value)}/></label>
      {number("altitude", "Altitude (px)", 180, 0, 20000)}
      <label><input type="checkbox" checked={!!params.through} onChange={event => update("through", event.target.checked)}/> Fly between depth tiers</label>
    </> : <>
      {kind === "telephoto-parallax-orbit" ? <>{target("target", "Orbit target")}{number("arcDeg", "Arc (degrees)", 24, 1, 140)}
        <label>Axis<select className="ve-input" value={typeof params.axis === "string" ? params.axis : "horizontal"} onChange={event => update("axis", event.target.value)}><option>horizontal</option><option>vertical</option></select></label>
      </> : <>{target("from", "Whip from")}{target("to", "Whip to")}
        <label>Settle<select className="ve-input" value={String(params.settle ?? "organic")} onChange={event => update("settle", event.target.value)}><option>organic</option><option>none</option></select></label>
        <label><input type="checkbox" checked={params.blur !== "off"} onChange={event => update("blur", event.target.checked ? "auto" : "off")}/> Velocity blur</label>
      </>}
      {number("fill", "Frame fill", kind === "whip-pan-macro" ? 0.6 : 0.55, 0.01, 1, 0.01)}
    </>}
    {candidate.error && <p role="status">{candidate.error}</p>}
    {candidate.built && <div role="status" data-testid="rig-verdict">
      <strong>{candidate.smoothness.pass && candidate.built.clearance?.pass !== false ? "Rig ready" : "Review the camera path"}</strong>
      <p>Peak jerk {candidate.smoothness.peakJerk.toFixed(0)} px/s³
        {candidate.built.clearance && Number.isFinite(candidate.built.clearance.minimum) ? ` · Clearance ${candidate.built.clearance.minimum.toFixed(1)} px` : ""}
        {candidate.built.parallax?.length ? ` · Peak parallax ${Math.max(...candidate.built.parallax.map(layer => layer.peakPx)).toFixed(1)} px` : ""}</p>
    </div>}
    <button className="ve-btn" disabled={!candidate.op || state.readOnly} onClick={() => {
      if (!candidate.op) return;
      const issues = store.commit([candidate.op], existing ? "Regenerate camera rig" : "Bake camera rig");
      if (issues.length) notify(issues[0].message);
    }}>{existing ? "Regenerate rig" : "Bake rig"}</button>
  </div>;
}
