import {
  TransformSchema,
  validateScene,
  type Transform,
  type TransformInput,
  type SceneIssue,
  CameraSchema,
  type CameraInput,
  type SceneDefinition,
  type SceneConstraint,
  type CameraDefinition,
  type FocusDefinition,
  type NodeDefinition,
} from "./scene";

/** SOURCE OF TRUTH: evaluateScene, transformToCss, cameraToCss, focusForSurface, sampleFocus, focusMask, uniformFocusBlur, resolveConstraints, projectWorld, screenRay, intersectPlane, surfaceQuad.
 * WHAT: camera-space transforms, scene constraints (lookAt, focusFollow) resolved from layout,
 * progressive spatial focus, and the one forward/inverse projection (frame pixels <-> 3D) for every consumer.
 * WHY: one mathematical definition keeps DOM preview and future output adapters consistent.
 * WHERE: React registration provides untransformed layout measurements; no DOM or transport is imported here.
 */
export type Matrix = readonly number[];
export type Measurement = {
  width: number;
  height: number;
  offsetX?: number;
  offsetY?: number;
};
export type Measurements = Readonly<Record<string, Measurement>>;
export type EvaluatedNode = {
  id: string;
  world: Matrix;
  worldPosition: { x: number; y: number; z: number };
  blur: number;
  focus: FocusField;
  width: number;
  height: number;
};
export type Evaluation = {
  nodes: EvaluatedNode[];
  focusDepth: number;
  issues: SceneIssue[];
  /** Camera and focus after constraints (equal to the input values without constraints). */
  camera?: CameraDefinition;
  focus?: FocusDefinition;
};
export type SpatialOptions = { channels?: Readonly<Record<string, number>>; anchors?: ReadonlyMap<string, readonly [number, number, number]> };
/** The stage camera matrix: scene positions minus camera, after stage rotation (cameraToCss convention). */
export function cameraMatrix(c: Pick<CameraDefinition, "x" | "y" | "z" | "rotateX" | "rotateY" | "rotateZ">): Matrix {
  return matrixFor(TransformSchema.parse({ x: -c.x, y: -c.y, z: -c.z, rotateX: c.rotateX, rotateY: c.rotateY, rotateZ: c.rotateZ }));
}
type Vec3 = [number, number, number];
/** Camera pose in CSS stage coordinates, including the perspective eye's positive Z offset. */
export function cameraWorld(camera: CameraDefinition): Matrix {
  return multiply(invertAffine(cameraMatrix(camera))!, matrixFor(TransformSchema.parse({ z: camera.perspective })));
}
const applyPoint = (m: Matrix, [x, y, z]: readonly number[]): Vec3 =>
  [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;
/** Pan/tilt about the camera's eye: rotateX/rotateY (degrees, nearest the authored ones, target in
 * front) that put stage point p at frame center, with camera x/y/z re-derived so the eye stays fixed.
 * In camera space the eye sits at (0, 0, perspective), so eye = R^T (c + (0, 0, P)) in stage space. */
function aimAt(camera: CameraDefinition, p: Vec3, weight: number): CameraDefinition {
  if (weight === 0) return camera;
  const rad = Math.PI / 180;
  const rotationOf = (rotateX: number, rotateY: number) => cameraMatrix({ x: 0, y: 0, z: 0, rotateX, rotateY, rotateZ: camera.rotateZ });
  const r0 = rotationOf(camera.rotateX, camera.rotateY);
  const shifted = [camera.x, camera.y, camera.z + camera.perspective];
  const eye: Vec3 = [0, 1, 2].map(col => r0[col] * shifted[0] + r0[4 + col] * shifted[1] + r0[8 + col] * shifted[2]) as Vec3;
  const d: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  if (Math.hypot(...d) < 1e-9) return camera;
  const g = camera.rotateZ * rad;
  const q: Vec3 = [Math.cos(g) * d[0] - Math.sin(g) * d[1], Math.sin(g) * d[0] + Math.cos(g) * d[1], d[2]];
  const candidates: { rotateX: number; rotateY: number; front: boolean; cost: number }[] = [];
  const phi = Math.atan2(q[2], q[0]);
  const betas = Math.hypot(q[0], q[2]) < 1e-12 ? [camera.rotateY * rad] : [phi + Math.PI / 2, phi - Math.PI / 2];
  for (const b of betas) {
    const vy = q[1], vz = -Math.sin(b) * q[0] + Math.cos(b) * q[2];
    const psi = Math.atan2(vz, vy);
    const alphas = Math.hypot(vy, vz) < 1e-12 ? [camera.rotateX * rad] : [-psi + Math.PI / 2, -psi - Math.PI / 2];
    for (const a of alphas) {
      const z = Math.sin(a) * vy + Math.cos(a) * vz;
      const rotateX = camera.rotateX + wrap(a / rad - camera.rotateX), rotateY = camera.rotateY + wrap(b / rad - camera.rotateY);
      candidates.push({ rotateX, rotateY, front: z < 0, cost: Math.abs(rotateX - camera.rotateX) + Math.abs(rotateY - camera.rotateY) });
    }
  }
  candidates.sort((a, b) => Number(b.front) - Number(a.front) || a.cost - b.cost);
  const rotateX = camera.rotateX + weight * (candidates[0].rotateX - camera.rotateX);
  const rotateY = camera.rotateY + weight * (candidates[0].rotateY - camera.rotateY);
  const r = rotationOf(rotateX, rotateY);
  const [x, y, z] = applyPoint(r, eye);
  return { ...camera, rotateX, rotateY, x, y, z: z - camera.perspective };
}
/** Resolve lookAt then focusFollow. `stagePoint` locates a target before the camera transform. */
export function resolveConstraints(constraints: readonly SceneConstraint[] | undefined, camera: CameraDefinition, focus: FocusDefinition,
  stagePoint: (target: SceneConstraint["target"]) => Vec3 | undefined, options: SpatialOptions = {}): { camera: CameraDefinition; focus: FocusDefinition } {
  if (!constraints?.length) return { camera, focus };
  const weightOf = (constraint: SceneConstraint) => {
    const w = constraint.weight;
    if (w === undefined) return 1;
    if (typeof w === "number") return w;
    const channel = options.channels && Object.hasOwn(options.channels, w.target.id) ? options.channels[w.target.id] : 1;
    return Math.max(0, Math.min(1, channel));
  };
  let resolvedCamera = camera, resolvedFocus = focus;
  for (const constraint of constraints) {
    if (constraint.kind !== "lookAt") continue;
    const point = stagePoint(constraint.target);
    if (!point) continue;
    resolvedCamera = aimAt(resolvedCamera, point, weightOf(constraint));
  }
  for (const constraint of constraints) {
    if (constraint.kind !== "focusFollow") continue;
    const point = stagePoint(constraint.target);
    if (!point) continue;
    const depth = resolvedCamera.perspective - applyPoint(cameraMatrix(resolvedCamera), point)[2] + (constraint.offset ?? 0);
    const distance = resolvedFocus.distance + weightOf(constraint) * (depth - resolvedFocus.distance);
    resolvedFocus = { ...resolvedFocus, distance: Math.max(resolvedFocus.focalLength + 1e-3, distance) };
  }
  return { camera: resolvedCamera, focus: resolvedFocus };
}
/** A node's local matrix: transform plus layout offset, with the optional pivot T(o)·M·T(-o). */
function localMatrix(node: NodeDefinition, size: Measurement | undefined, validOffset: boolean): Matrix {
  const offsetX = size?.offsetX ?? 0, offsetY = size?.offsetY ?? 0;
  const pivot = node.transform.originX !== undefined || node.transform.originY !== undefined;
  const ox = pivot ? (((node.transform.originX ?? 50) - 50) / 100) * (size?.width ?? 0) : 0;
  const oy = pivot ? (((node.transform.originY ?? 50) - 50) / 100) * (size?.height ?? 0) : 0;
  const placed = matrixFor({
    ...node.transform,
    x: node.transform.x + (validOffset ? offsetX : 0) + ox,
    y: node.transform.y + (validOffset ? offsetY : 0) + oy,
  });
  return pivot && Number.isFinite(ox) && Number.isFinite(oy) ? multiply(placed, [1, 0, 0, -ox, 0, 1, 0, -oy, 0, 0, 1, 0, 0, 0, 0, 1]) : placed;
}
export function multiply(a: Matrix, b: Matrix): Matrix {
  return Array.from({ length: 16 }, (_, index) => {
    const row = Math.floor(index / 4),
      col = index % 4;
    return [0, 1, 2, 3].reduce(
      (sum, k) => sum + a[row * 4 + k] * b[k * 4 + col],
      0,
    );
  });
}
export function matrixFor(t: Transform): Matrix {
  const rad = Math.PI / 180;
  const [sx, cx, sy, cy, sz, cz] = [
    Math.sin(t.rotateX * rad),
    Math.cos(t.rotateX * rad),
    Math.sin(t.rotateY * rad),
    Math.cos(t.rotateY * rad),
    Math.sin(t.rotateZ * rad),
    Math.cos(t.rotateZ * rad),
  ];
  const translate = [1, 0, 0, t.x, 0, 1, 0, t.y, 0, 0, 1, t.z, 0, 0, 0, 1];
  const rx = [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0, 0, 0, 0, 1];
  const ry = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, 0, 0, 0, 1];
  const rz = [cz, -sz, 0, 0, sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scale = [
    t.scale,
    0,
    0,
    0,
    0,
    t.scale,
    0,
    0,
    0,
    0,
    t.scale,
    0,
    0,
    0,
    0,
    1,
  ];
  const steps = [rx, ry, rz, scale];
  // Mirrors the CSS order exactly: ... scale() scale3d() skew(), appended only when present.
  if (hasAxisScale(t)) steps.push([t.scaleX ?? 1, 0, 0, 0, 0, t.scaleY ?? 1, 0, 0, 0, 0, t.scaleZ ?? 1, 0, 0, 0, 0, 1]);
  if (hasSkew(t)) steps.push([1, Math.tan((t.skewX ?? 0) * rad), 0, 0, Math.tan((t.skewY ?? 0) * rad), 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return steps.reduce(multiply, translate);
}
const hasAxisScale = (t: Transform) => t.scaleX !== undefined || t.scaleY !== undefined || t.scaleZ !== undefined;
const hasSkew = (t: Transform) => t.skewX !== undefined || t.skewY !== undefined;
/** CSS transform-origin for a transform: the default 50% 50% unless originX/originY is set. */
export function transformOriginCss(input: TransformInput = {}): string {
  const t = TransformSchema.parse(input);
  return `${t.originX ?? 50}% ${t.originY ?? 50}%`;
}
export function transformToCss(input: TransformInput = {}): string {
  const t = TransformSchema.parse(input);
  let css = `translate3d(${t.x}px, ${t.y}px, ${t.z}px) rotateX(${t.rotateX}deg) rotateY(${t.rotateY}deg) rotateZ(${t.rotateZ}deg) scale(${t.scale})`;
  if (hasAxisScale(t)) css += ` scale3d(${t.scaleX ?? 1}, ${t.scaleY ?? 1}, ${t.scaleZ ?? 1})`;
  if (hasSkew(t)) css += ` skew(${t.skewX ?? 0}deg, ${t.skewY ?? 0}deg)`;
  return css;
}
/** Frame geometry in output pixels (the stage origin sits at the frame center). */
export type Frame = { readonly width: number; readonly height: number };
export type ProjectedPoint = { x: number; y: number; depth: number };
/** "stage": scene coordinates (the camera matrix is applied); "view": camera space, the space of
 * `EvaluatedNode.world` matrices (eye at (0, 0, perspective), looking down -z). */
export type ProjectionSpace = "stage" | "view";
export type Ray = { origin: Vec3; direction: Vec3 };
type Lens = Pick<CameraDefinition, "x" | "y" | "z" | "rotateX" | "rotateY" | "rotateZ" | "perspective">;
/** The one forward projection: a 3D point to frame pixels plus camera-axis depth (perspective - z,
 * positive in front of the eye). Null when the point is at or behind the eye plane. */
export function projectWorld(camera: Lens, frame: Frame, point: readonly number[], space: ProjectionSpace = "stage"): ProjectedPoint | null {
  const [x, y, z] = space === "stage" ? applyPoint(cameraMatrix(camera), point) : [point[0], point[1], point[2]];
  if (z >= camera.perspective) return null;
  const k = camera.perspective / (camera.perspective - z);
  return { x: frame.width / 2 + x * k, y: frame.height / 2 + y * k, depth: camera.perspective - z };
}
/** Inverse of an affine 4x4 (rows; last row 0 0 0 1). Null when singular. */
export function invertAffine(m: Matrix): Matrix | null {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const r = [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
  const [tx, ty, tz] = [m[3], m[7], m[11]];
  return [
    r[0], r[1], r[2], -(r[0] * tx + r[1] * ty + r[2] * tz),
    r[3], r[4], r[5], -(r[3] * tx + r[4] * ty + r[5] * tz),
    r[6], r[7], r[8], -(r[6] * tx + r[7] * ty + r[8] * tz),
    0, 0, 0, 1,
  ];
}
/** The ray from the eye through a frame pixel. Direction is not normalized: t = 1 reaches the z = 0
 * view plane, so intersectPlane's `t` compares depths along one ray. */
export function screenRay(camera: Lens, frame: Frame, screen: { x: number; y: number }, space: ProjectionSpace = "view"): Ray {
  const origin: Vec3 = [0, 0, camera.perspective];
  const direction: Vec3 = [screen.x - frame.width / 2, screen.y - frame.height / 2, -camera.perspective];
  if (space === "view") return { origin, direction };
  const inverse = invertAffine(cameraMatrix(camera))!; // rigid: always invertible
  const o = applyPoint(inverse, origin);
  const tip = applyPoint(inverse, [origin[0] + direction[0], origin[1] + direction[1], origin[2] + direction[2]]);
  return { origin: o, direction: [tip[0] - o[0], tip[1] - o[1], tip[2] - o[2]] };
}
/** Where a ray meets the z = 0 plane of `world` (same space as the ray): local surface coordinates
 * (u, v) and the ray parameter t. Null when parallel or behind the origin. */
export function intersectPlane(ray: Ray, world: Matrix): { u: number; v: number; t: number } | null {
  // Solve u·A + v·B - t·D = O - P for the plane axes A, B, origin P and ray direction D (Cramer).
  const A = [world[0], world[4], world[8]], B = [world[1], world[5], world[9]], D = ray.direction;
  const R = [ray.origin[0] - world[3], ray.origin[1] - world[7], ray.origin[2] - world[11]];
  const det3 = (c0: number[], c1: number[], c2: number[]) =>
    c0[0] * (c1[1] * c2[2] - c2[1] * c1[2]) - c1[0] * (c0[1] * c2[2] - c2[1] * c0[2]) + c2[0] * (c0[1] * c1[2] - c1[1] * c0[2]);
  const negD = [-D[0], -D[1], -D[2]];
  const det = det3(A, B, negD);
  const scale = Math.hypot(...A) * Math.hypot(...B) * Math.hypot(...D);
  if (!Number.isFinite(det) || scale === 0 || Math.abs(det) < 1e-12 * scale) return null;
  const u = det3(R, B, negD) / det, v = det3(A, R, negD) / det, t = det3(A, B, R) / det;
  return t > 0 && Number.isFinite(u) && Number.isFinite(v) ? { u, v, t } : null;
}
/** Projected corners of an evaluated Surface (top-left, top-right, bottom-right, bottom-left; local
 * coordinates are centered on the Surface). Null corners sit behind the eye. */
export function surfaceQuad(node: Pick<EvaluatedNode, "world" | "width" | "height">, camera: Lens, frame: Frame): (ProjectedPoint | null)[] {
  const w = node.width / 2, h = node.height / 2;
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => projectWorld(camera, frame, applyPoint(node.world, [x, y, 0]), "view"));
}
export function evaluateScene(
  input: unknown,
  measurements: Measurements = {},
  options: SpatialOptions = {},
): Evaluation {
  const parsed = validateScene(input);
  if (!parsed.success)
    return { nodes: [], focusDepth: 0, issues: parsed.issues };
  const nodeMap = new Map(parsed.data.nodes.map((node) => [node.id, node]));
  // Constraints need stage-space geometry (before the camera), which does not depend on the camera.
  const stage = new Map<string, Matrix>();
  const stageWorld = (id: string): Matrix => {
    const cached = stage.get(id);
    if (cached) return cached;
    const node = nodeMap.get(id)!, size = measurements[id];
    const valid = Number.isFinite(size?.offsetX ?? 0) && Number.isFinite(size?.offsetY ?? 0);
    const local = localMatrix(node, size, valid);
    const world = node.parentId ? multiply(stageWorld(node.parentId), local) : local;
    stage.set(id, world);
    return world;
  };
  const resolved = resolveConstraints(parsed.data.constraints, parsed.data.camera, parsed.data.focus, target => {
    if ("point" in target) return [...target.point] as Vec3;
    if ("three" in target) {
      const point = options.anchors?.get(target.three);
      return point ? [...point] as Vec3 : undefined;
    }
    const size = measurements[target.surface], [u, v] = target.anchor ?? [0.5, 0.5];
    return applyPoint(stageWorld(target.surface), [(u - 0.5) * (size?.width ?? 0), (v - 0.5) * (size?.height ?? 0), 0]);
  }, options);
  const scene = resolved.camera === parsed.data.camera && resolved.focus === parsed.data.focus ? parsed.data : { ...parsed.data, camera: resolved.camera, focus: resolved.focus };
  const cache = new Map<string, Matrix>();
  const issues: SceneIssue[] = [];
  for (const [index, constraint] of (scene.constraints ?? []).entries()) {
    if ("three" in constraint.target && !options.anchors?.has(constraint.target.three))
      issues.push({ path: "constraints." + index, message: "3D anchor is unavailable: " + constraint.target.three });
  }
  const camera = cameraMatrix(scene.camera);
  const getWorld = (id: string): Matrix => {
    const cached = cache.get(id);
    if (cached) return cached;
    const node = nodeMap.get(id)!;
    const size = measurements[id];
    const offsetX = size?.offsetX ?? 0,
      offsetY = size?.offsetY ?? 0;
    const validOffset = Number.isFinite(offsetX) && Number.isFinite(offsetY);
    if (!validOffset)
      issues.push({
        path: id,
        message: "Invalid layout measurement for " + id,
      });
    const local = localMatrix(node, size, validOffset);
    const world = multiply(
      node.parentId ? getWorld(node.parentId) : camera,
      local,
    );
    cache.set(id, world);
    return world;
  };
  for (const node of scene.nodes) {
    if (!getWorld(node.id).every(Number.isFinite)) {
      return {
        nodes: [],
        focusDepth: 0,
        issues: [
          {
            path: node.id,
            message:
              "World transform exceeds numeric limits: reduce nested scale or position.",
          },
        ],
      };
    }
  }
  for (const node of scene.nodes) {
    const field = focusForSurface(getWorld(node.id), scene.focus, scene.camera.perspective);
    if (
      !Object.values(field).every(Number.isFinite) ||
      field.scale < 1e-8 ||
      !Number.isFinite(field.distance / field.scale)
    )
      return {
        nodes: [],
        focusDepth: 0,
        issues: [
          {
            path: node.id,
            message:
              "Focal geometry exceeds numeric limits: reduce scale, position or focus radius.",
          },
        ],
      };
  }
  const focusDepth = scene.camera.perspective - scene.focus.distance;
  const nodes = scene.nodes.map((node) => {
    const world = getWorld(node.id),
      z = world[11];
    const m = measurements[node.id];
    if (
      m &&
      (!Number.isFinite(m.width) ||
        !Number.isFinite(m.height) ||
        m.width <= 0 ||
        m.height <= 0)
    )
      issues.push({
        path: node.id,
        message: "Surface has no measurable area: " + node.id,
      });
    if (z >= scene.camera.perspective - 1)
      issues.push({
        path: node.id,
        message:
          "Surface reaches the camera plane: move " +
          node.id +
          " farther back.",
      });
    return {
      id: node.id,
      world,
      worldPosition: { x: world[3], y: world[7], z },
      focus: focusForSurface(world, scene.focus, scene.camera.perspective),
      blur: sampleFocus(focusForSurface(world, scene.focus, scene.camera.perspective), 0, 0),
      width: m?.width ?? 0,
      height: m?.height ?? 0,
    };
  });
  return { nodes, focusDepth, issues, camera: scene.camera, focus: scene.focus };
}

/** SOURCE OF TRUTH: FocusField, focusForSurface, sampleFocus, focusMask, uniformFocusBlur.
 * WHAT: camera-axis depth and thin-lens circle of confusion for each live plane.
 * WHY: equal depth has equal focus regardless of screen position or surface ID.
 * WHERE: React filters approximate an aperture kernel with Gaussian basis samples.
 * Camera projection sits at +perspective; distance/focalLength share scene units.
 * The Gaussian kernel is a realtime approximation, not Blender aperture ray tracing.
 */
export type FocusField = {
  depth:number; depthX:number; depthY:number; scale:number;
  distance:number; fStop:number; focalLength:number; maxBlur:number; perspective:number;
};
export function focusForSurface(m:Matrix, f:SceneDefinition["focus"], perspective=1400):FocusField {
  return {depth:perspective-m[11],depthX:-m[8],depthY:-m[9],scale:Math.hypot(m[0],m[4],m[8]),...f,perspective};
}
// Match the variance of a circular aperture: Gaussian sigma = CoC diameter / 4.
export function sampleFocus(f:FocusField,x:number,y:number):number {
  if(f.maxBlur===0) return 0;
  const depth=f.depth+f.depthX*x+f.depthY*y;
  if(depth<=0 || f.distance<=f.focalLength) return f.maxBlur;
  // Express the kernel on the local plane. CSS projection supplies perspective/depth;
  // applying that factor here again would double-amplify near-camera blur.
  const sigma=f.focalLength/(4*f.fStop*(f.distance-f.focalLength))*Math.abs(depth-f.distance);
  return Math.min(f.maxBlur,sigma);
}
function depthBounds(f:FocusField,width:number,height:number) {
  const pad=3*f.maxBlur/f.scale;
  const extent=Math.abs(f.depthX)*(width/2+pad)+Math.abs(f.depthY)*(height/2+pad);
  return {min:f.depth-extent,max:f.depth+extent,pad};
}
export function uniformFocusBlur(f:FocusField,width:number,height:number):number|undefined {
  if(f.maxBlur===0) return 0;
  const {min,max}=depthBounds(f,width,height);
  if(min===max) return sampleFocus(f,0,0)/f.scale;
  const at=(depth:number)=>sampleFocus({...f,depth,depthX:0,depthY:0},0,0);
  if((max<f.distance||min>f.distance)&&Math.min(at(min),at(max))===f.maxBlur) return f.maxBlur/f.scale;
  return undefined;
}
export const FOCUS_BANDS=6;
// Blend adjacent blur samples with normalized weights. A linear depth texture
// represents a tilted plane exactly; only the blur-kernel basis is approximate.
export function focusMask(f:FocusField,width:number,height:number,band:number) {
  const {min,max,pad}=depthBounds(f,width,height);
  const span=max-min;
  return {pad,xWeight:span===0?1:Math.abs(f.depthX)*(width+2*pad)/span,
    yWeight:span===0?0:Math.abs(f.depthY)*(height+2*pad)/span,
    reverseX:f.depthX<0,reverseY:f.depthY<0,
    stops:Array.from({length:129},(_,i)=>{
      const sigma=sampleFocus({...f,depth:min+span*i/128,depthX:0,depthY:0},0,0);
      const level=f.maxBlur===0?0:sigma/f.maxBlur*FOCUS_BANDS;
      return Math.max(0,1-Math.abs(level-band));
    })};
}
export function cameraToCss(input: CameraInput = {}): string {
  const c = CameraSchema.parse(input);
  return transformToCss({
    x: -c.x,
    y: -c.y,
    z: -c.z,
    rotateX: c.rotateX,
    rotateY: c.rotateY,
    rotateZ: c.rotateZ,
  });
}
