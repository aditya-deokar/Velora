import { z } from "zod";
import { EasingSchema } from "./easing";
import { MotionClipSchema, MotionTrackSchema, type MotionClipInput, type MotionClipOutput } from "./motion";
import { buildBehavior, BEHAVIOR_CATALOG, BEHAVIOR_INTENSITIES, type BehaviorTarget } from "./behaviors";

/** SOURCE OF TRUTH: PresetSchema.
 * WHAT: project presets (`src/velora/presets/<id>.preset.json`): reusable motion (tracks with a `$target`
 * placeholder, absolute or relative values), named easing curves, or a parameterized behavior; plus the
 * pure apply/save functions that turn a preset into an ordinary clip with `source: {preset}` provenance.
 * WHY: one gesture reuses motion across scenes and layers; presets are data (never executed) shared by
 * the studio editor, the edit bridge (`/v1/presets`) and `velora edit preset`.
 * WHERE: src/project/discovery.ts lists preset files; src/project/edit.ts serves and applies them.
 */
export const PRESET_TARGET = "$target";
const presetId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a kebab-case preset id (a-z, 0-9 and -).").max(64);
const record = z.record(z.string(), z.unknown());
const MotionBodySchema = z.strictObject({
  values: z.enum(["absolute", "relative"]).default("relative"),
  durationMs: z.number().finite().positive().max(600_000).optional(),
  ease: EasingSchema.optional(),
  mode: z.enum(["replace", "add"]).optional(),
  tracks: z.array(record).max(256).default([]),
  clips: z.array(record).max(64).optional(),
});
const EasingBodySchema = z.strictObject({ curves: z.array(z.strictObject({ name: z.string().min(1).max(64), easing: EasingSchema })).min(1).max(64) });
const BehaviorBodySchema = z.strictObject({
  behavior: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()).optional(),
});
export const PresetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ $schema: z.string().optional(), version: z.literal(1), id: presetId, title: z.string().min(1).max(80), description: z.string().max(400).optional(),
    kind: z.literal("motion"), params: z.record(z.string(), z.unknown()).optional(), body: MotionBodySchema }),
  z.strictObject({ $schema: z.string().optional(), version: z.literal(1), id: presetId, title: z.string().min(1).max(80), description: z.string().max(400).optional(),
    kind: z.literal("easing"), params: z.record(z.string(), z.unknown()).optional(), body: EasingBodySchema }),
  z.strictObject({ $schema: z.string().optional(), version: z.literal(1), id: presetId, title: z.string().min(1).max(80), description: z.string().max(400).optional(),
    kind: z.literal("behavior"), params: z.record(z.string(), z.unknown()).optional(), body: BehaviorBodySchema }),
]).superRefine((preset, ctx) => {
  if (preset.kind === "motion") {
    if (!preset.body.tracks.length && !preset.body.clips?.length) ctx.addIssue({ code: "custom", path: ["body"], message: "Add at least one track or clip." });
    const normalize = (track: Record<string, unknown>, path: (number | string)[]) => {
      const target = track.target as { kind?: string; id?: string } | undefined;
      if (target?.kind === "surface" || target?.kind === "style") {
        if (target.id !== PRESET_TARGET) ctx.addIssue({ code: "custom", path: [...path, "target", "id"], message: `Preset tracks target "${PRESET_TARGET}" (replaced by the layer at apply time).` });
      } else if (target?.kind !== "camera" && target?.kind !== "focus") ctx.addIssue({ code: "custom", path: [...path, "target"], message: "Preset tracks target a layer ($target), its style vars, the camera or focus." });
      const placed = substitute(track, "preset-target");
      if (preset.body.values !== "relative" || MotionTrackSchema.safeParse(placed).success || !Array.isArray(placed.keyframes)) return placed;
      // Validate offset track structure with safe values before a destination supplies the real base.
      for (const value of [1, 0, 1000]) {
        const neutral = { ...placed, keyframes: placed.keyframes.map(frame => frame && typeof frame.value === "number" && Number.isFinite(frame.value) ? { ...frame, value } : frame) };
        if (MotionTrackSchema.safeParse(neutral).success) return neutral;
      }
      return placed;
    };
    const validateClip = (clip: Record<string, unknown>, path: (number | string)[], depth: number): Record<string, unknown> => {
      if (depth > 3 || clip.members !== undefined || clip.stagger !== undefined) {
        ctx.addIssue({ code: "custom", path, message: "Preset clips support up to three nested levels and one $target. Save staggered motion as a template track." });
        return {};
      }
      return { ...clip,
        ...(Array.isArray(clip.tracks) ? { tracks: clip.tracks.map((track, index) => record.safeParse(track).success ? normalize(track, [...path, "tracks", index]) : track) } : {}),
        ...(Array.isArray(clip.clips) ? { clips: clip.clips.map((child, index) => record.safeParse(child).success ? validateClip(child, [...path, "clips", index], depth + 1) : child) } : {}),
      };
    };
    const result = MotionClipSchema.safeParse({ id: "preset", startMs: 0, tracks: preset.body.tracks.map((track, index) => normalize(track, ["body", "tracks", index])),
      clips: preset.body.clips?.map((clip, index) => validateClip(clip, ["body", "clips", index], 1)) });
    if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: ["body", ...issue.path.map(String)], message: issue.message });
  }
  if (preset.kind === "behavior" && !BEHAVIOR_CATALOG.some(entry => entry.id === preset.body.behavior))
    ctx.addIssue({ code: "custom", path: ["body", "behavior"], message: `Unknown behavior. Choose one of: ${BEHAVIOR_CATALOG.map(entry => entry.id).join(", ")}.` });
});
export type Preset = z.output<typeof PresetSchema>;
export type PresetInput = z.input<typeof PresetSchema>;
function allTemplateTracks(body: { tracks?: unknown; clips?: unknown }): Record<string, unknown>[] {
  const tracks = (body.tracks ?? []) as Record<string, unknown>[];
  const clips = (body.clips ?? []) as Record<string, unknown>[];
  return [...tracks, ...clips.flatMap(allTemplateTracks)];
}
function substitute(track: Record<string, unknown>, id: string): Record<string, unknown> {
  const target = track.target as { kind: string; id?: string };
  return target && (target.kind === "surface" || target.kind === "style") && target.id === PRESET_TARGET ? { ...track, target: { ...target, id } } : track;
}
/** What a preset needs: a layer (surface/style tracks), the camera, focus, or an animatable (data behaviors). */
export function presetTargetKind(preset: Preset): "surface" | "camera" | "animatable" | "none" {
  if (preset.kind === "easing") return "none";
  if (preset.kind === "behavior") return BEHAVIOR_CATALOG.find(entry => entry.id === preset.body.behavior)?.target === "animatable" ? "animatable" : "surface";
  return allTemplateTracks(preset.body).some(track => ["surface", "style"].includes((track.target as { kind: string }).kind)) ? "surface" : "camera";
}
export type PresetApplyTarget = { surface: string } | { camera: true } | { animatable: string };
export type PresetApplyResult = { ok: true; clip: MotionClipOutput } | { ok: false; code: "ERR_PRESET_TARGET" | "ERR_PRESET_INVALID"; message: string };
/** Apply a preset to a target at `atMs` (authored): a clip with `source: {preset, version}`. Relative
 * motion adds each track's offsets to `base(track)` (the target's value at apply time; numbers only). */
