import { clipTiming, staggerOffsets, type MotionClipOutput, type TrackAddress } from "../../core";
import type { SceneSnapshot } from "../../react";
import type { Doc } from "../store";
import { addressOf, trackKey } from "../model";
import { motionSpeed } from "../properties";

/** The timeline row model (pure): derived from the draft recipe and the Scene snapshot, in Layers order.
 * Times are presentation milliseconds (authored / motion.speed); clip tracks are placed through their
 * clip's start and speed (trim, loop and group ease are shown as badges, not re-timed per key). */
export type KeyGlyph = "linear" | "ease" | "auto" | "hold" | "spring";
export type RowKey = { atMs: number; time: number; value: unknown; easing: unknown; glyph: KeyGlyph };
export type TimelineRow =
  | { kind: "layer"; id: string; label: string; summary: number[] }
  | { kind: "property"; id: string; label: string; layer: string; address: TrackAddress; keys: RowKey[]; smooth: boolean; static: boolean; toTime(authoredLocal: number): number; fromTime(time: number): number }
  | { kind: "clip"; id: string; label: string; clipId: string; start: number; end: number; speed: number; parentRate: number; loop?: number; ease?: string; mode: string; members?: { id: string; offset: number }[]; staggerHandle?: { offset: number; rate: number }; depth: number }
  | { kind: "badge"; id: string; label: string };
export function glyphOf(easing: unknown): KeyGlyph {
  if (easing === undefined || easing === "cinematic" || easing === "easeInOut") return "ease";
  if (easing === "linear") return "linear";
  if (easing === "auto") return "auto";
  if (easing === "hold") return "hold";
  if (typeof easing === "object" && easing && ("spring" in easing || "steps" in easing)) return "spring";
  return "ease";
}
type Clip = Doc & { id: string; startMs: number };
const describe = (address: TrackAddress) => address.target.kind === "style" || address.target.kind === "channel" ? `${address.property === "value" ? address.target.id : address.property}` : address.property;
export function buildRows(doc: Doc, snapshot: SceneSnapshot | undefined, options: { collapsed: readonly string[]; labels?: Record<string, string> }): TimelineRow[] {
  const motion = doc?.definition?.motion;
  if (!motion) return [];
  const speed = motionSpeed(doc);
  const rows: TimelineRow[] = [];
  const property = (track: Doc, layer: string, clip: { start: number; speed: number; id: string; inMs: number } | undefined): TimelineRow => {
    const address = addressOf(track, clip?.id);
    const toTime = (local: number) => (clip ? clip.start + (local - clip.inMs) / clip.speed : local) / speed;
    const fromTime = (time: number) => clip ? (time * speed - clip.start) * clip.speed + clip.inMs : time * speed;
    return {
      kind: "property", id: trackKey(address), label: describe(address), layer, address, smooth: track.interpolation === "smooth",
      static: track.keyframes.length === 1, toTime, fromTime,
      keys: (track.keyframes as Doc[]).map(frame => ({ atMs: frame.timeMs, time: toTime(frame.timeMs), value: frame.value, easing: frame.easing, glyph: glyphOf(frame.easing) })),
    };
  };
  const layerOf = (track: Doc): string => {
    const target = track.target as TrackAddress["target"];
    if (target.kind === "surface" || target.kind === "style") return target.id;
    if (target.kind === "channel") {
      const owner = snapshot?.animatables.find(entry => target.id.startsWith(entry.id + "."))?.owner;
      return owner ?? "channels";
    }
    return target.kind;
  };
  // Layer order: camera, focus, then Surfaces in registry order, recipe-only nodes, channels.
  const order = ["camera", "focus", ...(snapshot?.bindings ?? []).map(binding => binding.id), ...((doc.definition?.scene?.nodes ?? []) as { id: string }[]).map(node => node.id), "channels"];
  const root = (motion.tracks ?? []) as Doc[];
  const groups = new Map<string, Doc[]>();
  for (const track of root) { const layer = layerOf(track); groups.set(layer, [...(groups.get(layer) ?? []), track]); }
  const layers = [...new Set([...order.filter(id => groups.has(id)), ...groups.keys()])];
  for (const layer of layers) {
    const tracks = groups.get(layer)!;
    const children = tracks.map(track => property(track, layer, undefined) as Extract<TimelineRow, { kind: "property" }>);
    rows.push({ kind: "layer", id: `layer:${layer}`, label: options.labels?.[layer] ?? (layer === "camera" ? "Camera" : layer === "focus" ? "Focus" : layer === "channels" ? "Channels" : layer),
      summary: [...new Set(children.flatMap(row => row.keys.map(key => key.time)))].sort((a, b) => a - b) });
    if (!options.collapsed.includes(`layer:${layer}`)) rows.push(...children);
  }
  const visit = (clips: Clip[] | undefined, offset: number, parentSpeed: number, depth: number) => {
    for (const clip of clips ?? []) {
      const clipSpeed = (clip.speed ?? 1) * parentSpeed;
      const start = offset + clip.startMs / parentSpeed;
      const plays = clip.loop || 1;
      const parsed = clip as MotionClipOutput;
      const end = start + (clipTiming(parsed).span * plays) / clipSpeed;
      const offsets = clip.members && clip.stagger ? staggerOffsets(parsed) : undefined;
      const staggerRate = parsed.stagger && (parsed.members?.length ?? 0) > 1
        ? Math.max(...staggerOffsets({ members: parsed.members, stagger: { ...parsed.stagger, eachMs: 1 } })) / (clipSpeed * speed) : 0;
      rows.push({ kind: "clip", id: `clip:${clip.id}`, label: clip.label ?? clip.id, clipId: clip.id, start: start / speed, end: end / speed, speed: clip.speed ?? 1, parentRate: parentSpeed * speed, mode: clip.mode ?? "replace", depth,
        ...(staggerRate > 0 ? { staggerHandle: { offset: clip.stagger.eachMs * staggerRate, rate: staggerRate } } : {}),
        ...(clip.loop ? { loop: clip.loop } : {}), ...(clip.ease ? { ease: typeof clip.ease === "string" ? clip.ease : "custom" } : {}),
        ...(offsets ? { members: (clip.members as string[]).map((id, i) => ({ id, offset: offsets[i] / clipSpeed / speed })) } : {}) });
      if (!options.collapsed.includes(`clip:${clip.id}`))
        for (const track of (clip.tracks ?? []) as Doc[]) rows.push(property(track, `clip:${clip.id}`, { start, speed: clipSpeed, id: clip.id, inMs: clip.inMs ?? 0 }));
      visit(clip.clips as Clip[] | undefined, start - (clip.inMs ?? 0) / clipSpeed, clipSpeed, depth + 1);
    }
  };
  visit(motion.clips as Clip[] | undefined, 0, 1, 0);
  for (const link of (motion.links ?? []) as Doc[]) {
    const name = (ref: Doc) => "channel" in ref ? `channel ${ref.channel}` : `${ref.target.id ?? ref.target.kind}.${ref.property}`;
    rows.push({ kind: "badge", id: `link:${name(link.to)}`, label: `🔗 ${name(link.to)} ← ${name(link.from)}${link.scale !== undefined ? ` ×${link.scale}` : ""}${link.delayMs ? ` +${link.delayMs}ms` : ""}` });
  }
  for (const [index, constraint] of ((doc.definition?.scene?.constraints ?? []) as Doc[]).entries())
    rows.push({ kind: "badge", id: `constraint:${index}`, label: `⌖ ${constraint.kind} → ${constraint.target.surface ?? JSON.stringify(constraint.target.point)}` });
  return rows;
}
