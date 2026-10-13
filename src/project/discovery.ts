import {RESOURCES} from "../core/resources";
import { SCENE_RECIPE_DIRECTORY, type SceneCatalog } from "../core/recipes";
import {
  ASSETS_DIRECTORY, ASSET_MANIFEST, MAX_ASSETS,
  assetIdFromFilename, sniffAssetType, validateAssetManifest,
  type DiscoveredAsset,
} from "../core/assets";
import {
  COMPOSITION_FILE_SUFFIX, CompositionSchema, type Composition,
} from "../core/composition";
import type { SceneIssue } from "../core/scene";
import * as services from "./services";
/** SOURCE OF TRUTH: discoverRecipes, discoverAssets, discoverSharedComponents, loadComposition, scoped source loading.
 * WHAT: read bounded recipe, asset, component and composition files and validate through RESOURCES and core schemas.
 * WHY: CLI and framework catalog generators share exactly one discovery policy.
 * WHERE: recipes and project commands call these operations; services owns all effects.
 */
function diagnostic(error: unknown, target = ""): SceneIssue {
  const known = error instanceof Error && "code" in error && "target" in error;
  return { path: known && typeof error.target === "string" ? error.target : target,
    message: known ? error.message : "Unable to read the local scene source. Check files and permissions, then retry." };
}
export async function discoverRecipes(root: string, sceneId?: string): Promise<SceneCatalog> {
  const paths = await services.scanDirectory(root, SCENE_RECIPE_DIRECTORY, 256);
  const sources: { path: string; document: unknown }[] = [];
  const bindingPaths: string[] = [];
  const issues: SceneIssue[] = [];
  for (const path of paths) {
    if (/\.[jt]sx$/.test(path)) {
      try { if (await services.isRegularFile(root, path)) bindingPaths.push(path); }
      catch (error) { issues.push(diagnostic(error, path)); }
    } else if (path.endsWith(".scene.json")) {
      try {
        const text = await services.readText(root, path, 256_000);
        if (text === undefined) {
          issues.push({ path, message: "Recipe disappeared during discovery. Restore it or refresh the scene list." });
          continue;
        }
        let document: unknown;
        try { document = JSON.parse(text); }
        catch {
          issues.push({ path, message: "Invalid recipe JSON. Correct its syntax and reload the scene list." });
          continue;
        }
        sources.push({ path, document });
      } catch (error) { issues.push(diagnostic(error, path)); }
    }
  }
  const catalog = RESOURCES["resolve-recipes"]({ sources, bindingPaths, ...(sceneId === undefined ? {} : { sceneId }) });
  return { ...catalog, issues: [...issues, ...catalog.issues].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
}
export type AssetDiscovery = {
  assets: DiscoveredAsset[];
  manifest: { present: boolean; aliases: Record<string, string> };
  issues: { code: string; path: string; message: string }[];
};
// File-based asset discovery: every regular file directly inside assets/ is
// one asset whose ID is its filename stem. An optional assets/assets.json
// manifest adds explicit ID aliases; it never invents files.
export async function discoverAssets(root: string): Promise<AssetDiscovery> {
  const issues: { code: string; path: string; message: string }[] = [];
  const assets: DiscoveredAsset[] = [];
  let entries: string[] = [];
  try {
    entries = await services.scanDirectory(root, ASSETS_DIRECTORY, MAX_ASSETS);
  } catch (error) {
    const known = error instanceof Error && "code" in error && "target" in error;
    issues.push({ code: known ? String(error.code) : "project-error",
      path: ASSETS_DIRECTORY, message: known ? error.message : "Unable to read the assets directory." });
    return { assets, manifest: { present: false, aliases: {} }, issues };
  }
  for (const entry of entries) {
    const base = entry.split("/").pop() ?? entry;
    if (entry === ASSET_MANIFEST || base.startsWith(".")) continue;
    try {
      if (!await services.isRegularFile(root, entry)) continue;
      const stat = await services.statFile(root, entry);
      if (!stat) continue;
      const head = await services.peekBytes(root, entry, 4096);
      if (head === undefined) continue;
      assets.push({ id: assetIdFromFilename(base), path: entry, type: sniffAssetType(base, head), bytes: stat.bytes });
    } catch (error) {
      const known = error instanceof Error && "code" in error && "target" in error;
      issues.push({ code: known ? String(error.code) : "project-error",
        path: entry, message: known ? error.message : "Unable to read this asset file." });
    }
  }
  assets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  let manifest: { present: boolean; aliases: Record<string, string> } = { present: false, aliases: {} };
  try {
    const text = await services.readText(root, ASSET_MANIFEST, 256_000);
    if (text !== undefined) {
      manifest = { present: true, aliases: {} };
      let document: unknown;
      try { document = JSON.parse(text); }
      catch { issues.push({ code: "invalid-file", path: ASSET_MANIFEST, message: "Invalid manifest JSON. Correct its syntax." }); }
      if (document !== undefined) {
        const validated = validateAssetManifest(document);
        manifest = { present: true, aliases: validated.aliases };
        issues.push(...validated.issues);
      }
    }
  } catch (error) {
    const known = error instanceof Error && "code" in error && "target" in error;
    issues.push({ code: known ? String(error.code) : "project-error",
      path: ASSET_MANIFEST, message: known ? error.message : "Unable to read the asset manifest." });
  }
  return { assets, manifest, issues };
}
export const SHARED_COMPONENTS_DIRECTORY = "src/flute/components";
// Reusable Surface wrappers live beside discovery, never inside it: helpers
// stay out of src/flute/scenes so the recipe glob cannot mistake them for scenes.
export async function discoverSharedComponents(root: string): Promise<string[]> {
  const entries = await services.scanDirectory(root, SHARED_COMPONENTS_DIRECTORY, 256);
  const components: string[] = [];
  for (const entry of entries) {
    if (!/\.[jt]sx$/.test(entry)) continue;
    try { if (await services.isRegularFile(root, entry)) components.push(entry); }
    catch { continue; }
  }
  return components.sort();
}
// Load and schema-validate one *.composition.json file. Returns coded issues;
// callers resolve IDs against the catalog through resolveCompositionSpec.
export async function loadComposition(root: string, file: string): Promise<{ composition: Composition } | { issues: { code: string; path: string; message: string }[] }> {
  if (!file.endsWith(COMPOSITION_FILE_SUFFIX))
    return { issues: [{ code: "ERR_COMPOSITION_INVALID", path: "composition", message: `Use a *${COMPOSITION_FILE_SUFFIX} file. Got ${file}.` }] };
  let text: string | undefined;
  try {
    text = await services.readText(root, file, 256_000);
  } catch (error) {
    const known = error instanceof Error && "code" in error && "target" in error;
    return { issues: [{ code: known ? String(error.code) : "project-error", path: file, message: known ? error.message : "Unable to read the composition file." }] };
  }
  if (text === undefined)
    return { issues: [{ code: "ERR_COMPOSITION_INVALID", path: file, message: `Composition file ${file} was not found.` }] };
  let document: unknown;
  try { document = JSON.parse(text); }
  catch {
    return { issues: [{ code: "ERR_COMPOSITION_INVALID", path: file, message: `Invalid composition JSON in ${file}. Correct its syntax.` }] };
  }
  const parsed = CompositionSchema.safeParse(document);
  if (!parsed.success)
    return { issues: parsed.error.issues.map((issue) => ({ code: "ERR_COMPOSITION_INVALID", path: `composition.${issue.path.join(".")}`, message: issue.message })) };
  return { composition: parsed.data };
}
