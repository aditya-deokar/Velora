import { projectWorld, surfaceQuad, type CameraDefinition, type ProjectedPoint } from "../../core";
import type { SceneSnapshot } from "../../react";
import type { Frame } from "./scene";

/** Viewport picking (Phase 06.2): projected Surface quads from the Scene snapshot's world matrices and
 * measurements, ordered nearest first; point-in-quad hits, Alt-cycling, group scopes and marquee. Pure. */
export type Point = { x: number; y: number };
export type Pickable = { id: string; parentId?: string; quad: Point[]; depth: number };
/** Every mounted, measurable Surface that is not locked or hidden, nearest to the camera first. */
export function pickables(snapshot: SceneSnapshot | undefined, camera: CameraDefinition, frame: Frame, options: { locked?: readonly string[]; hidden?: readonly string[] } = {}): Pickable[] {
  if (!snapshot) return [];
  const skip = new Set([...(options.locked ?? []), ...(options.hidden ?? [])]);
  const parents = new Map(snapshot.bindings.map(binding => [binding.id, binding.parentId]));
  // A locked or hidden group locks its children too.
  const skipped = (id: string | undefined): boolean => !!id && (skip.has(id) || skipped(parents.get(id)));
  const out: Pickable[] = [];
  for (const node of snapshot.nodes) {
    if (skipped(node.id) || !(node.width > 0 && node.height > 0)) continue;
    const quad = surfaceQuad(node, camera, frame);
    if (quad.some(corner => corner === null)) continue;
    const center = projectWorld(camera, frame, [node.world[3], node.world[7], node.world[11]], "view");
    const parentId = parents.get(node.id);
    out.push({ id: node.id, ...(parentId ? { parentId } : {}), quad: (quad as ProjectedPoint[]).map(({ x, y }) => ({ x, y })), depth: center?.depth ?? Infinity });
  }
  // Stable: equal depths keep registration order reversed (later Surfaces paint on top).
  return out.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.depth - b.entry.depth || b.index - a.index).map(({ entry }) => entry);
}
/** Even-odd point-in-polygon (quads may be non-convex after strong perspective). */
export function pointInQuad(point: Point, quad: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const a = quad[i], b = quad[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** The ancestor of `id` that is a direct child of `scope` (undefined scope = root); undefined when `id`
 * is not inside the scope. */
export function atScope(id: string, scope: string | undefined, parents: ReadonlyMap<string, string | undefined>): string | undefined {
  let current: string | undefined = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = parents.get(current);
    if (parent === scope) return current;
    current = parent;
  }
  return undefined;
}
export const parentMap = (items: readonly Pickable[]) => new Map(items.map(item => [item.id, item.parentId]));
/** Selectable ids under the point at the current group scope, nearest first, without duplicates. */
export function hitStack(items: readonly Pickable[], point: Point, scope?: string): string[] {
  const parents = parentMap(items);
  const out: string[] = [];
  for (const item of items) {
    if (!pointInQuad(point, item.quad)) continue;
    const id = atScope(item.id, scope, parents);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
/** Click picking: the nearest hit, or with `cycle` (Alt+click) the next one below `current` in the stack. */
export function pick(items: readonly Pickable[], point: Point, options: { scope?: string; cycle?: boolean; current?: string } = {}): string | undefined {
  const stack = hitStack(items, point, options.scope);
  if (!stack.length) return undefined;
  if (!options.cycle || !options.current) return stack[0];
  const index = stack.indexOf(options.current);
  return stack[(index + 1) % stack.length];
}
/** Double-click: enter the group under the cursor and select its child there. */
export function enterGroup(items: readonly Pickable[], point: Point, group: string): { scope: string; selected?: string } {
  return { scope: group, selected: hitStack(items, point, group)[0] };
}
/** Esc: go up one level; the group becomes the selection. */
export function exitGroup(items: readonly Pickable[], scope: string): { scope?: string; selected: string } {
  return { scope: parentMap(items).get(scope), selected: scope };
}
/** Marquee: ids at the scope whose projected quad intersects the rectangle. */
export function marquee(items: readonly Pickable[], from: Point, to: Point, scope?: string): string[] {
  const [x0, x1] = [Math.min(from.x, to.x), Math.max(from.x, to.x)], [y0, y1] = [Math.min(from.y, to.y), Math.max(from.y, to.y)];
  const rect = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const parents = parentMap(items);
  const out: string[] = [];
  for (const item of items) {
    const xs = item.quad.map(p => p.x), ys = item.quad.map(p => p.y);
    const overlaps = Math.max(...xs) >= x0 && Math.min(...xs) <= x1 && Math.max(...ys) >= y0 && Math.min(...ys) <= y1
      && (item.quad.some(p => pointInQuad(p, rect)) || rect.some(p => pointInQuad(p, item.quad)) || edgesCross(item.quad, rect));
    const id = overlaps ? atScope(item.id, scope, parents) : undefined;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
function edgesCross(a: readonly Point[], b: readonly Point[]): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const [p1, p2, q1, q2] = [a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]];
    if (cross(p1, p2, q1) * cross(p1, p2, q2) < 0 && cross(q1, q2, p1) * cross(q1, q2, p2) < 0) return true;
  }
  return false;
}
/** Shift adds, Ctrl/⌘ toggles, a plain click replaces. */
export function combineSelection(current: readonly string[], ids: readonly string[], mode: "replace" | "add" | "toggle"): string[] {
  if (mode === "replace") return [...ids];
  if (mode === "add") return [...new Set([...current, ...ids])];
  const out = current.filter(id => !ids.includes(id));
  return [...out, ...ids.filter(id => !current.includes(id))];
}
