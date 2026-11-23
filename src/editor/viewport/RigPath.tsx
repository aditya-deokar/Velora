import { useMemo, useRef, type PointerEvent } from "react";
import { applyPoint, cameraWorld, projectWorld, rigClearance, rigLayersFromAnchors, rigPose, screenRay, targetPoseKey, type CameraDefinition, type ElementTarget, type Frame } from "../../core";
import { useEditor, useEditorState } from "../context";
import type { Doc } from "../store";
import { sampleTimes } from "./MotionPath";

type Point = [number, number, number];
export function RigPath({ camera, frame, scale }: { camera: CameraDefinition; frame: Frame; scale: number }) {
  const { store, snapshot, host, notify } = useEditor();
  const { draft } = useEditorState(store);
  const definition = (draft as Doc).definition;
  const clip = definition?.motion?.clips?.find((item: Doc) => item.source?.rig);
  const geometry = useMemo(() => rigLayersFromAnchors(snapshot?.targets ?? []), [snapshot?.targets]);
  const gesture = useRef<{ index: number; original: Point; x: number; y: number } | undefined>(undefined);
  const points = useMemo(() => sceneWaypoints(clip, geometry), [clip, geometry]);
  const path = useMemo(() => clip ? sampleTimes(0, host.session.durationMs, 24).map(time => {
    const pose = rigPose(definition, time, geometry).camera;
    return { pose, point: projectWorld(camera, frame, applyPoint(cameraWorld(pose), [0, 0, 0])) };
  }) : [], [clip, host.session.durationMs, definition, geometry, camera, frame]);
  if (!clip) return null;
  const clearance = rigClearance(definition, geometry.filter(layer => layer.tier), { poses: path.map(sample => sample.pose), margin: clip.source.params.margin });
  const end = (event: PointerEvent<SVGCircleElement>) => {
    const drag = gesture.current;
    gesture.current = undefined;
    event.stopPropagation();
    if (!drag || Math.hypot(drag.x - event.clientX, drag.y - event.clientY) < 3) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const ray = screenRay(camera, frame, { x: (event.clientX - box.left) * frame.width / box.width, y: (event.clientY - box.top) * frame.height / box.height }, "stage");
    if (Math.abs(ray.direction[2]) < 1e-7) return;
    const t = (drag.original[2] - ray.origin[2]) / ray.direction[2];
    if (t <= 0) return;
    const waypoints = [...clip.source.params.waypoints];
    waypoints[drag.index] = [ray.origin[0] + t * ray.direction[0], ray.origin[1] + t * ray.direction[1], drag.original[2]];
    const issues = store.commit([{ op: "rig.update", clipId: clip.id, params: { waypoints }, geometry }], "Move rig waypoint");
    if (issues.length) notify(issues[0].message);
  };
  const r = 6 / scale;
  return <g data-rig-path="">
    <polyline className="ve-path" points={path.flatMap(({ point }) => point ? [`${point.x},${point.y}`] : []).join(" ")}/>
    {path.flatMap(({ point, pose }, index) => point && index % 3 === 0 ? <g key={index} pointerEvents="none">
      <circle className="ve-tick" cx={point.x} cy={point.y} r={r / 4}/>
      <line data-rig-bank="" x1={point.x - r} y1={point.y} x2={point.x + r} y2={point.y}
        stroke="#ffd166" strokeWidth={1 / scale} transform={`rotate(${pose.rotateZ} ${point.x} ${point.y})`}/>
    </g> : [])}
    {points.flatMap(({ original, index }) => {
      const point = projectWorld(camera, frame, original);
      if (!point) return [];
      return <circle key={index} data-rig-waypoint={index} aria-label={`Drag waypoint ${index + 1}`} className="ve-handle"
        cx={point.x} cy={point.y} r={r} onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          gesture.current = { index, original, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={event => { if (gesture.current) event.stopPropagation(); }} onPointerUp={end}
        onPointerCancel={() => { gesture.current = undefined; }} onLostPointerCapture={() => { gesture.current = undefined; }}/>;
    })}
    {!clearance.pass && <text x={12 / scale} y={54 / scale} className="ve-badge" data-rig-clearance="">Clearance {clearance.minimum.toFixed(1)} px</text>}
  </g>;
}
function sceneWaypoints(clip: Doc | undefined, geometry: ReturnType<typeof rigLayersFromAnchors>) {
  if (clip?.source?.rig !== "drone-flyover") return [];
  const flight = clip.source.params.waypoints as (Point | ElementTarget)[];
  return flight.flatMap((waypoint, index) => {
    const original = Array.isArray(waypoint) ? waypoint : geometry.find(layer => targetPoseKey(layer.target) === targetPoseKey(waypoint))?.point;
    return original ? [{ original, index }] : [];
  });
}
