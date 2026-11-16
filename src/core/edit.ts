import { z } from "zod";
import { EasingSchema } from "./easing";
import { KeyframeEasingSchema, TrackRefSchema, STAGGER_ORDERS, evaluateMotion, MotionLinkSchema, MotionSchema } from "./motion";
import { SceneConstraintSchema } from "./scene";
import { SceneRecipeSchema, EDITOR_LABEL_COLORS } from "./recipes";
import { presentPreview } from "./preview";

/** SOURCE OF TRUTH: EditOpSchema, applyEdits.
 * WHAT: the one typed edit vocabulary (keyframes, tracks, scene base, clips, staggers, links, constraints,
 * paths, editor metadata) and its pure reducer over raw recipe JSON: atomic batches, exact inverses,
 * gesture coalescing and human labels. Keyframes are addressed by (track, atMs), never array index.
 * WHY: the CLI, coding agents and the studio editor make the same edits, so every click has a command,
 * undo is exact, and there is no second motion model or validator (results pass SceneRecipeSchema and
 * presentPreview).
 * WHERE: project/edit.ts (velora edit and the bridge) applies batches and writes them through
 * core/json formatJsonDocument; the Phase 04 editor sends the same ops.
 */
const finite = z.number().finite();
const time = finite.nonnegative().max(1_200_000);
const targetSchema = z.union([
  z.strictObject({ kind: z.literal("surface"), id: z.string().min(1).max(128) }),
  z.strictObject({ kind: z.literal("camera") }),
  z.strictObject({ kind: z.literal("focus") }),
  z.strictObject({ kind: z.literal("channel"), id: z.string().min(1).max(128) }),
  z.strictObject({ kind: z.literal("style"), id: z.string().min(1).max(128) }),
]);
/** A track by its uniqueness key (target, property), optionally inside a clip (by clip id). */
export const TrackAddressSchema = z.strictObject({ target: targetSchema, property: z.string().min(1).max(80), clip: z.string().min(1).max(64).optional() });
export type TrackAddress = z.output<typeof TrackAddressSchema>;
const keyRef = z.strictObject({ track: TrackAddressSchema, atMs: time });
const keyValue = z.union([finite, z.string().max(128), z.tuple([finite, finite, finite])]);
const vector = z.tuple([finite, finite, finite]);
const nullable = <T extends z.ZodType>(schema: T) => z.union([schema, z.null()]).optional();
const raw = z.record(z.string(), z.unknown());
const FIELD_PATHS = ["definition.scene.camera", "definition.scene.focus", "definition.scene.constraints", "definition.look", "definition.motion",
  "definition.motion.durationMs", "definition.motion.speed", "definition.motion.loop", "definition.motion.clips", "definition.motion.links", "editor"] as const;
