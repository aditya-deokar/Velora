import { frameAt, timeAtFrame, type TrackAddress } from "../core";
import type { Doc } from "./store";

/** Pure queries over a raw recipe document shared by every editor panel (no React, no DOM). */
export type TrackEntry = { address: TrackAddress; track: Doc; clip?: string; key: string };
export const trackKey = (address: Pick<TrackAddress, "target" | "property" | "clip">) =>
  `${address.clip ?? ""}|${address.target.kind}|${"id" in address.target ? address.target.id : ""}|${address.property}`;
export const addressOf = (track: Doc, clip?: string): TrackAddress =>
  ({ target: track.target, property: track.property, ...(clip ? { clip } : {}) }) as TrackAddress;
/** Every track in the recipe: root tracks first, then clip tracks (nested clips in order). */
export function listTracks(doc: Doc): TrackEntry[] {
  const motion = doc?.definition?.motion;
  const entries: TrackEntry[] = (motion?.tracks ?? []).map((track: Doc) => ({ address: addressOf(track), track, key: trackKey(addressOf(track)) }));
  const visit = (clips: Doc[] | undefined) => {
    for (const clip of clips ?? []) {
      for (const track of clip.tracks ?? []) entries.push({ address: addressOf(track, clip.id), track, clip: clip.id, key: trackKey(addressOf(track, clip.id)) });
      visit(clip.clips);
    }
  };
  visit(motion?.clips);
  return entries;
}
export function findTrack(doc: Doc, address: Pick<TrackAddress, "target" | "property" | "clip">): Doc | undefined {
  const key = trackKey(address);
  return listTracks(doc).find(entry => entry.key === key)?.track;
}
export function listClips(doc: Doc): { clip: Doc; depth: number; parent?: string }[] {
  const out: { clip: Doc; depth: number; parent?: string }[] = [];
  const visit = (clips: Doc[] | undefined, depth: number, parent?: string) => {
    for (const clip of clips ?? []) { out.push({ clip, depth, ...(parent ? { parent } : {}) }); visit(clip.clips, depth + 1, clip.id); }
  };
  visit(doc?.definition?.motion?.clips, 0);
  return out;
}
/** Snap to the frame grid with the core frame math (times stay milliseconds). */
export function snapToFrame(timeMs: number, fps: number): number {
  return timeAtFrame(frameAt(Math.max(0, timeMs), fps), fps);
}
export const durationOf = (doc: Doc): number => doc?.definition?.motion?.durationMs ?? 0;