export function applyPreset(input: unknown, target: PresetApplyTarget, options: { atMs?: number; clipId?: string; base?: (track: { target: { kind: string; id?: string }; property: string }) => number | readonly number[] | undefined } = {}): PresetApplyResult {
  const parsed = PresetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "ERR_PRESET_INVALID", message: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  const preset = parsed.data;
  const kind = presetTargetKind(preset);
  const wants = "surface" in target ? "surface" : "camera" in target ? "camera" : "animatable";
  if (kind === "none") return { ok: false, code: "ERR_PRESET_TARGET", message: `Preset "${preset.id}" holds easing curves; apply them to keyframes from the easing library.` };
  if (kind !== wants) return { ok: false, code: "ERR_PRESET_TARGET", message: `Preset "${preset.id}" animates ${kind === "surface" ? "a layer" : kind === "camera" ? "the camera" : "an animatable"}; it cannot apply to ${wants === "surface" ? "a layer" : wants === "camera" ? "the camera" : "an animatable"}.` };
  const atMs = Math.max(0, options.atMs ?? 0);
  const name = "surface" in target ? target.surface : "animatable" in target ? target.animatable : "camera";
  const clipId = options.clipId ?? `${preset.id}-${name}`.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64);
  const source = { preset: preset.id, version: preset.version, ...(preset.params ? { params: preset.params } : {}) };
  if (preset.kind === "behavior") {
    try {
      const clip = buildBehavior(preset.body.behavior, { ...(preset.body.params ?? {}), startMs: atMs, id: clipId }, target as BehaviorTarget);
      return { ok: true, clip: { ...clip, source } };
    } catch (error) { return { ok: false, code: "ERR_PRESET_TARGET", message: error instanceof Error ? error.message : String(error) }; }
  }
  const body = preset.body as z.output<typeof MotionBodySchema>;
  const placeTrack = (track: Record<string, unknown>, additive: boolean) => {
    const placed = substitute(track, name) as { target: { kind: string; id?: string }; property: string; keyframes: { value: unknown }[] };
    if (body.values !== "relative" || additive) return placed;
    const base = options.base?.(placed);
    return { ...placed, keyframes: placed.keyframes.map(frame => typeof frame.value === "number" && typeof base === "number" ? { ...frame, value: round(frame.value + base) }
      : Array.isArray(frame.value) && Array.isArray(base) ? { ...frame, value: frame.value.map((value, index) => round(value + (base[index] ?? 0))) } : frame) };
  };
  const placeClip = (child: Record<string, unknown>, suffix: string, inheritedAdd: boolean): Record<string, unknown> => {
    const additive = inheritedAdd || child.mode === "add";
    const { source: _source, ...timing } = child;
    return { ...timing, id: `${clipId.slice(0, 63 - suffix.length)}-${suffix}`,
      tracks: ((child.tracks ?? []) as Record<string, unknown>[]).map(track => placeTrack(track, additive)),
      clips: ((child.clips ?? []) as Record<string, unknown>[]).map((entry, index) => placeClip(entry, `${suffix}-${index + 1}`, additive)) };
  };
  const tracks = body.tracks.map(track => placeTrack(track, body.mode === "add"));
  const clips = body.clips?.map((child, index) => placeClip(child, String(index + 1), body.mode === "add"));
  const clip = { id: clipId, label: preset.title.slice(0, 80), startMs: atMs, durationMs: body.durationMs, mode: body.mode, ease: body.ease, tracks, clips, source };
  const checked = MotionClipSchema.safeParse(clip);
  if (!checked.success) return { ok: false, code: "ERR_PRESET_TARGET", message: checked.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  return { ok: true, clip: checked.data };
}
const round = (value: number) => Math.round(value * 10_000) / 10_000;
type PresetMeta = { id: string; title: string; description?: string; values?: "absolute" | "relative" };
type TrackTemplate = { target: { kind: string; id?: string }; property: string; keyframes: { timeMs: number; value: unknown }[] };
function portableTrack(track: TrackTemplate, relative: boolean, start: number) {
  const first = track.keyframes[0]?.value;
  return { ...track,
    target: track.target.kind === "surface" || track.target.kind === "style" ? { kind: track.target.kind, id: PRESET_TARGET } : { ...track.target },
    keyframes: track.keyframes.map(frame => ({ ...frame, timeMs: frame.timeMs - start,
      value: relative && typeof frame.value === "number" && typeof first === "number" ? round(frame.value - first)
        : relative && Array.isArray(frame.value) && Array.isArray(first) ? frame.value.map((value, index) => round(value - first[index])) : frame.value })),
  };
}
function requireOneTarget(tracks: readonly TrackTemplate[]) {
  const ids = new Set(tracks.map(track => track.target.id).filter(Boolean));
  if (ids.size > 1) throw new Error("A motion preset holds one layer's tracks; select tracks of a single layer.");
}
/** Save tracks of one layer (or the camera) as a motion preset: times shift so the first key is 0, the
 * layer id becomes `$target`, and relative numeric values become offsets from each track's first value. */