// Ops that land with later phases (12-16); they validate as shapes and return ERR_EDIT_UNSUPPORTED.
export const DEFERRED_EDIT_OPS = Object.freeze(["stage.set", "depth.set", "depth.rule.add", "depth.rule.remove", "depth.resolve", "lens.apply", "rack.add", "rig.apply", "rig.update"] as const);
export const EditOpSchema = z.discriminatedUnion("op", [
  // Keyframes
  z.strictObject({ op: z.literal("key.set"), track: TrackAddressSchema, atMs: time, value: keyValue, easing: KeyframeEasingSchema.optional() }),
  z.strictObject({ op: z.literal("key.remove"), track: TrackAddressSchema, atMs: time }),
  z.strictObject({ op: z.literal("key.move"), track: TrackAddressSchema, fromMs: time, toMs: time }),
  z.strictObject({ op: z.literal("key.ease"), track: TrackAddressSchema, atMs: time, easing: KeyframeEasingSchema }),
  z.strictObject({ op: z.literal("keys.shift"), refs: z.array(keyRef).min(1).max(2000), deltaMs: finite }),
  z.strictObject({ op: z.literal("keys.scale"), refs: z.array(keyRef).min(1).max(2000), pivotMs: time, factor: finite.positive().max(100) }),
  z.strictObject({ op: z.literal("keys.reverse"), refs: z.array(keyRef).min(2).max(2000) }),
  // Tracks
  z.strictObject({ op: z.literal("track.add"), track: TrackAddressSchema, keyframes: z.array(raw).min(1).max(10_000), interpolation: z.enum(["segments", "smooth"]).optional(),
    ease: EasingSchema.optional(), unit: z.string().max(4).optional(), noise: raw.optional(), rove: z.boolean().optional(), orient: raw.optional() }),
  z.strictObject({ op: z.literal("track.remove"), track: TrackAddressSchema }),
  z.strictObject({ op: z.literal("track.options"), track: TrackAddressSchema, interpolation: nullable(z.enum(["segments", "smooth"])), ease: nullable(EasingSchema),
    noise: nullable(raw), rove: nullable(z.boolean()), orient: nullable(raw), unit: nullable(z.string().max(4)) }),
  // Scene base
  z.strictObject({ op: z.literal("camera.set"), property: z.enum(["x", "y", "z", "perspective", "rotateX", "rotateY", "rotateZ"]), value: z.union([finite, z.null()]) }),
  z.strictObject({ op: z.literal("focus.set"), property: z.enum(["distance", "fStop", "focalLength", "maxBlur"]), value: z.union([finite, z.null()]) }),
  z.strictObject({ op: z.literal("node.ensure"), id: z.string().min(1).max(128), parentId: z.string().min(1).max(128).optional() }),
  z.strictObject({ op: z.literal("node.remove"), id: z.string().min(1).max(128) }),
  z.strictObject({ op: z.literal("motion.set"), durationMs: time.optional(), speed: finite.optional(), loop: nullable(z.boolean()) }),
  z.strictObject({ op: z.literal("look.set"), look: z.union([raw, z.null()]) }),
  // Structure
  z.strictObject({ op: z.literal("clip.create"), id: z.string().min(1).max(64), refs: z.array(TrackAddressSchema).max(1000).optional(), tracks: z.array(raw).max(1000).optional(), startMs: time.optional(), label: z.string().max(80).optional() }),
  z.strictObject({ op: z.literal("clip.update"), id: z.string().min(1).max(64), startMs: time.optional(), speed: nullable(finite), inMs: nullable(time), durationMs: nullable(finite.positive()),
    loop: nullable(z.union([z.literal(false), z.number().int().min(1)])), ease: nullable(EasingSchema), mode: nullable(z.enum(["replace", "add"])), label: nullable(z.string().max(80)) }),
  z.strictObject({ op: z.literal("clip.dissolve"), id: z.string().min(1).max(64), bake: z.strictObject({ samplesPerSecond: finite.min(1).max(240) }).optional() }),
  z.strictObject({ op: z.literal("stagger.set"), clipId: z.string().min(1).max(64), members: z.array(z.string().min(1)).min(1).max(256), eachMs: finite.nonnegative(),
    order: z.union([z.enum(STAGGER_ORDERS), z.strictObject({ random: z.number().int().nonnegative() })]).optional(), ease: EasingSchema.optional() }),
  z.strictObject({ op: z.literal("link.set"), link: MotionLinkSchema }),
  z.strictObject({ op: z.literal("link.remove"), to: TrackRefSchema }),
  z.strictObject({ op: z.literal("constraint.set"), index: z.number().int().nonnegative().max(15).optional(), constraint: SceneConstraintSchema }),
  z.strictObject({ op: z.literal("constraint.remove"), index: z.number().int().nonnegative().max(15) }),
  z.strictObject({ op: z.literal("path.fromAxes"), target: z.union([z.strictObject({ kind: z.literal("surface"), id: z.string().min(1) }), z.strictObject({ kind: z.literal("camera") })]), clip: z.string().min(1).max(64).optional() }),
  z.strictObject({ op: z.literal("path.tangent"), track: TrackAddressSchema, atMs: time, inTangent: nullable(vector), outTangent: nullable(vector) }),
  // Metadata
  z.strictObject({ op: z.literal("editor.set"), labels: z.record(z.string(), z.union([z.string().max(80), z.null()])).optional(),
    colors: z.record(z.string(), z.union([z.enum(EDITOR_LABEL_COLORS), z.null()])).optional(), locked: z.array(z.string().min(1)).optional(),
    markers: z.array(z.strictObject({ atMs: time, label: z.string().max(80) })).max(512).optional() }),
  // The inverse primitive: put one entity (or field) back exactly; null removes it.
  z.strictObject({ op: z.literal("restore"), at: z.union([
    z.strictObject({ track: TrackAddressSchema }), z.strictObject({ node: z.string().min(1) }), z.strictObject({ clip: z.string().min(1) }),
    z.strictObject({ link: TrackRefSchema }), z.strictObject({ field: z.enum(FIELD_PATHS) }),
  ]), value: z.unknown(), index: z.number().int().nonnegative().optional() }),
  ...DEFERRED_EDIT_OPS.map(name => z.looseObject({ op: z.literal(name) })),
]);
export type EditOp = z.output<typeof EditOpSchema>;
export type EditOpInput = z.input<typeof EditOpSchema>;
export type EditIssue = { code: "ERR_EDIT_INVALID" | "ERR_EDIT_TARGET" | "ERR_EDIT_UNSUPPORTED"; path: string; message: string; hint?: string };
export type EditResult = { ok: true; recipe: Record<string, unknown>; inverse: EditOp[]; touched: string[] } | { ok: false; issues: EditIssue[] };

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
class EditFault extends Error {
  constructor(readonly code: EditIssue["code"], message: string, readonly at = "") { super(message); }
}
// Recipes are plain JSON, so a JSON round trip is an exact deep copy (no host structuredClone in core).
const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const sameTarget = (a: { kind: string; id?: string }, b: { kind: string; id?: string }) => a.kind === b.kind && (a.id ?? undefined) === (b.id ?? undefined);
const ms = (value: number) => `${(value / 1000).toFixed(2)} s`;
export function describeTrack(address: Pick<TrackAddress, "target" | "property" | "clip">): string {
  const target = address.target.kind === "surface" ? address.target.id : address.target.kind === "style" ? `style ${address.target.id}` : address.target.kind === "channel" ? `channel ${address.target.id}` : address.target.kind;
  return `${target} ${address.property}${address.clip ? ` in ${address.clip}` : ""}`;
}
const trackKey = (address: TrackAddress) => `track:${address.clip ?? ""}:${address.target.kind}:${"id" in address.target ? address.target.id : ""}.${address.property}`;

// ---- document access ----------------------------------------------------------------------------
const definition = (doc: Doc): Doc => {
  if (!doc.definition || typeof doc.definition !== "object") throw new EditFault("ERR_EDIT_TARGET", "The recipe has no definition.");
  return doc.definition;
};
const scene = (doc: Doc): Doc => {
  const d = definition(doc);
  if (!d.scene || typeof d.scene !== "object") throw new EditFault("ERR_EDIT_TARGET", "The recipe has no definition.scene.");
  d.scene.nodes ??= [];
  return d.scene;
};
function findClip(clips: Doc[] | undefined, id: string, root?: Doc): { clip: Doc; root: Doc } | undefined {
  for (const clip of clips ?? []) {
    if (clip.id === id) return { clip, root: root ?? clip };
    const nested = findClip(clip.clips, id, root ?? clip);
    if (nested) return nested;
  }
  return undefined;
}
function getField(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Doc)[key] : undefined), doc);
}
function setField(doc: Doc, path: string, value: unknown) {
  const keys = path.split("."), last = keys.pop()!;
  let parent: Doc = doc;
  for (const key of keys) {
    if (!parent[key] || typeof parent[key] !== "object") {
      if (value === null) return;
      parent[key] = {};
    }
    parent = parent[key];
  }
  if (value === null || value === undefined) delete parent[last]; else parent[last] = clone(value);
}

