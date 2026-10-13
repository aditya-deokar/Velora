import { z } from "zod";
import { AssetIdSchema, AssetTypeSchema, resolveAssetId, type DiscoveredAsset } from "./assets";
import { AudioTrackSchema } from "./audio";
import { ExportFrameRateSchema } from "./export";
import { SceneRecipeIdSchema, type SceneCatalog } from "./recipes";
import { SegmentTransitionSchema } from "./transitions";

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
  transition: SegmentTransitionSchema.optional(),
});
export type CompositionScene = z.output<typeof CompositionSceneSchema>;
export const CompositionAssetSchema = z.strictObject({
  id: AssetIdSchema,
  path: z.string().min(1),
  type: AssetTypeSchema,
});
export type CompositionAsset = z.output<typeof CompositionAssetSchema>;
export const CompositionCaptionsSchema = z.strictObject({
  file: z.string().min(1),
  burnIn: z.boolean().default(false),
});
export type CompositionCaptions = z.output<typeof CompositionCaptionsSchema>;
export const CompositionSchema = z.strictObject({
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
}).superRefine((composition, ctx) => {
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
  return { resolved: { scenes, assets: resolvedAssets }, totals: compositionTotals(composition), issues };
}
