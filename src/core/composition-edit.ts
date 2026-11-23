import { z } from "zod";
import { AudioTrackSchema } from "./audio";
import { CompositionCaptionsSchema, CompositionMarkerSchema, CompositionOverlaySchema, CompositionSchema, type Composition } from "./composition";
import type { EditIssue, EditOp } from "./edit";
import { sameJsonValue } from "./json";
import { SceneRecipeIdSchema } from "./recipes";
import { snapToBeats } from "./rhythm";
import { timelineDuration, timelineFromComposition, validateTimeline } from "./timeline";
import { SegmentTransitionSchema, isOverlapTransition } from "./transitions";

const id = z.string().min(1).max(128);
const deltaMs = z.number().finite();
const time = deltaMs.nonnegative().max(240_000);
const edge = z.enum(["in", "out"]);
const fields = ["scenes", "overlays", "audio", "markers", "captions", "look"] as const;
const look = z.strictObject({ op: z.literal("look.set"), look: z.record(z.string(), z.unknown()).nullable() });
export const compositionEditVariants = [
  z.strictObject({ op: z.literal("segment.add"), id: id.optional(), recipe: SceneRecipeIdSchema, atMs: time, durationMs: time.positive(), inMs: time.optional() }),
  z.strictObject({ op: z.literal("segment.move"), id, atMs: time }),
  z.strictObject({ op: z.literal("segment.reorder"), id, beforeId: id.nullable() }),
  z.strictObject({ op: z.literal("segment.trim"), id, edge, deltaMs, mode: z.enum(["plain", "ripple"]) }),
  z.strictObject({ op: z.literal("segment.roll"), leftId: id, rightId: id, deltaMs }),
  z.strictObject({ op: z.literal("segment.slip"), id, deltaMs }),
  z.strictObject({ op: z.literal("segment.split"), id, atMs: time, newId: id.optional() }),
  z.strictObject({ op: z.literal("segment.remove"), id, ripple: z.boolean().optional() }),
  SegmentTransitionSchema.safeExtend({ op: z.literal("transition.set"), segmentId: id }),
  z.strictObject({ op: z.literal("transition.remove"), segmentId: id }),
  z.strictObject({ op: z.literal("overlay.add"), ...CompositionOverlaySchema.omit({ id: true, startMs: true }).partial({ opacity: true, blend: true }).shape, id: id.optional(), atMs: time }),
  z.strictObject({ op: z.literal("overlay.move"), id, atMs: time }),
  z.strictObject({ op: z.literal("overlay.trim"), id, edge, deltaMs }),
  z.strictObject({ op: z.literal("overlay.remove"), id }),
  z.strictObject({ op: z.literal("overlay.set"), id, opacity: CompositionOverlaySchema.shape.opacity.removeDefault().optional(), blend: CompositionOverlaySchema.shape.blend.removeDefault().optional() }),
  z.strictObject({ ...AudioTrackSchema.shape, op: z.literal("audio.add"), offsetMs: AudioTrackSchema.shape.offsetMs.removeDefault().optional(),
    gain: AudioTrackSchema.shape.gain.removeDefault().optional(), fadeInMs: AudioTrackSchema.shape.fadeInMs.removeDefault().optional(), fadeOutMs: AudioTrackSchema.shape.fadeOutMs.removeDefault().optional() }),
  z.strictObject({ op: z.literal("audio.move"), id, atMs: time }),
  z.strictObject({ op: z.literal("audio.trim"), id, edge, deltaMs, endMs: time.optional() }),
  z.strictObject({ op: z.literal("audio.remove"), id }),
  z.strictObject({ op: z.literal("audio.set"), id, gain: AudioTrackSchema.shape.gain.removeDefault().optional(),
    fadeInMs: AudioTrackSchema.shape.fadeInMs.removeDefault().optional(), fadeOutMs: AudioTrackSchema.shape.fadeOutMs.removeDefault().optional(), offsetMs: AudioTrackSchema.shape.offsetMs.removeDefault().optional() }),
  z.strictObject({ op: z.literal("marker.add"), atMs: time, label: CompositionMarkerSchema.shape.label.removeDefault().optional(), kind: CompositionMarkerSchema.shape.kind.removeDefault().optional() }),
  z.strictObject({ op: z.literal("marker.move"), index: z.number().int().nonnegative(), atMs: time, fromMs: time.optional() }),
  z.strictObject({ op: z.literal("marker.remove"), index: z.number().int().nonnegative(), fromMs: time.optional() }),
  z.strictObject({ op: z.literal("captions.set"), captions: CompositionCaptionsSchema.partial({ burnIn: true }).nullable() }),
  z.strictObject({ op: z.literal("composition.restore"), fields: z.array(z.strictObject({ field: z.enum(fields), before: z.unknown(), after: z.unknown() })).max(fields.length) }),
] as const;
const CompositionOpSchema = z.discriminatedUnion("op", [...compositionEditVariants, look]);
type Op = z.output<typeof CompositionOpSchema>;
const opNames = new Set(compositionEditVariants.map(schema => schema.shape.op.value));
export const isCompositionOp = (op: EditOp): boolean => opNames.has(op.op as Exclude<Op["op"], "look.set">);
export type CompositionEditResult = { ok: true; composition: Record<string, unknown>; inverse: EditOp[]; touched: string[] } | { ok: false; issues: EditIssue[] };