type Capture = (op: EditOp) => void;
/** Every op records restores of what it touches (before changing it), so the inverse is exact. */
class Draft {
  readonly inverse: EditOp[][] = [];
  readonly touched = new Set<string>();
  private current: EditOp[] = [];
  constructor(readonly doc: Doc) {}
  begin() { this.current = []; }
  end() { this.inverse.push(this.current); }
  private record: Capture = op => { this.current.push(op); };
  field(path: (typeof FIELD_PATHS)[number]) {
    this.touched.add(`field:${path}`);
    this.record({ op: "restore", at: { field: path }, value: clone(getField(this.doc, path)) ?? null } as EditOp);
  }
  container(address: Pick<TrackAddress, "clip">, create: boolean): Doc[] | undefined {
    if (address.clip) {
      const found = findClip(definition(this.doc).motion?.clips, address.clip);
      if (!found) throw new EditFault("ERR_EDIT_TARGET", `No clip "${address.clip}".`);
      if (create && !found.clip.tracks) { this.clip(address.clip); found.clip.tracks = []; }
      return found.clip.tracks;
    }
    const d = definition(this.doc);
    if (!d.motion) {
      if (!create) return undefined;
      this.field("definition.motion");
      d.motion = { durationMs: 0, speed: 1, tracks: [] };
    }
    d.motion.tracks ??= [];
    return d.motion.tracks;
  }
  findTrack(address: TrackAddress, required = true): { list: Doc[]; index: number; track: Doc } | undefined {
    const list = this.container(address, false);
    const index = list?.findIndex(track => sameTarget(track.target ?? {}, address.target) && track.property === address.property) ?? -1;
    if (index < 0) {
      if (required) throw new EditFault("ERR_EDIT_TARGET", `No track ${describeTrack(address)}.`);
      return undefined;
    }
    return { list: list!, index, track: list![index] };
  }
  track(address: TrackAddress) {
    const found = this.findTrack(address, false);
    this.touched.add(trackKey(address));
    this.record({ op: "restore", at: { track: address }, value: clone(found?.track) ?? null, ...(found ? { index: found.index } : {}) } as EditOp);
  }
  node(id: string) {
    const nodes = scene(this.doc).nodes as Doc[];
    const index = nodes.findIndex(node => node.id === id);
    this.touched.add(`node:${id}`);
    this.record({ op: "restore", at: { node: id }, value: index < 0 ? null : clone(nodes[index]), ...(index < 0 ? {} : { index }) } as EditOp);
  }
  clip(id: string) {
    const clips = definition(this.doc).motion?.clips as Doc[] | undefined;
    const found = findClip(clips, id);
    const rootId = found?.root.id ?? id;
    const index = clips?.findIndex(clip => clip.id === rootId) ?? -1;
    this.touched.add(`clip:${rootId}`);
    this.record({ op: "restore", at: { clip: rootId }, value: index < 0 ? null : clone(clips![index]), ...(index < 0 ? {} : { index }) } as EditOp);
  }
  /** Add the scene node a new surface/style track needs (recorded in the inverse). */
  ensureNode(target: TrackAddress["target"]) {
    if (target.kind !== "surface" && target.kind !== "style") return;
    if (target.id === "$member") return;
    const nodes = scene(this.doc).nodes as Doc[];
    if (nodes.some(node => node.id === target.id)) return;
    this.node(target.id);
    nodes.push({ id: target.id });
  }
}
const sortFrames = (frames: Doc[]) => frames.sort((a, b) => a.timeMs - b.timeMs);
function frameAt(track: Doc, atMs: number, address: TrackAddress): Doc {
  const frame = (track.keyframes as Doc[]).find(entry => entry.timeMs === atMs);
  if (!frame) throw new EditFault("ERR_EDIT_TARGET", `No keyframe at ${ms(atMs)} on ${describeTrack(address)}.`);
  return frame;
}
function refsByTrack(refs: { track: TrackAddress; atMs: number }[]) {
  const groups = new Map<string, { track: TrackAddress; times: number[] }>();
  for (const ref of refs) {
    const key = trackKey(ref.track);
    if (!groups.has(key)) groups.set(key, { track: ref.track, times: [] });
    groups.get(key)!.times.push(ref.atMs);
  }
  return [...groups.values()];
}
function retime(draft: Draft, refs: { track: TrackAddress; atMs: number }[], map: (atMs: number, times: number[]) => number) {
  for (const group of refsByTrack(refs)) {
    const { track } = draft.findTrack(group.track)!;
    draft.track(group.track);
    const frames = group.times.map(atMs => frameAt(track, atMs, group.track));
    const next = frames.map(frame => map(frame.timeMs, group.times));
    if (next.some(value => !Number.isFinite(value) || value < 0)) throw new EditFault("ERR_EDIT_INVALID", `Keyframe times on ${describeTrack(group.track)} would become negative.`);
    frames.forEach((frame, i) => { frame.timeMs = next[i]; });
    const times = (track.keyframes as Doc[]).map(frame => frame.timeMs);
    if (new Set(times).size !== times.length) throw new EditFault("ERR_EDIT_INVALID", `Keyframes on ${describeTrack(group.track)} would collide.`);
    sortFrames(track.keyframes);
  }
}
const set = (record: Doc, key: string, value: unknown) => { if (value === null) delete record[key]; else if (value !== undefined) record[key] = clone(value); };
function trackTargets(doc: Doc, id: string): boolean {
  const motion = definition(doc).motion;
  const visit = (tracks: Doc[] | undefined) => (tracks ?? []).some(track => track.target?.id === id);
  const clips = (list: Doc[] | undefined): boolean => (list ?? []).some(clip => visit(clip.tracks) || (clip.members ?? []).includes(id) || clips(clip.clips));
  const links = (motion?.links as Doc[] | undefined ?? []).some(link => link.to?.target?.id === id || link.from?.target?.id === id);
  const constraints = (scene(doc).constraints as Doc[] | undefined ?? []).some(c => c.target?.surface === id);
  return visit(motion?.tracks) || clips(motion?.clips) || links || constraints;
}
const linkKey = (ref: { target: { kind: string; id?: string }; property: string }) => `${ref.target.kind}:${ref.target.id ?? ""}.${ref.property}`;

