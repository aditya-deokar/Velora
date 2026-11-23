import { applyEdits, evaluateMotion, exactDissolveTracks, type EditOp } from "../core";
import type { Doc, Selection } from "./store";
import { listClips, listTracks, trackKey } from "./model";
import { motionSpeed } from "./properties";

/** Group and ungroup (Phase 07.1), pure: grouping a selection into a clip at its earliest key, the
 * exactness test for dissolving a clip, and the deviation a bake would introduce (shown before baking). */
export function findRootClip(doc: Doc, id: string): Doc | undefined {
  return (doc?.definition?.motion?.clips ?? []).find((clip: Doc) => clip.id === id);
}
export function dissolveIsExact(clip: Doc): boolean {
  return exactDissolveTracks(clip) !== undefined;
}
export function nextClipId(doc: Doc, prefix: string, numbered = false): string {
  const used = new Set(listClips(doc).map(({ clip }) => clip.id));
  if (!numbered && !used.has(prefix)) return prefix;
  let suffix = numbered ? 1 : 2;
  while (used.has(`${prefix.slice(0, 63 - String(suffix).length)}-${suffix}`)) suffix++;
  return `${prefix.slice(0, 63 - String(suffix).length)}-${suffix}`;
}
/** Group full root tracks identified by the selected keys, tracks or layers. Each property keeps one owner. */
export function groupOps(doc: Doc, selection: Selection): { ops: EditOp[]; id: string } | undefined {
  const roots = listTracks(doc).filter(entry => !entry.clip);
  const explicit = new Set((selection.keys.length ? selection.keys.map(ref => ref.track) : selection.tracks).map(trackKey));
  const selected = roots.filter(({ address, key }) => explicit.size ? explicit.has(key) : selection.layers.includes("id" in address.target ? address.target.id : address.target.kind));
  if (!selected.length) return;
  const startMs = Math.min(...selected.map(({ track }) => track.keyframes[0].timeMs as number));
  const id = nextClipId(doc, "group", true);
  return { ops: [{ op: "clip.create", id, refs: selected.map(entry => entry.address), startMs, label: "Group" }], id };
}
export type BakePreview = { ok: true; exact: boolean; maxDeviation: number; property?: string; atMs?: number } | { ok: false; message: string };
/** Max absolute difference between the clip's motion and its bake (sampled at the bake rate and at
 * midpoints across the whole scene), per numeric property. Exact dissolves report 0. */
export function bakeDeviation(doc: Doc, clipId: string, samplesPerSecond = 30): BakePreview {
  const clip = findRootClip(doc, clipId);
  if (!clip) return { ok: false, message: `No root clip "${clipId}".` };
  const exact = dissolveIsExact(clip);
  const result = applyEdits(doc, [{ op: "clip.dissolve", id: clipId, ...(exact ? {} : { bake: { samplesPerSecond } }) }], { validation: "motion" });
  if (!result.ok) return { ok: false, message: result.issues[0]?.message ?? "The clip cannot be baked." };
  if (exact) return { ok: true, exact, maxDeviation: 0 };
  const before = doc.definition.motion, after = (result.recipe as Doc).definition.motion;
  const speed = motionSpeed(doc);
  const end = before.durationMs / speed, step = 1000 / samplesPerSecond / 2;
  let max = 0, property: string | undefined, atMs: number | undefined;
  for (let i = 0; i <= Math.ceil(end / step); i++) {
    const t = Math.min(end, i * step);
    const a = evaluateMotion(before, t), b = evaluateMotion(after, t);
    const compare = (kind: string, left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined) => {
      for (const [key, value] of Object.entries(left ?? {})) {
        const other = right?.[key];
        if (typeof value !== "number" || typeof other !== "number") continue;
        const deviation = Math.abs(value - other);
        if (deviation > max) { max = deviation; property = `${kind}.${key}`; atMs = t * speed; }
      }
    };
    compare("camera", a.camera, b.camera);
    compare("focus", a.focus, b.focus);
    for (const [id, values] of Object.entries(a.surfaces)) compare(id, values as Record<string, unknown>, b.surfaces[id] as Record<string, unknown> | undefined);
    compare("channel", a.channels, b.channels);
  }
  return { ok: true, exact, maxDeviation: Math.round(max * 1000) / 1000, ...(property ? { property } : {}), ...(atMs !== undefined ? { atMs: Math.round(atMs) } : {}) };
}
