import type { EditOp, TrackAddress } from "../core";
import type { Doc } from "./store";
import { findTrack, snapToFrame, trackKey } from "./model";

/** SOURCE OF TRUTH: intentToOps.
 * WHAT: the editor's change semantics (EDITOR-UX §4) turned into EditOps: a value change on an animated
 * property keys it at the playhead; with Auto-key the first change creates the track; without it a change
 * writes a static override (camera and focus statics write scene.camera / scene.focus); the stopwatch arms
 * a property (on) or freezes it to its current value (off); Alt+K toggles a keyframe; reset removes a track.
 * WHY: the inspector, viewport gizmos and the command palette must make identical edits; implementing the
 * rules once keeps every widget an author of the same recipe.
 * WHERE: Inspector.tsx, commands.ts and (06) gizmos call it; the store commits the returned batch.
 */
export type IntentContext = { timeMs: number; fps: number; autoKey: boolean; armed: readonly string[] };
export type PropertyIntent =
  | { kind: "set"; track: TrackAddress; value: number | string }
  | { kind: "stopwatch"; track: TrackAddress; on: boolean; value: number | string }
  | { kind: "toggle-key"; track: TrackAddress; value: number | string }
  | { kind: "reset"; track: TrackAddress };
/** A track is animated when it has two or more keyframes, or its stopwatch was switched on. */
export function isAnimated(doc: Doc, track: Pick<TrackAddress, "target" | "property" | "clip">, armed: readonly string[]): boolean {
  const found = findTrack(doc, track);
  return !!found && (found.keyframes.length > 1 || armed.includes(trackKey(track)));
}
const baseField = (track: TrackAddress) => track.target.kind === "camera" ? "camera" : track.target.kind === "focus" ? "focus" : undefined;
export function intentToOps(intent: PropertyIntent, doc: Doc, context: IntentContext): EditOp[] {
  const at = snapToFrame(context.timeMs, context.fps);
  const existing = findTrack(doc, intent.track);
  const animated = isAnimated(doc, intent.track, context.armed);
  switch (intent.kind) {
    case "set": {
      if (animated || (context.autoKey && existing))
        return [{ op: "key.set", track: intent.track, atMs: at, value: intent.value }];
      if (context.autoKey) return [{ op: "track.add", track: intent.track, keyframes: [{ timeMs: at, value: intent.value }] }];
      // Static override: camera/focus statics go to the scene base; others become a one-keyframe track.
      const field = baseField(intent.track);
      if (field && !existing && typeof intent.value === "number")
        return [{ op: field === "camera" ? "camera.set" : "focus.set", property: intent.track.property, value: intent.value } as EditOp];
      if (existing) return [{ op: "key.set", track: intent.track, atMs: existing.keyframes[0].timeMs, value: intent.value }];
      return [{ op: "track.add", track: intent.track, keyframes: [{ timeMs: 0, value: intent.value }] }];
    }
    case "stopwatch": {
      if (intent.on) {
        if (existing) return []; // a static override becomes animated by arming it (UI state, no write)
        return [{ op: "track.add", track: intent.track, keyframes: [{ timeMs: at, value: intent.value }] }];
      }
      if (!existing) return [];
      // Off keeps the current value as a static (AE semantics); camera/focus write their scene base.
      const field = baseField(intent.track);
      if (field && typeof intent.value === "number")
        return [{ op: "track.remove", track: intent.track }, { op: field === "camera" ? "camera.set" : "focus.set", property: intent.track.property, value: intent.value } as EditOp];
      return [{ op: "track.remove", track: intent.track }, { op: "track.add", track: intent.track, keyframes: [{ timeMs: 0, value: intent.value }] }];
    }
    case "toggle-key": {
      if (!existing) return [{ op: "track.add", track: intent.track, keyframes: [{ timeMs: at, value: intent.value }] }];
      const frame = existing.keyframes.find((entry: { timeMs: number }) => entry.timeMs === at);
      if (!frame) return [{ op: "key.set", track: intent.track, atMs: at, value: intent.value }];
      return existing.keyframes.length > 1 ? [{ op: "key.remove", track: intent.track, atMs: at }] : [{ op: "track.remove", track: intent.track }];
    }
    case "reset": return existing ? [{ op: "track.remove", track: intent.track }] : [];
  }
}