function applyOne(draft: Draft, op: EditOp) {
  const doc = draft.doc;
  switch (op.op) {
    case "key.set": {
      const existing = draft.findTrack(op.track, false);
      draft.track(op.track);
      if (!existing) {
        const list = draft.container(op.track, true)!;
        draft.ensureNode(op.track.target);
        list.push({ target: clone(op.track.target), property: op.track.property, keyframes: [{ timeMs: op.atMs, value: clone(op.value), ...(op.easing !== undefined ? { easing: clone(op.easing) } : {}) }] });
        return;
      }
      const frame = (existing.track.keyframes as Doc[]).find(entry => entry.timeMs === op.atMs);
      if (frame) { frame.value = clone(op.value); if (op.easing !== undefined) frame.easing = clone(op.easing); }
      else { existing.track.keyframes.push({ timeMs: op.atMs, value: clone(op.value), ...(op.easing !== undefined ? { easing: clone(op.easing) } : {}) }); sortFrames(existing.track.keyframes); }
      return;
    }
    case "key.remove": {
      const { track } = draft.findTrack(op.track)!;
      frameAt(track, op.atMs, op.track);
      if (track.keyframes.length === 1) throw new EditFault("ERR_EDIT_INVALID", `That is the only keyframe on ${describeTrack(op.track)}; use track.remove instead.`);
      draft.track(op.track);
      track.keyframes = (track.keyframes as Doc[]).filter(frame => frame.timeMs !== op.atMs);
      return;
    }
    case "key.move": {
      const { track } = draft.findTrack(op.track)!;
      const frame = frameAt(track, op.fromMs, op.track);
      if (op.fromMs !== op.toMs && (track.keyframes as Doc[]).some(entry => entry.timeMs === op.toMs))
        throw new EditFault("ERR_EDIT_INVALID", `A keyframe already exists at ${ms(op.toMs)} on ${describeTrack(op.track)}.`);
      draft.track(op.track);
      frame.timeMs = op.toMs;
      sortFrames(track.keyframes);
      return;
    }
    case "key.ease": {
      const { track } = draft.findTrack(op.track)!;
      const frame = frameAt(track, op.atMs, op.track);
      draft.track(op.track);
      frame.easing = clone(op.easing);
      return;
    }
    case "keys.shift": return retime(draft, op.refs, atMs => atMs + op.deltaMs);
    case "keys.scale": return retime(draft, op.refs, atMs => op.pivotMs + (atMs - op.pivotMs) * op.factor);
    case "keys.reverse": return retime(draft, op.refs, (atMs, times) => Math.min(...times) + Math.max(...times) - atMs);
    case "track.add": {
      if (draft.findTrack(op.track, false)) throw new EditFault("ERR_EDIT_INVALID", `Track ${describeTrack(op.track)} already exists.`);
      draft.track(op.track);
      const list = draft.container(op.track, true)!;
      draft.ensureNode(op.track.target);
      const { op: _op, track, ...options } = op;
      list.push({ target: clone(track.target), property: track.property, ...clone(options) });
      return;
    }
    case "track.remove": {
      const found = draft.findTrack(op.track)!;
      draft.track(op.track);
      found.list.splice(found.index, 1);
      return;
    }
    case "track.options": {
      const { track } = draft.findTrack(op.track)!;
      draft.track(op.track);
      for (const key of ["interpolation", "ease", "noise", "rove", "orient", "unit"] as const) set(track, key, op[key]);
      return;
    }
    case "camera.set": case "focus.set": {
      const key = op.op === "camera.set" ? "camera" : "focus";
      draft.field(`definition.scene.${key}`);
      const s = scene(doc);
      s[key] ??= {};
      set(s[key], op.property, op.value);
      return;
    }
    case "node.ensure": {
      const nodes = scene(doc).nodes as Doc[];
      if (nodes.some(node => node.id === op.id)) return;
      draft.node(op.id);
      nodes.push({ id: op.id, ...(op.parentId ? { parentId: op.parentId } : {}) });
      return;
    }
    case "node.remove": {
      const nodes = scene(doc).nodes as Doc[];
      const index = nodes.findIndex(node => node.id === op.id);
      if (index < 0) throw new EditFault("ERR_EDIT_TARGET", `No scene node "${op.id}".`);
      if (trackTargets(doc, op.id) || nodes.some(node => node.parentId === op.id))
        throw new EditFault("ERR_EDIT_INVALID", `Node "${op.id}" is still targeted by tracks, clips, links, constraints or child nodes; remove those first.`);
      draft.node(op.id);
      nodes.splice(index, 1);
      return;
    }
    case "motion.set": {
      const d = definition(doc);
      if (!d.motion) { draft.field("definition.motion"); d.motion = { durationMs: op.durationMs ?? 0, speed: op.speed ?? 1, tracks: [] }; }
      else {
        if (op.durationMs !== undefined) draft.field("definition.motion.durationMs");
        if (op.speed !== undefined) draft.field("definition.motion.speed");
      }
      if (op.loop !== undefined) draft.field("definition.motion.loop");
      set(d.motion, "durationMs", op.durationMs);
      set(d.motion, "speed", op.speed);
      set(d.motion, "loop", op.loop);
      return;
    }
    case "look.set": {
      draft.field("definition.look");
      setField(doc, "definition.look", op.look);
      return;
    }
    case "clip.create": {
      const d = definition(doc);
      if (findClip(d.motion?.clips, op.id)) throw new EditFault("ERR_EDIT_INVALID", `Clip "${op.id}" already exists.`);
      draft.container({}, true);
      if (!d.motion.clips) draft.field("definition.motion.clips");
      const startMs = op.startMs ?? 0;
      const moved: Doc[] = [];
      for (const ref of op.refs ?? []) {
        if (ref.clip) throw new EditFault("ERR_EDIT_INVALID", "clip.create moves root tracks; dissolve or edit nested clips separately.");
        const found = draft.findTrack(ref)!;
        draft.track(ref);
        const track = clone(found.track);
        // Keep the render unchanged: clip-local times are scene times minus startMs.
        for (const frame of track.keyframes as Doc[]) {
          frame.timeMs -= startMs;
          if (frame.timeMs < 0) throw new EditFault("ERR_EDIT_INVALID", `startMs ${ms(startMs)} is after a keyframe of ${describeTrack(ref)}.`);
        }
        moved.push(track);
        found.list.splice(found.index, 1);
      }
      for (const track of op.tracks ?? []) { moved.push(clone(track)); if (track.target && typeof track.target === "object") draft.ensureNode(track.target as TrackAddress["target"]); }
      draft.clip(op.id);
      d.motion.clips ??= [];
      d.motion.clips.push({ id: op.id, ...(op.label !== undefined ? { label: op.label } : {}), startMs, tracks: moved });
      return;
    }
    case "clip.update": {
      const found = findClip(definition(doc).motion?.clips, op.id);
      if (!found) throw new EditFault("ERR_EDIT_TARGET", `No clip "${op.id}".`);
      draft.clip(op.id);
      for (const key of ["startMs", "speed", "inMs", "durationMs", "loop", "ease", "mode", "label"] as const) set(found.clip, key, op[key]);
      return;
    }
    case "clip.dissolve": {
      const d = definition(doc);
      const clips = d.motion?.clips as Doc[] | undefined;
      const index = clips?.findIndex(clip => clip.id === op.id) ?? -1;
      if (index < 0) throw new EditFault("ERR_EDIT_TARGET", `No root clip "${op.id}" (dissolve nested clips by dissolving their parents first).`);
      const clip = clips![index];
      const simple = (clip.speed ?? 1) === 1 && clip.inMs === undefined && clip.durationMs === undefined && !clip.loop && clip.ease === undefined
        && (clip.mode ?? "replace") === "replace" && !clip.clips?.length && !clip.members;
      if (!simple && !op.bake) throw new EditFault("ERR_EDIT_INVALID", `Clip "${op.id}" remaps time (speed, trim, loop, ease, nesting, stagger or add mode); pass bake: {samplesPerSecond} to sample it into keyframes.`);
      if (!simple && (clip.mode ?? "replace") === "add") throw new EditFault("ERR_EDIT_INVALID", `Clip "${op.id}" is additive; baking would replace its owner. Change mode first.`);
      draft.clip(op.id);
      const tracks = simple ? (clip.tracks ?? []).map((track: Doc) => ({ ...clone(track), keyframes: (track.keyframes as Doc[]).map(frame => ({ ...clone(frame), timeMs: frame.timeMs + clip.startMs })) }))
        : bakeClip(d, clip, op.bake!.samplesPerSecond);
      const root = draft.container({}, true)!;
      for (const track of tracks) {
        const address = { target: track.target, property: track.property } as TrackAddress;
        if (draft.findTrack(address, false)) throw new EditFault("ERR_EDIT_INVALID", `Dissolving "${op.id}" would duplicate root track ${describeTrack(address)}.`);
        draft.track(address);
        root.push(track);
      }
      clips!.splice(index, 1);
      return;
    }
    case "stagger.set": {
      const found = findClip(definition(doc).motion?.clips, op.clipId);
      if (!found) throw new EditFault("ERR_EDIT_TARGET", `No clip "${op.clipId}".`);
      draft.clip(op.clipId);
      found.clip.members = [...op.members];
      found.clip.stagger = { eachMs: op.eachMs, ...(op.order !== undefined ? { order: clone(op.order) } : {}), ...(op.ease !== undefined ? { ease: clone(op.ease) } : {}) };
      return;
    }
    case "link.set": case "link.remove": {
      const d = definition(doc);
      const to = op.op === "link.set" ? op.link.to : op.to;
      if (!d.motion) throw new EditFault("ERR_EDIT_TARGET", "The recipe has no motion.");
      draft.field("definition.motion.links");
      const links: Doc[] = d.motion.links ?? [];
      const index = links.findIndex(link => link.to && linkKey(link.to) === linkKey(to));
      if (op.op === "link.remove") {
        if (index < 0) throw new EditFault("ERR_EDIT_TARGET", `No link drives ${linkKey(to)}.`);
        links.splice(index, 1);
      } else if (index < 0) links.push(clone(op.link)); else links[index] = clone(op.link);
      d.motion.links = links;
      return;
    }
    case "constraint.set": case "constraint.remove": {
      draft.field("definition.scene.constraints");
      const s = scene(doc);
      const list: Doc[] = s.constraints ?? [];
      if (op.op === "constraint.remove") {
        if (op.index >= list.length) throw new EditFault("ERR_EDIT_TARGET", `No constraint at index ${op.index}.`);
        list.splice(op.index, 1);
      } else if (op.index === undefined) list.push(clone(op.constraint));
      else if (op.index < list.length) list[op.index] = clone(op.constraint);
      else throw new EditFault("ERR_EDIT_TARGET", `No constraint at index ${op.index}; omit index to append.`);
      s.constraints = list;
      return;
    }
    case "path.fromAxes": {
      const axes = (["x", "y", "z"] as const).map(property => draft.findTrack({ target: op.target, property, ...(op.clip ? { clip: op.clip } : {}) } as TrackAddress, false));
      if (axes.some(axis => !axis)) throw new EditFault("ERR_EDIT_TARGET", "path.fromAxes needs x, y and z tracks on the target (add a constant track for a missing axis).");
      const times = [...new Set(axes.flatMap(axis => (axis!.track.keyframes as Doc[]).map(frame => frame.timeMs as number)))].sort((a, b) => a - b);
      const valueAt = (track: Doc, at: number) => {
        const state = evaluateMotion({ durationMs: Math.max(...times), speed: 1, tracks: [{ ...clone(track), target: { kind: "channel", id: "axis" }, property: "value" }] }, at);
        return state.channels.axis;
      };
      const x = axes[0]!.track;
      const keyframes = times.map(at => ({ timeMs: at, value: axes.map(axis => valueAt(axis!.track, at)),
        easing: clone((x.keyframes as Doc[]).find(frame => frame.timeMs === at)?.easing ?? "linear") }));
      for (const property of ["x", "y", "z"]) {
        const address = { target: op.target, property, ...(op.clip ? { clip: op.clip } : {}) } as TrackAddress;
        draft.track(address);
        const found = draft.findTrack(address)!;
        found.list.splice(found.index, 1);
      }
      const position = { target: op.target, property: "position", ...(op.clip ? { clip: op.clip } : {}) } as TrackAddress;
      draft.track(position);
      draft.container(position, true)!.push({ target: clone(op.target), property: "position", keyframes });
      return;
    }
    case "path.tangent": {
      if (op.track.property !== "position") throw new EditFault("ERR_EDIT_INVALID", "path.tangent applies to position path tracks.");
      const { track } = draft.findTrack(op.track)!;
      const frame = frameAt(track, op.atMs, op.track);
      draft.track(op.track);
      set(frame, "inTangent", op.inTangent);
      set(frame, "outTangent", op.outTangent);
      return;
    }
    case "editor.set": {
      draft.field("editor");
      doc.editor ??= {};
      for (const key of ["labels", "colors"] as const) {
        const changes = op[key];
        if (!changes) continue;
        const record = doc.editor[key] ?? {};
        for (const [id, value] of Object.entries(changes)) set(record, id, value);
        if (Object.keys(record).length) doc.editor[key] = record; else delete doc.editor[key];
      }
      if (op.locked) doc.editor.locked = [...op.locked];
      if (op.markers) doc.editor.markers = clone(op.markers);
      return;
    }
    case "restore": return restore(doc, op);
    default:
      throw new EditFault("ERR_EDIT_UNSUPPORTED", `${op.op} lands with a later Velora phase and is not available yet.`);
  }
}
function placeAt(list: Doc[], index: number, value: unknown, matches: (entry: Doc) => boolean) {
  const current = list.findIndex(matches);
  if (value === null || value === undefined) { if (current >= 0) list.splice(current, 1); return; }
  if (current >= 0) list[current] = clone(value) as Doc;
  else list.splice(Math.min(index, list.length), 0, clone(value) as Doc);
}
function restore(doc: Doc, op: Extract<EditOp, { op: "restore" }>) {
  const at = op.at, index = op.index ?? Number.MAX_SAFE_INTEGER;
  if ("field" in at) { setField(doc, at.field, op.value ?? null); return; }
  const d = definition(doc);
  if ("node" in at) { placeAt(scene(doc).nodes, index, op.value, node => node.id === at.node); return; }
  if ("clip" in at) {
    if (!d.motion) { if (op.value == null) return; throw new EditFault("ERR_EDIT_TARGET", "The recipe has no motion."); }
    d.motion.clips ??= [];
    placeAt(d.motion.clips, index, op.value, clip => clip.id === at.clip);
    return;
  }
  if ("link" in at) {
    if (!d.motion) return;
    d.motion.links ??= [];
    placeAt(d.motion.links, index, op.value, link => link.to && linkKey(link.to) === linkKey(at.link));
    return;
  }
  const address = at.track;
  let list: Doc[] | undefined;
  if (address.clip) list = findClip(d.motion?.clips, address.clip)?.clip.tracks ?? (op.value == null ? undefined : (findClip(d.motion?.clips, address.clip)!.clip.tracks = []));
  else list = d.motion?.tracks;
  if (!list) { if (op.value == null) return; throw new EditFault("ERR_EDIT_TARGET", `No container for ${describeTrack(address)}.`); }
  placeAt(list, index, op.value, track => sameTarget(track.target ?? {}, address.target) && track.property === address.property);
}
/** Sample a clip into plain root keyframes (linear) at a fixed rate over its scene span. */
function bakeClip(d: Doc, clip: Doc, samplesPerSecond: number): Doc[] {
  const motion = { durationMs: d.motion.durationMs, speed: 1, tracks: [], clips: [clone(clip)] };
  const probe = evaluateMotion(motion, 0);
  if (probe.issues.length) throw new EditFault("ERR_EDIT_INVALID", `Clip "${clip.id}" is invalid: ${probe.issues[0].message}`);
  if (probe.styles || probe.colorChannels) throw new EditFault("ERR_EDIT_INVALID", `Clip "${clip.id}" animates styles or colors, which bake does not sample; dissolve it by hand.`);
  const step = 1000 / samplesPerSecond, end = d.motion.durationMs as number;
  const times = Array.from({ length: Math.floor(end / step) + 1 }, (_, k) => Math.round(k * step * 1000) / 1000);
  if (times[times.length - 1] < end) times.push(end);
  const series = new Map<string, Doc>();
  for (const at of times) {
    const state = evaluateMotion(motion, at);
    const add = (target: Doc, property: string, value: number) => {
      const key = JSON.stringify([target, property]);
      if (!series.has(key)) series.set(key, { target, property, keyframes: [] });
      series.get(key)!.keyframes.push({ timeMs: at, value, easing: "linear" });
    };
    for (const [id, values] of Object.entries(state.surfaces)) for (const [property, value] of Object.entries(values)) add({ kind: "surface", id }, property, value as number);
    for (const [property, value] of Object.entries(state.camera)) add({ kind: "camera" }, property, value as number);
    for (const [property, value] of Object.entries(state.focus)) add({ kind: "focus" }, property, value as number);
    for (const [id, value] of Object.entries(state.channels)) add({ kind: "channel", id }, "value", value);
  }
  return [...series.values()];
}

