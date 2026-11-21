import { LookSchema } from "./looks";
import { z } from "zod";
import { AssetIdSchema, AssetTypeSchema, resolveAssetId, type DiscoveredAsset } from "./assets";
import { AudioTrackSchema } from "./audio";
import { ExportFrameRateSchema } from "./export";
import { SceneRecipeIdSchema, sceneMetadata, type BoundRecipe, type SceneCatalog } from "./recipes";
import { SegmentTransitionSchema } from "./transitions";
import { LoudnessSchema, SfxEntrySchema } from "./sound";
import { timelineFromComposition, validateTimeline } from "./timeline";

/** SOURCE OF TRUTH: CompositionSchema, composition resolution and totals.
 * WHAT: versioned multi-scene composition files plus pure resolution against a validated catalog.
 * WHY: agents plan a whole video from one machine-readable file before generating any scene source.
 * WHERE: project/discovery loads the file; project/commands resolves it for inspect and validate.
 * A composition never embeds React elements, credentials or records — only IDs, paths and timings.
 */
export const COMPOSITION_FILE_SUFFIX = ".composition.json";
export const MAX_COMPOSITION_SCENES = 256;
export const MAX_ASSETS_IN_COMPOSITION = 256;
export const CompositionSlugSchema = SceneRecipeIdSchema;
export const CompositionSceneSchema = z.strictObject({
  id: z.string().min(1).max(128),
  recipe: SceneRecipeIdSchema,
  startMs: z.number().finite().nonnegative().max(120_000),
  durationMs: z.number().finite().positive().max(120_000),
  inMs: z.number().finite().nonnegative().max(120_000).optional(),
  transition: SegmentTransitionSchema.optional(),
});
export type CompositionScene = z.output<typeof CompositionSceneSchema>;
export const CompositionAssetSchema = z.strictObject({
  id: AssetIdSchema,
  path: z.string().min(1),
  type: AssetTypeSchema,
});
export type CompositionAsset = z.output<typeof CompositionAssetSchema>;
export const CaptionStyleSchema = z.enum(["burn", "minimal", "karaoke", "bold-pop", "lower"]);
export const CompositionCaptionsSchema = z.strictObject({
  file: z.string().min(1),
  burnIn: z.boolean().default(false),
  // DOM styles render through kit CaptionTrack as an overlay over the picture; "burn" is the FFmpeg path.
  style: CaptionStyleSchema.optional(),
  // Optional per-word timing ({ words: [{ text, startMs, endMs }] }); otherwise words spread by length.
  wordsFile: z.string().min(1).optional(),
});
// V2/V3: scenes rendered with transparent capture on their own local time, alpha-composited over V1 in order.
export const CompositionOverlaySchema = z.strictObject({
  id: z.string().min(1).max(128),
  recipe: SceneRecipeIdSchema,
  startMs: z.number().finite().nonnegative().max(120_000),
  durationMs: z.number().finite().positive().max(120_000),
  inMs: z.number().finite().nonnegative().max(120_000).optional(),
  opacity: z.number().finite().min(0).max(1).default(1),
  blend: z.enum(["normal", "screen", "multiply"]).default("normal"),
});
export type CompositionOverlay = z.output<typeof CompositionOverlaySchema>;
export const CompositionMarkerSchema = z.strictObject({
  atMs: z.number().finite().nonnegative().max(120_000),
  label: z.string().max(80).default(""),
  kind: z.enum(["beat", "downbeat", "cue", "section"]).default("cue"),
});
export type CompositionCaptions = z.output<typeof CompositionCaptionsSchema>;
export const CompositionSchema = z.strictObject({
  // Editor autocomplete: points at the JSON Schema shipped in the package's schemas/ directory.
  $schema: z.string().max(512).optional(),
  version: z.literal(1),
  id: CompositionSlugSchema,
  title: z.string().trim().min(1).max(200),
  width: z.number().int().min(64).max(3840).multipleOf(2),
  height: z.number().int().min(64).max(3840).multipleOf(2),
  fps: ExportFrameRateSchema.default(30),
  scenes: z.array(CompositionSceneSchema).min(1).max(MAX_COMPOSITION_SCENES),
  assets: z.array(CompositionAssetSchema).max(MAX_ASSETS_IN_COMPOSITION).default([]),
  audio: z.array(AudioTrackSchema).max(16).default([]),
  captions: CompositionCaptionsSchema.optional(),
  seed: z.number().int().nonnegative().max(4_294_967_295).default(0),
  // Default look for scenes that declare none.
  look: LookSchema.optional(),
  overlays: z.array(CompositionOverlaySchema).max(64).default([]),
  markers: z.array(CompositionMarkerSchema).max(4096).default([]),
  sfx: z.array(SfxEntrySchema).max(256).default([]),
  // Two-pass loudness normalization of the mix (false leaves levels untouched).
  loudness: z.union([LoudnessSchema, z.literal(false)]).optional(),
}).superRefine((composition, ctx) => {
  const seenOverlays = new Set<string>();
  for (const [index, overlay] of composition.overlays.entries()) {
    if (seenOverlays.has(overlay.id) || composition.scenes.some(scene => scene.id === overlay.id))
      ctx.addIssue({ code: "custom", path: ["overlays", index, "id"], message: `Duplicate track ID "${overlay.id}". Overlay IDs must differ from each other and from scene IDs.` });
    seenOverlays.add(overlay.id);
  }
  const seenScenes = new Set<string>();
  for (const [index, segment] of composition.scenes.entries()) {
    if (seenScenes.has(segment.id))
      ctx.addIssue({ code: "custom", path: ["scenes", index, "id"], message: `Duplicate segment ID "${segment.id}". Give each timeline segment a unique ID.` });
    seenScenes.add(segment.id);
  }
  const seenAssets = new Set<string>();
  for (const [index, asset] of composition.assets.entries()) {
    if (seenAssets.has(asset.id))
      ctx.addIssue({ code: "custom", path: ["assets", index, "id"], message: `Duplicate asset ID "${asset.id}". Declare each asset once.` });
    seenAssets.add(asset.id);
  }
  const seenTracks = new Set<string>();
  for (const [index, track] of composition.audio.entries()) {
    if (seenTracks.has(track.id))
      ctx.addIssue({ code: "custom", path: ["audio", index, "id"], message: `Duplicate audio track ID "${track.id}". Declare each track once.` });
    seenTracks.add(track.id);
  }
});
export type Composition = z.output<typeof CompositionSchema>;

