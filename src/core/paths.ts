/** Spatial motion paths (pure math for core/motion position tracks).
 * A cubic Bézier per segment in space; omitted handles use Catmull–Rom-style automatic tangents.
 * Timing maps eased progress to distance along the segment through a fixed 64-sample arc-length
 * table, so evaluation is deterministic (no adaptive sampling). `rove` spreads distance evenly over
 * the whole path in time (constant speed). Handles are offsets: out from a keyframe, in into the next.
 */
export type Vector3 = readonly [number, number, number];
export type PathKey = { timeMs: number; value: Vector3; progress: (t: number) => number; inTangent?: Vector3; outTangent?: Vector3 };
export type PathSample = { point: [number, number, number]; tangent: [number, number, number] };
export const PATH_LUT_SAMPLES = 64;
type Segment = { c: [Vector3, Vector3, Vector3, Vector3]; lengths: number[]; length: number };

const add = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vector3, k: number): Vector3 => [a[0] * k, a[1] * k, a[2] * k];
function bezier(c: Segment["c"], s: number): [number, number, number] {
  const u = 1 - s, a = u * u * u, b = 3 * u * u * s, d = 3 * u * s * s, e = s * s * s;
  return [0, 1, 2].map(i => a * c[0][i] + b * c[1][i] + d * c[2][i] + e * c[3][i]) as [number, number, number];
}
function derivative(c: Segment["c"], s: number): [number, number, number] {
  const u = 1 - s;
  return [0, 1, 2].map(i => 3 * u * u * (c[1][i] - c[0][i]) + 6 * u * s * (c[2][i] - c[1][i]) + 3 * s * s * (c[3][i] - c[2][i])) as [number, number, number];
}
/** Automatic tangent at keyframe i (Catmull–Rom: half the chord between neighbors). */
export function autoTangent(points: readonly Vector3[], i: number): Vector3 {
  const n = points.length;
  if (n < 2) return [0, 0, 0];
  if (i === 0) return sub(points[1], points[0]);
  if (i === n - 1) return sub(points[n - 1], points[n - 2]);
  return scale(sub(points[i + 1], points[i - 1]), 0.5);
}
function segment(c: Segment["c"]): Segment {
  const lengths = [0];
  let previous = c[0];
  for (let k = 1; k <= PATH_LUT_SAMPLES; k++) {
    const point = bezier(c, k / PATH_LUT_SAMPLES);
    lengths.push(lengths[k - 1] + Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]));
    previous = point;
  }
  return { c, lengths, length: lengths[PATH_LUT_SAMPLES] };
}
/** Bézier parameter at a distance along the segment (linear inside the fixed LUT). */
function parameterAt(seg: Segment, distance: number): number {
  if (seg.length <= 0) return 0;
  const target = Math.min(seg.length, Math.max(0, distance));
  let low = 0, high = PATH_LUT_SAMPLES;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (seg.lengths[middle] < target) low = middle; else high = middle;
  }
  const span = seg.lengths[high] - seg.lengths[low];
  return (low + (span > 0 ? (target - seg.lengths[low]) / span : 0)) / PATH_LUT_SAMPLES;
}
export type CompiledPath = { sample: (timeMs: number) => PathSample; segmentSpeeds: number[]; length: number };
export function compilePath(keys: readonly PathKey[], rove = false, parametric = false): CompiledPath {
  const points = keys.map(key => key.value);
  const segments: Segment[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const out = keys[i].outTangent ?? scale(autoTangent(points, i), 1 / 3);
    const into = keys[i + 1].inTangent ?? scale(autoTangent(points, i + 1), -1 / 3);
    segments.push(segment([points[i], add(points[i], out), add(points[i + 1], into), points[i + 1]]));
  }
  const total = segments.reduce((sum, seg) => sum + seg.length, 0);
  const at = (index: number, s: number): PathSample => ({ point: bezier(segments[index].c, s), tangent: derivative(segments[index].c, s) });
  const first = keys[0], last = keys[keys.length - 1];
  const hold = (index: number, s: number): PathSample => segments.length ? at(index, s) : { point: [...first.value] as [number, number, number], tangent: [0, 0, 0] };
  const sample = (time: number): PathSample => {
    if (!segments.length || time <= first.timeMs) return hold(0, 0);
    if (time >= last.timeMs) return hold(segments.length - 1, 1);
    if (rove) {
      let distance = ((time - first.timeMs) / (last.timeMs - first.timeMs)) * total;
      for (let i = 0; i < segments.length; i++) {
        if (distance <= segments[i].length || i === segments.length - 1) return at(i, parameterAt(segments[i], distance));
        distance -= segments[i].length;
      }
    }
    let i = 0;
    while (i < segments.length - 1 && time > keys[i + 1].timeMs) i++;
    const start = keys[i], end = keys[i + 1];
    const progress = start.progress((time - start.timeMs) / (end.timeMs - start.timeMs));
    return at(i, parametric ? Math.max(0, Math.min(1, progress)) : parameterAt(segments[i], progress * segments[i].length));
  };
  const segmentSpeeds = segments.map((seg, i) => seg.length / Math.max(1e-9, keys[i + 1].timeMs - keys[i].timeMs));
  return { sample, segmentSpeeds, length: total };
}
/** Orient-to-path angles in degrees from a tangent: yaw = atan2(dx, dz), pitch = atan2(-dy, |dxz|). */
export function orientAngles(tangent: Vector3): { yaw: number; pitch: number } {
  const [dx, dy, dz] = tangent;
  return { yaw: (Math.atan2(dx, dz) * 180) / Math.PI, pitch: (Math.atan2(-dy, Math.hypot(dx, dz)) * 180) / Math.PI };
}