const describeOps: Record<string, (op: any) => string> = { // eslint-disable-line @typescript-eslint/no-explicit-any
  "key.set": op => `Set ${describeTrack(op.track)} keyframe at ${ms(op.atMs)} to ${JSON.stringify(op.value)}`,
  "key.remove": op => `Remove ${describeTrack(op.track)} keyframe at ${ms(op.atMs)}`,
  "key.move": op => `Move ${describeTrack(op.track)} keyframe ${ms(op.fromMs)} → ${ms(op.toMs)}`,
  "key.ease": op => `Ease ${describeTrack(op.track)} keyframe at ${ms(op.atMs)}: ${typeof op.easing === "string" ? op.easing : JSON.stringify(op.easing)}`,
  "keys.shift": op => `Shift ${op.refs.length} keyframe${op.refs.length === 1 ? "" : "s"} by ${op.deltaMs >= 0 ? "+" : ""}${ms(op.deltaMs)}`,
  "keys.scale": op => `Scale ${op.refs.length} keyframes ×${op.factor} around ${ms(op.pivotMs)}`,
  "keys.reverse": op => `Reverse ${op.refs.length} keyframes`,
  "track.add": op => `Add track ${describeTrack(op.track)}`,
  "track.remove": op => `Remove track ${describeTrack(op.track)}`,
  "track.options": op => `Change options of ${describeTrack(op.track)}`,
  "camera.set": op => op.value === null ? `Clear camera ${op.property}` : `Set camera ${op.property} to ${op.value}`,
  "focus.set": op => op.value === null ? `Clear focus ${op.property}` : `Set focus ${op.property} to ${op.value}`,
  "node.ensure": op => `Add layer ${op.id}`,
  "node.remove": op => `Remove layer ${op.id}`,
  "motion.set": op => `Set motion ${Object.entries(op).filter(([k]) => k !== "op").map(([k, v]) => `${k} ${v}`).join(", ")}`,
  "look.set": op => op.look === null ? "Remove look" : "Set look",
  "clip.create": op => `Group ${(op.refs?.length ?? 0) + (op.tracks?.length ?? 0)} tracks into clip ${op.id}`,
  "clip.update": op => `Update clip ${op.id}`,
  "clip.dissolve": op => `Dissolve clip ${op.id}${op.bake ? ` (baked at ${op.bake.samplesPerSecond}/s)` : ""}`,
  "stagger.set": op => `Stagger ${op.members.length} layers in ${op.clipId} by ${ms(op.eachMs)}`,
  "link.set": op => `Link ${linkKey(op.link.to)}`,
  "link.remove": op => `Unlink ${linkKey(op.to)}`,
  "constraint.set": op => `${op.index === undefined ? "Add" : "Replace"} ${op.constraint.kind} constraint`,
  "constraint.remove": op => `Remove constraint ${op.index}`,
  "path.fromAxes": op => `Convert ${op.target.id ?? op.target.kind} x/y/z to a motion path`,
  "path.tangent": op => `Set path tangents at ${ms(op.atMs)} on ${describeTrack(op.track)}`,
  "editor.set": () => "Update editor labels, colors, locks or markers",
  restore: op => `Restore ${Object.keys(op.at)[0]}`,
};
/** A human label for history and logs, for example "Move headline x keyframe 1.20 s → 1.35 s". */
export function describeOp(op: EditOp): string {
  return (describeOps[op.op] ?? (() => `${op.op} (not yet available)`))(op);
}
const sameAddress = (a: TrackAddress, b: TrackAddress) => trackKey(a) === trackKey(b);
/** Merge consecutive transient ops on the same target (a drag gesture) into one history entry. */
export function coalesce(prev: EditOp, next: EditOp): EditOp | undefined {
  if (prev.op === "key.set" && next.op === "key.set" && sameAddress(prev.track, next.track) && prev.atMs === next.atMs) return { ...next, easing: next.easing ?? prev.easing } as EditOp;
  if (prev.op === "key.move" && next.op === "key.move" && sameAddress(prev.track, next.track) && prev.toMs === next.fromMs) return { ...next, fromMs: prev.fromMs };
  if ((prev.op === "camera.set" || prev.op === "focus.set") && next.op === prev.op && prev.property === next.property) return next;
  if (prev.op === "clip.update" && next.op === "clip.update" && prev.id === next.id) return { ...prev, ...next };
  if (prev.op === "keys.shift" && next.op === "keys.shift" && prev.refs.length === next.refs.length
    && prev.refs.every((ref, i) => sameAddress(ref.track, next.refs[i].track) && ref.atMs + prev.deltaMs === next.refs[i].atMs))
    return { ...prev, deltaMs: prev.deltaMs + next.deltaMs };
  return undefined;
}