type Draft = z.input<typeof CompositionSchema>;
type Segment = Draft["scenes"][number];
const end = (clip: { startMs: number; durationMs: number }) => clip.startMs + clip.durationMs;
const order = (scenes: Segment[]) => [...scenes].sort((a, b) => a.startMs - b.startMs);
const overlap = (segment: Segment) => segment.transition && isOverlapTransition(segment.transition.type) ? segment.transition.durationMs : 0;
const find = <T extends { id: string }>(entries: T[], key: string): T => {
  const entry = entries.find(item => item.id === key);
  if (!entry) throw new Error(`No clip named “${key}”.`);
  return entry;
};
const shift = (scenes: Segment[], delta: number) => { for (const scene of scenes) scene.startMs += delta; };
function freshId(draft: Draft, base: string): string {
  const used = new Set([...draft.scenes, ...(draft.overlays ?? [])].map(clip => clip.id));
  const prefix = base.slice(0, 120);
  if (!used.has(prefix)) return prefix;
  let suffix = 2;
  while (used.has(`${prefix}-${suffix}`)) suffix++;
  return `${prefix}-${suffix}`;
}
function trim(clip: { startMs: number; durationMs: number; inMs?: number }, edge: "in" | "out", delta: number, ripple = false) {
  if (delta === 0) return;
  if (edge === "out") { clip.durationMs += delta; return; }
  clip.inMs = (clip.inMs ?? 0) + delta;
  clip.durationMs -= delta;
  if (!ripple) clip.startMs += delta;
}
function applyOne(draft: Draft, op: Op) {
  switch (op.op) {
    case "segment.add": {
      const { atMs, durationMs, recipe, inMs } = op;
      draft.scenes.push({ id: op.id ?? freshId(draft, recipe), recipe, startMs: atMs, durationMs, ...(inMs !== undefined ? { inMs } : {}) });
      return;
    }
    case "segment.move": find(draft.scenes, op.id).startMs = op.atMs; return;
    case "segment.reorder": {
      if (op.beforeId === op.id) return;
      const sorted = order(draft.scenes);
      const clip = find(sorted, op.id);
      const slots = sorted.map((entry, index) => ({ transition: entry.transition, gap: index === 0 ? entry.startMs : entry.startMs - end(sorted[index - 1]) }));
      const reordered = sorted.filter(entry => entry !== clip);
      reordered.splice(op.beforeId === null ? reordered.length : reordered.indexOf(find(reordered, op.beforeId)), 0, clip);
      let cursor = 0;
      for (const [index, entry] of reordered.entries()) {
        const slot = slots[index];
        entry.startMs = cursor + slot.gap;
        if (slot.transition) entry.transition = slot.transition;
        else delete entry.transition;
        cursor = end(entry);
      }
      return;
    }
    case "segment.trim": {
      const sorted = order(draft.scenes), clip = find(sorted, op.id);
      trim(clip, op.edge, op.deltaMs, op.mode === "ripple");
      if (op.mode === "ripple") shift(sorted.slice(sorted.indexOf(clip) + 1), op.deltaMs * (op.edge === "in" ? -1 : 1));
      return;
    }
    case "segment.roll": {
      const sorted = order(draft.scenes), left = find(sorted, op.leftId), right = find(sorted, op.rightId);
      if (sorted[sorted.indexOf(left) + 1] !== right || Math.abs(end(left) - right.startMs - overlap(right)) > 0.5)
        throw new Error("Roll needs two adjacent shots sharing a cut.");
      trim(left, "out", op.deltaMs);
      trim(right, "in", op.deltaMs);
      return;
    }
    case "segment.slip": {
      const clip = find(draft.scenes, op.id);
      if (op.deltaMs !== 0) clip.inMs = (clip.inMs ?? 0) + op.deltaMs;
      return;
    }
    case "segment.split": {
      const clip = find(draft.scenes, op.id), duration = op.atMs - clip.startMs;
      if (duration <= 0 || duration >= clip.durationMs) throw new Error("Split inside the shot.");
      const right = { id: op.newId ?? freshId(draft, `${clip.id}-split`), recipe: clip.recipe, startMs: op.atMs, durationMs: clip.durationMs - duration, inMs: (clip.inMs ?? 0) + duration };
      clip.durationMs = duration;
      draft.scenes.splice(draft.scenes.indexOf(clip) + 1, 0, right);
      return;
    }
    case "segment.remove": {
      const sorted = order(draft.scenes), clip = find(sorted, op.id), index = sorted.indexOf(clip), next = sorted[index + 1];
      draft.scenes.splice(draft.scenes.indexOf(clip), 1);
      const incoming = overlap(clip);
      const outgoing = next ? overlap(next) : 0;
      if (op.ripple) shift(sorted.slice(index + 1), -clip.durationMs + incoming + (index === 0 ? outgoing : 0));
      if (next && outgoing && (!op.ripple || index === 0)) delete next.transition;
      return;
    }
    case "transition.set": case "transition.remove": {
      const sorted = order(draft.scenes), clip = find(sorted, op.segmentId), index = sorted.indexOf(clip);
      const previous = sorted[index - 1], oldOverlap = overlap(clip);
      if (op.op === "transition.set") {
        const { op: _op, segmentId: _id, ...transition } = op;
        clip.transition = transition;
      } else delete clip.transition;
      const nextOverlap = overlap(clip);
      if (nextOverlap && previous) shift(sorted.slice(index), end(previous) - nextOverlap - clip.startMs);
      else if (oldOverlap && previous) shift(sorted.slice(index), Math.max(0, end(previous) - clip.startMs));
      return;
    }
    case "overlay.add": {
      const { op: _op, id, atMs, ...clip } = op;
      (draft.overlays ??= []).push({ ...clip, id: id ?? freshId(draft, clip.recipe), startMs: atMs });
      return;
    }
    case "overlay.move": find(draft.overlays ?? [], op.id).startMs = op.atMs; return;
    case "overlay.trim": trim(find(draft.overlays ?? [], op.id), op.edge, op.deltaMs); return;
    case "overlay.remove": {
      const clip = find(draft.overlays ?? [], op.id);
      draft.overlays!.splice(draft.overlays!.indexOf(clip), 1);
      return;
    }
    case "overlay.set": {
      const { op: _op, id, ...values } = op;
      Object.assign(find(draft.overlays ?? [], id), values);
      return;
    }
    case "audio.add": {
      const { op: _op, ...track } = op;
      (draft.audio ??= []).push(track);
      return;
    }
    case "audio.move": find(draft.audio ?? [], op.id).startMs = op.atMs; return;
    case "audio.trim": {
      const track = find(draft.audio ?? [], op.id);
      if (op.deltaMs === 0) return;
      const duration = track.durationMs ?? (op.endMs ?? timelineDuration(draft.scenes)) - track.startMs;
      if (op.edge === "in") {
        track.startMs += op.deltaMs;
        track.offsetMs = (track.offsetMs ?? 0) + op.deltaMs;
        if (track.durationMs !== undefined || op.endMs !== undefined) track.durationMs = duration - op.deltaMs;
        if (duration - op.deltaMs <= 0) throw new Error("The audio trim would remove the whole clip.");
      } else track.durationMs = duration + op.deltaMs;
      return;
    }
    case "audio.remove": {
      const track = find(draft.audio ?? [], op.id);
      draft.audio!.splice(draft.audio!.indexOf(track), 1);
      for (const entry of draft.audio!) if (entry.duckUnder?.trackId === op.id) delete entry.duckUnder;
      return;
    }
    case "audio.set": {
      const { op: _op, id, ...values } = op;
      Object.assign(find(draft.audio ?? [], id), values);
      return;
    }
    case "marker.add": {
      const { op: _op, ...marker } = op;
      (draft.markers ??= []).push(marker);
      return;
    }
    case "marker.move": case "marker.remove": {
      const marker = draft.markers?.[op.index];
      if (!marker || (op.fromMs !== undefined && marker.atMs !== op.fromMs)) throw new Error(`Marker ${op.index} moved or no longer exists.`);
      if (op.op === "marker.move") marker.atMs = op.atMs;
      else draft.markers!.splice(op.index, 1);
      return;
    }
    case "captions.set": if (op.captions) draft.captions = op.captions; else delete draft.captions; return;
    case "look.set": if (op.look) draft.look = op.look as Draft["look"]; else delete draft.look; return;
    case "composition.restore": {
      const document = draft as Record<string, unknown>;
      for (const { field, before, after } of op.fields) {
        if (!sameJsonValue(document[field] ?? null, after)) throw new Error(`“${field}” changed since the edit.`);
        if (before === null) delete document[field];
        else document[field] = structuredCopy(before);
      }
    }
  }
}
const structuredCopy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function applyCompositionOps(document: unknown, ops: EditOp[]): CompositionEditResult {
  const original = CompositionSchema.safeParse(document);
  if (!original.success) return { ok: false, issues: original.error.issues.map(issue => ({ code: "ERR_COMPOSITION_INVALID", path: `composition.${issue.path.join(".")}`, message: issue.message })) };
  const base = document as Draft;
  const draft = structuredCopy(base);
  for (const [index, op] of ops.entries()) {
    const parsed = CompositionOpSchema.safeParse(op);
    if (!parsed.success) return { ok: false, issues: [{ code: "ERR_EDIT_TARGET", path: `ops.${index}.op`, message: `${op.op} cannot edit a composition.` }] };
    try { applyOne(draft, parsed.data); }
    catch (error) { return { ok: false, issues: [{ code: "ERR_EDIT_TARGET", path: `ops.${index}`, message: (error as Error).message }] }; }
  }
  const parsed = CompositionSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map(issue => ({ code: "ERR_COMPOSITION_INVALID", path: `composition.${issue.path.join(".")}`, message: issue.message })) };
  const { issues } = validateTimeline(timelineFromComposition(parsed.data));
  if (issues.length) return { ok: false, issues: issues.map(issue => ({ ...issue, path: issue.path.replace(/^timeline\.segments\./, "composition.scenes.") })) };
  const changes = fields.filter(field => !sameJsonValue(base[field], draft[field])).map(field => ({ field, before: base[field] ?? null, after: draft[field] ?? null }));
  return { ok: true, composition: draft as Record<string, unknown>, touched: changes.map(change => change.field), inverse: changes.length ? [{ op: "composition.restore", fields: changes }] : [] };
}

export function planCompositionSnap(composition: Composition, kind: "beats" | "downbeats" = "beats", toleranceMs = 120) {
  const beats = composition.markers.filter(marker => marker.kind === "downbeat" || (kind === "beats" && marker.kind === "beat")).map(marker => marker.atMs);
  const plan = snapToBeats(composition.scenes.map(scene => ({ ...scene, overlapMs: overlap(scene) })), beats, toleranceMs);
  const ops = plan.changes.map((change): Op => change.field === "startMs"
    ? { op: "segment.move", id: change.id, atMs: change.to }
    : { op: "segment.trim", id: change.id, mode: "plain", edge: "out", deltaMs: change.to - change.from });
  return { ...plan, ops, beatCount: beats.length };
}
