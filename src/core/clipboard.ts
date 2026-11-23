import type { EditOp, TrackAddress } from "./edit";
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sameTarget = (a: { kind: string; id?: string }, b: { kind: string; id?: string }) => a.kind === b.kind && a.id === b.id;
function findTrack(doc: Doc, address: TrackAddress): Doc | undefined {
  const tracks: Doc[] = [...(doc?.definition?.motion?.tracks ?? [])];
  const visit = (clips: Doc[] | undefined) => { for (const clip of clips ?? []) { if (clip.id === address.clip) tracks.push(...(clip.tracks ?? [])); visit(clip.clips); } };
  if (address.clip) { tracks.length = 0; visit(doc?.definition?.motion?.clips); }
  return tracks.find(track => sameTarget(track.target ?? {}, address.target as never) && track.property === address.property);
}

/** Keyframe clipboard (versioned): keyframes relative to the earliest copied time, per property.
 * Pasting maps by property name; to another layer when a different layer is selected; incompatible
 * targets are refused. One paste is one key.set batch (one undo step). */
export const CLIPBOARD_TYPE = "application/x-velora-keyframes+json";
export type ClipboardKey = { offsetMs: number; value: unknown; easing?: unknown };
export type ClipboardPayload = { type: typeof CLIPBOARD_TYPE; version: 1; tracks: { target: TrackAddress["target"]; property: string; keyframes: ClipboardKey[] }[] };
export function copyKeyframes(doc: Doc, refs: readonly { track: TrackAddress; atMs: number }[]): ClipboardPayload | undefined {
  if (!refs.length) return undefined;
  const origin = Math.min(...refs.map(ref => ref.atMs));
  const tracks = new Map<string, ClipboardPayload["tracks"][number]>();
  for (const ref of refs) {
    const frame = findTrack(doc, ref.track)?.keyframes.find((entry: { timeMs: number }) => entry.timeMs === ref.atMs);
    if (!frame) continue;
    const key = JSON.stringify([ref.track.target, ref.track.property]);
    if (!tracks.has(key)) tracks.set(key, { target: ref.track.target, property: ref.track.property, keyframes: [] });
    tracks.get(key)!.keyframes.push({ offsetMs: ref.atMs - origin, value: frame.value, ...(frame.easing !== undefined ? { easing: frame.easing } : {}) });
  }
  for (const track of tracks.values()) track.keyframes.sort((a, b) => a.offsetMs - b.offsetMs);
  return tracks.size ? { type: CLIPBOARD_TYPE, version: 1, tracks: [...tracks.values()] } : undefined;
}
export function parseClipboard(text: string): ClipboardPayload | undefined {
  try {
    const value = JSON.parse(text) as ClipboardPayload;
    return value?.type === CLIPBOARD_TYPE && value.version === 1 && Array.isArray(value.tracks) ? value : undefined;
  } catch { return undefined; }
}
/** key.set ops pasting at atMs (authored); `onto` retargets every track to another layer (cross-layer paste). */
export function pasteOps(payload: ClipboardPayload, atMs: number, onto?: TrackAddress["target"]): { ok: true; ops: EditOp[] } | { ok: false; message: string } {
  const ops: EditOp[] = [];
  for (const track of payload.tracks) {
    const target = onto ?? track.target;
    if (target.kind !== track.target.kind) return { ok: false, message: `Cannot paste ${track.target.kind} ${track.property} keyframes onto ${target.kind}.` };
    for (const frame of track.keyframes) ops.push({ op: "key.set", track: { target, property: track.property }, atMs: atMs + frame.offsetMs, value: frame.value as never, ...(frame.easing !== undefined ? { easing: frame.easing as never } : {}) } as EditOp);
  }
  return ops.length ? { ok: true, ops } : { ok: false, message: "The clipboard has no keyframes." };
}