/** Apply a batch atomically. The result passes SceneRecipeSchema and presentPreview; issue paths name
 * the op that caused them (ops.3...). `inverse` restores the input exactly (deep-equal). */
/** validation "motion" checks only MotionSchema (for in-gesture previews whose result the preview session
 * validates again); the default "full" check is required before anything is committed or written. */
export type ApplyOptions = { validation?: "full" | "motion" };
export function applyEdits(recipe: unknown, ops: unknown, options: ApplyOptions = {}): EditResult {
  const batch = z.array(z.unknown()).max(2000).safeParse(ops);
  if (!batch.success) return { ok: false, issues: [{ code: "ERR_EDIT_INVALID", path: "ops", message: "Supply an array of at most 2000 edit ops." }] };
  const parsed: EditOp[] = [];
  const issues: EditIssue[] = [];
  for (const [index, op] of batch.data.entries()) {
    const result = EditOpSchema.safeParse(op);
    if (!result.success) issues.push(...result.error.issues.map(issue => ({ code: "ERR_EDIT_INVALID" as const, path: ["ops", index, ...issue.path].join("."), message: issue.message })));
    else if ((DEFERRED_EDIT_OPS as readonly string[]).includes(result.data.op))
      issues.push({ code: "ERR_EDIT_UNSUPPORTED", path: `ops.${index}.op`, message: `${result.data.op} lands with a later Velora phase and is not available yet.` });
    else parsed.push(result.data);
  }
  if (issues.length) return { ok: false, issues };
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return { ok: false, issues: [{ code: "ERR_EDIT_TARGET", path: "recipe", message: "The recipe must be a JSON object." }] };
  const run = (count: number) => {
    const draft = new Draft(clone(recipe as Doc));
    for (let index = 0; index < count; index++) {
      draft.begin();
      try { applyOne(draft, parsed[index]); }
      catch (error) {
        if (error instanceof EditFault) throw Object.assign(error, { index });
        throw error;
      }
      draft.end();
    }
    return draft;
  };
  let draft: Draft;
  try { draft = run(parsed.length); }
  catch (error) {
    const fault = error as EditFault & { index: number };
    if (!(error instanceof EditFault)) throw error;
    return { ok: false, issues: [{ code: fault.code, path: `ops.${fault.index}`, message: fault.message }] };
  }
  const problems = options.validation === "motion" ? validateMotion(draft.doc) : validate(draft.doc);
  if (problems.length) {
    // Attribute to the op after which the batch stays invalid (scan back for the last valid prefix).
    let culprit = parsed.length - 1;
    for (let count = parsed.length - 1; count >= 0; count--) {
      if (!validate(run(count).doc).length) { culprit = count; break; }
      if (count === 0) culprit = -1;
    }
    const prefix = culprit < 0 ? "ops" : `ops.${culprit}`;
    return { ok: false, issues: problems.map(problem => ({ code: "ERR_EDIT_INVALID", path: `${prefix}:${problem.path}`, message: problem.message,
      ...(/exceeds scene duration/.test(problem.message) ? { hint: "Extend the scene in the same batch with motion.set {durationMs}." } : {}) })) };
  }
  return { ok: true, recipe: draft.doc, inverse: draft.inverse.reverse().flatMap(group => [...group].reverse()), touched: [...draft.touched] };
}
function validateMotion(doc: Doc): { path: string; message: string }[] {
  const motion = doc?.definition?.motion;
  if (motion === undefined) return [];
  const parsed = MotionSchema.safeParse(motion);
  return parsed.success ? [] : parsed.error.issues.map(issue => ({ path: `definition.motion.${issue.path.join(".")}`, message: issue.message }));
}
function validate(doc: Doc): { path: string; message: string }[] {
  const recipe = SceneRecipeSchema.safeParse(doc);
  if (!recipe.success) return recipe.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message }));
  const preview = presentPreview(recipe.data.definition);
  return preview.valid ? [] : preview.issues.map(issue => ({ path: `definition.${issue.path}`, message: issue.message }));
}