export function presetFromTracks(tracks: readonly TrackTemplate[], meta: PresetMeta): Preset {
  if (!tracks.length) throw new Error("Select at least one track to save as a preset.");
  requireOneTarget(tracks);
  const start = Math.min(...tracks.flatMap(track => track.keyframes.map(frame => frame.timeMs)));
  const values = meta.values ?? "relative";
  const body = {
    values,
    durationMs: Math.max(1, Math.max(...tracks.flatMap(track => track.keyframes.map(frame => frame.timeMs))) - start),
    tracks: tracks.map(track => portableTrack(track, values === "relative", start)),
  };
  return PresetSchema.parse({ version: 1, id: meta.id, title: meta.title, ...(meta.description ? { description: meta.description } : {}), kind: "motion", body });
}
export function presetFromClip(clip: MotionClipInput, meta: PresetMeta): Preset {
  requireOneTarget(allTemplateTracks(clip) as TrackTemplate[]);
  const values = meta.values ?? "relative";
  const portable = (entry: MotionClipInput, inheritedAdd: boolean): Record<string, unknown> => {
    const { source: _source, tracks, clips, ...timing } = entry;
    const additive = inheritedAdd || entry.mode === "add";
    return { ...timing, tracks: tracks?.map(track => portableTrack(track, values === "relative" && !additive, 0)), clips: clips?.map(child => portable(child, additive)) };
  };
  return PresetSchema.parse({ version: 1, id: meta.id, title: meta.title, description: meta.description, kind: "motion", body: { values, clips: [portable({ ...clip, startMs: 0 }, false)] } });
}
export const PRESET_INTENSITIES = BEHAVIOR_INTENSITIES;
