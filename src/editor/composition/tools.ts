import type { Composition, CompositionScene, EditOp } from "../../core";
import type { SnapCandidate } from "../timeline/snap";

export const CUT_TOOLS = [["select", "V", "Select / move"], ["ripple", "B", "Ripple"], ["roll", "N", "Roll"], ["slip", "Y", "Slip"], ["razor", "C", "Razor"]] as const;
export type CutTool = typeof CUT_TOOLS[number][0];
export type CutSelection = { lane: "segment" | "overlay" | "audio"; id: string } | { lane: "marker"; index: number } | { lane: "captions" };
export const byStart = <T extends { startMs: number }>(clips: readonly T[]) => [...clips].sort((a, b) => a.startMs - b.startMs);
export const clipEnd = (clip: { startMs: number; durationMs: number }) => clip.startMs + clip.durationMs;

export function segmentGesture(tool: CutTool, clip: CompositionScene, edge: "in" | "out" | "body", ordered: CompositionScene[], deltaMs: number, pointerMs: number): EditOp[] {
  if (tool === "roll") {
    const index = ordered.indexOf(clip) + (edge === "out" ? 1 : 0);
    const left = ordered[index - 1], right = ordered[index];
    return left && right ? [{ op: "segment.roll", leftId: left.id, rightId: right.id, deltaMs }] : [];
  }
  if (tool === "slip") return [{ op: "segment.slip", id: clip.id, deltaMs }];
  if (edge !== "body" || tool === "ripple") return [{ op: "segment.trim", id: clip.id, edge: edge === "in" ? "in" : "out", deltaMs, mode: tool === "ripple" ? "ripple" : "plain" }];
  const other = ordered.find(entry => entry !== clip && pointerMs >= entry.startMs && pointerMs < clipEnd(entry));
  if (other) {
    const candidates = ordered.filter(entry => entry !== clip);
    const next = pointerMs < other.startMs + other.durationMs / 2 ? other : candidates[candidates.indexOf(other) + 1];
    return [{ op: "segment.reorder", id: clip.id, beforeId: next?.id ?? null }];
  }
  return [{ op: "segment.move", id: clip.id, atMs: clip.startMs + deltaMs }];
}

export function cutSnapCandidates(composition: Composition, cursor: number, excluded?: CutSelection): SnapCandidate[] {
  const candidates: SnapCandidate[] = [{ kind: "playhead", timeMs: cursor }];
  for (const [index, marker] of composition.markers.entries()) {
    if (excluded?.lane === "marker" && excluded.index === index) continue;
    candidates.push({ timeMs: marker.atMs, kind: marker.kind === "beat" || marker.kind === "downbeat" ? "beat" : "marker" });
  }
  for (const [lane, clips] of [["segment", composition.scenes], ["overlay", composition.overlays], ["audio", composition.audio]] as const) {
    for (const clip of clips) {
      if (excluded?.lane === lane && excluded.id === clip.id) continue;
      candidates.push({ kind: "clip", timeMs: clip.startMs });
      if (clip.durationMs) candidates.push({ kind: "clip", timeMs: clip.startMs + clip.durationMs });
    }
  }
  return candidates;
}

// Stack by authored compositing order. A higher overlay may share a lane only if
// it doesn't cross a lower overlay at any time it is visible.
export function overlayRows(overlays: Composition["overlays"]): Composition["overlays"][] {
  const rows: Composition["overlays"][] = [[], []];
  for (const overlay of overlays) {
    let index = 0;
    for (const [lane, entries] of rows.entries()) {
      if (entries.some(entry => entry.startMs < clipEnd(overlay) && overlay.startMs < clipEnd(entry))) index = lane + 1;
    }
    (rows[index] ??= []).push(overlay);
  }
  return rows;
}
