import { projectWorld, type CameraDefinition, type Matrix, type ProjectedPoint } from "../../core";
import type { ViewportTool } from "../store";
import type { Frame } from "./scene";

/** Gizmo drawing (Phase 06.3): handles for one selected layer in frame pixels. Geometry comes from the
 * layer's evaluated world matrix through projectWorld; this component only draws and tags handles. */
export type HandleId = "body" | "axis-x" | "axis-y" | "depth" | "rotateX" | "rotateY" | "rotateZ" | "corner-0" | "corner-1" | "corner-2" | "corner-3" | "side-x" | "side-y" | "pivot";
type Point = { x: number; y: number };
const apply = (m: Matrix, [x, y, z]: readonly number[]) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
export type GizmoGeometry = { center: ProjectedPoint; quad: Point[]; pivot: ProjectedPoint | null; axisX: ProjectedPoint | null; axisY: ProjectedPoint | null; radius: number };
export function gizmoGeometry(node: { world: Matrix; width: number; height: number }, parent: Matrix, origin: [number, number], camera: CameraDefinition, frame: Frame, quad: Point[]): GizmoGeometry | null {
  const centerView = [node.world[3], node.world[7], node.world[11]];
  const center = projectWorld(camera, frame, centerView, "view");
  if (!center) return null;
  // Axis handles: ~90 frame px along the parent's x and y axes at the layer's depth.
  const length = (90 * center.depth) / camera.perspective;
  const axis = (column: number) => {
    const v = [parent[column], parent[column + 4], parent[column + 8]];
    const norm = Math.hypot(...v) || 1;
    return projectWorld(camera, frame, centerView.map((value, index) => value + (v[index] / norm) * length), "view");
  };
  const xs = quad.map(p => p.x), ys = quad.map(p => p.y);
  const radius = Math.max(36, Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.45);
  return { center, quad, pivot: projectWorld(camera, frame, apply(node.world, [origin[0], origin[1], 0]), "view"), axisX: axis(0), axisY: axis(1), radius };
}
const HANDLE = 12;
export function GizmoHandles({ tool, geometry, scale }: { tool: ViewportTool; geometry: GizmoGeometry; scale: number }) {
  // Handles keep a constant on-screen size: the overlay is drawn in frame pixels inside a scaled frame.
  const s = 1 / Math.max(scale, 0.05), h = HANDLE * s, c = geometry.center;
  const square = (id: HandleId, p: Point, label: string) =>
    <rect key={id} data-handle={id} aria-label={label} x={p.x - h / 2} y={p.y - h / 2} width={h} height={h} className="ve-handle"/>;
  if (tool === "move") return <g data-gizmo="move">
    {geometry.axisX && <><line x1={c.x} y1={c.y} x2={geometry.axisX.x} y2={geometry.axisX.y} className="ve-axis" data-axis="x" strokeWidth={3 * s}/>{square("axis-x", geometry.axisX, "Move along X")}</>}
    {geometry.axisY && <><line x1={c.x} y1={c.y} x2={geometry.axisY.x} y2={geometry.axisY.y} className="ve-axis" data-axis="y" strokeWidth={3 * s}/>{square("axis-y", geometry.axisY, "Move along Y")}</>}
    <circle data-handle="depth" aria-label="Push along the camera ray (z)" cx={c.x} cy={c.y - 36 * s} r={h / 2} className="ve-handle ve-depth"/>
    <circle data-handle="body" aria-label="Move" cx={c.x} cy={c.y} r={h * 0.6} className="ve-handle"/>
  </g>;
  if (tool === "rotate") return <g data-gizmo="rotate">
    <circle data-handle="rotateZ" aria-label="Rotate Z" cx={c.x} cy={c.y} r={geometry.radius} className="ve-ring" strokeWidth={8 * s}/>
    <ellipse data-handle="rotateY" aria-label="Rotate Y" cx={c.x} cy={c.y} rx={geometry.radius * 0.35} ry={geometry.radius * 0.8} className="ve-ring ve-ring-y" strokeWidth={6 * s}/>
    <ellipse data-handle="rotateX" aria-label="Rotate X" cx={c.x} cy={c.y} rx={geometry.radius * 0.8} ry={geometry.radius * 0.35} className="ve-ring ve-ring-x" strokeWidth={6 * s}/>
  </g>;
  if (tool === "scale") {
    const [, b, , d] = geometry.quad;
    const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    return <g data-gizmo="scale">
      {geometry.quad.map((corner, index) => square(`corner-${index}` as HandleId, corner, `Scale from corner ${index + 1}`))}
      {square("side-x", mid(b, geometry.quad[2]), "Scale X")}
      {square("side-y", mid(geometry.quad[2], d), "Scale Y")}
      <circle data-handle="body" cx={c.x} cy={c.y} r={h * 0.4} className="ve-handle" aria-label="Scale center"/>
    </g>;
  }
  if (tool === "pivot" && geometry.pivot) return <g data-gizmo="pivot">
    <line x1={geometry.pivot.x - 2 * h} y1={geometry.pivot.y} x2={geometry.pivot.x + 2 * h} y2={geometry.pivot.y} className="ve-axis" strokeWidth={2 * s}/>
    <line x1={geometry.pivot.x} y1={geometry.pivot.y - 2 * h} x2={geometry.pivot.x} y2={geometry.pivot.y + 2 * h} className="ve-axis" strokeWidth={2 * s}/>
    <circle data-handle="pivot" aria-label="Pivot (anchor point)" cx={geometry.pivot.x} cy={geometry.pivot.y} r={h * 0.7} className="ve-handle"/>
  </g>;
  return null;
}