/** Track shorthand: camera.z, focus.distance, <surface>.<prop>, style:<surface>.--accent, channel:<id>,
 * each with an optional @<clip> suffix. */
export function parseTrackShorthand(text: string): { ok: true; track: TrackAddress } | { ok: false; message: string } {
  const [body, clip, extra] = text.split("@");
  const withClip = (track: Omit<TrackAddress, "clip">) => {
    const parsed = TrackAddressSchema.safeParse({ ...track, ...(clip ? { clip } : {}) });
    return parsed.success ? { ok: true as const, track: parsed.data } : { ok: false as const, message: `Invalid track "${text}": ${parsed.error.issues[0].message}` };
  };
  if (extra !== undefined || clip === "") return { ok: false, message: `Use at most one @clip suffix in "${text}".` };
  if (body.startsWith("channel:")) return body.length > 8 ? withClip({ target: { kind: "channel", id: body.slice(8) }, property: "value" }) : { ok: false, message: "channel: needs an id, for example channel:cursor-x." };
  if (body.startsWith("style:")) {
    const at = body.indexOf(".--");
    if (at < 7) return { ok: false, message: `Use style:<surface>.--<name>, for example style:card.--accent (got "${text}").` };
    return withClip({ target: { kind: "style", id: body.slice(6, at) }, property: body.slice(at + 1) });
  }
  const dot = body.lastIndexOf(".");
  if (dot < 1 || dot === body.length - 1) return { ok: false, message: `Use <target>.<property>, for example camera.z, focus.distance or headline.x (got "${text}").` };
  const head = body.slice(0, dot), property = body.slice(dot + 1);
  if (head === "camera" || head === "focus") return withClip({ target: { kind: head }, property });
  return withClip({ target: { kind: "surface", id: head }, property });
}
/** A unified line diff (context 2) for dry runs. */
export function lineDiff(before: string, after: string, context = 2): string {
  if (before === after) return "";
  const a = before.split(/\r?\n/), b = after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1, endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const from = Math.max(0, start - context);
  const lines = [`@@ -${from + 1},${endA + 1 + context - from} +${from + 1},${endB + 1 + context - from} @@`];
  for (let i = from; i < start; i++) lines.push(` ${a[i]}`);
  for (let i = start; i <= endA; i++) lines.push(`-${a[i]}`);
  for (let i = start; i <= endB; i++) lines.push(`+${b[i]}`);
  for (let i = endA + 1; i <= Math.min(a.length - 1, endA + context); i++) lines.push(` ${a[i]}`);
  return lines.join("\n");
}