// Derived timeline totals. Phase 03 owns overlap/gap policy; Phase 02 only
// reports the span so agents can plan before orchestration exists.
export function compositionTotals(composition: Composition): { durationMs: number; scenes: number; assets: number } {
  return {
    durationMs: composition.scenes.reduce((total, segment) => Math.max(total, segment.startMs + segment.durationMs), 0),
    scenes: composition.scenes.length,
    assets: composition.assets.length,
  };
}
export type ResolvedCompositionScene = CompositionScene & { title: string; nodeCount: number };
export type ResolvedCompositionAsset = CompositionAsset & { bytes: number };
export type CompositionIssue = { code: string; path: string; message: string };
export function compositionSourceRanges(composition: Pick<Composition, "scenes" | "overlays">, catalog: { scenes: readonly BoundRecipe[] }): CompositionIssue[] {
  const durations = new Map(catalog.scenes.map(scene => [scene.id, sceneMetadata(scene).durationMs]));
  return (["scenes", "overlays"] as const).flatMap(lane => composition[lane].flatMap((clip, index) => {
    const duration = durations.get(clip.recipe);
    const end = (clip.inMs ?? 0) + clip.durationMs;
    // Untimed recipes are stills and can fill stretches of any length.
    return duration !== undefined && duration > 0 && end > duration + 0.000001
      ? [{ code: "ERR_COMPOSITION_SOURCE_RANGE", path: `composition.${lane}.${index}`, message: `“${clip.id}” uses ${Number(end.toFixed(3))} ms of “${clip.recipe}”, which lasts ${Number(duration.toFixed(3))} ms.` }]
      : [];
  }));
}
// Pure resolution: match every segment recipe against the validated catalog
// and every asset declaration against discovered assets plus manifest aliases.
// Never reads files or executes components.
export function resolveCompositionSpec(
  composition: Composition,
  catalog: Pick<SceneCatalog, "scenes">,
  assets: readonly DiscoveredAsset[],
  aliases: Readonly<Record<string, string>>,
): { resolved: { scenes: ResolvedCompositionScene[]; assets: ResolvedCompositionAsset[] }; totals: { durationMs: number; scenes: number; assets: number }; issues: CompositionIssue[] } {
  const issues: CompositionIssue[] = [];
  const scenes: ResolvedCompositionScene[] = [];
  for (const [index, segment] of composition.scenes.entries()) {
    const recipe = catalog.scenes.find((scene) => scene.id === segment.recipe);
    if (!recipe) {
      issues.push({ code: "ERR_SCENE_NOT_FOUND", path: `composition.scenes.${index}.recipe`, message: `Recipe "${segment.recipe}" is not in the validated catalog. Run velora scenes --json to list available IDs.` });
      continue;
    }
    scenes.push({ ...segment, title: recipe.title, nodeCount: recipe.definition.scene.nodes.length });
  }
  for (const [index, overlay] of composition.overlays.entries())
    if (!catalog.scenes.some((scene) => scene.id === overlay.recipe))
      issues.push({ code: "ERR_SCENE_NOT_FOUND", path: `composition.overlays.${index}.recipe`, message: `Overlay recipe "${overlay.recipe}" is not in the validated catalog. Run velora scenes --json to list available IDs.` });
  const resolvedAssets: ResolvedCompositionAsset[] = [];
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  for (const [index, declared] of composition.assets.entries()) {
    const resolvedPath = resolveAssetId(assets, aliases, declared.id);
    if (!resolvedPath) {
      issues.push({ code: "ERR_ASSET_NOT_FOUND", path: `composition.assets.${index}.id`, message: `Asset "${declared.id}" was not discovered. Run velora assets ls --json to list available IDs.` });
      continue;
    }
    if (resolvedPath !== declared.path) {
      issues.push({ code: "ERR_ASSET_NOT_FOUND", path: `composition.assets.${index}.path`, message: `Asset "${declared.id}" resolves to ${resolvedPath}, not ${declared.path}.` });
      continue;
    }
    const discovered = byPath.get(resolvedPath);
    if (!discovered) {
      issues.push({ code: "ERR_ASSET_NOT_FOUND", path: `composition.assets.${index}.path`, message: `Asset file ${resolvedPath} is not on disk. Restore it and retry.` });
      continue;
    }
    if (discovered.type !== declared.type) {
      issues.push({ code: "ERR_ASSET_UNSUPPORTED", path: `composition.assets.${index}.type`, message: `Asset "${declared.id}" is ${discovered.type}, not ${declared.type}.` });
      continue;
    }
    resolvedAssets.push({ ...declared, bytes: discovered.bytes });
  }
  // The timeline gate render applies (overlaps, transition windows) runs here too, so validate fails first.
  for (const issue of validateTimeline(timelineFromComposition(composition)).issues)
    issues.push({ ...issue, path: issue.path.replace(/^timeline\.segments\./, "composition.scenes.") });
  return { resolved: { scenes, assets: resolvedAssets }, totals: compositionTotals(composition), issues };
}
