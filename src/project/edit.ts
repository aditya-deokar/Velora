import { z } from "zod";
import { applyEdits, describeOp, lineDiff, parseTrackShorthand, type EditOp, type EditIssue, type TrackAddress } from "../core/edit";
import { formatJsonDocument, parseJsonDocument } from "../core/json";
import { SceneRecipeIdSchema, SCENE_RECIPE_DIRECTORY } from "../core/recipes";
import { MotionSchema, clipTiming, evaluateMotion } from "../core/motion";
import { CameraSchema, FocusSchema, TransformSchema } from "../core/scene";
import { parseClipboard, pasteOps } from "../core/clipboard";
import { normalizeIssue, nextForIssues, type CliIssue } from "../core/cli-schema";
import * as services from "./services";
import { startEditBridge, createBridgeToken, watchProjectFiles, BridgeStartError, BRIDGE_MAX_BODY_BYTES, type BridgeServer, type BridgeReply } from "./services/bridge";
import { executeProjectCommand } from "./commands";
import { discoverPresets, PRESET_DIRECTORY } from "./discovery";
import { PresetSchema, applyPreset, presetFromTracks, presetTargetKind, type Preset } from "../core/presets";
import { loadSourceOutlines, prepareSourceEdit, recoverSourceTransaction, sourceBridgeHandlers, writeSourceTransaction } from "./source-edit";

/** SOURCE OF TRUTH: executeEditCommand.
 * WHAT: velora edit (ls, apply, key, ease and the edit bridge): read a scene recipe, apply EditOp batches
 * through core applyEdits, show a diff (dry run by default) and write with compare-and-swap only on --write;
 * the bridge serves the studio editor with the same policy.
 * WHY: one write policy for agents and the editor: only allowed project files, no second validator, minimal
 * formatting-preserving diffs, conflict detection by SHA-256, exact undo and an audit trail.
 * WHERE: cli/index parses flags; core/edit and core/json own the reducer and writer; services own file I/O
 * (scoped paths, atomic writes); services/bridge owns the loopback transport and watcher.
 */
export type EditOperation = "ls" | "apply" | "key" | "ease" | "paste" | "bridge" | "preset" | "source";
export type EditCommandResult =
  | { success: true; command: "edit"; data: Record<string, unknown>; warnings?: CliIssue[]; next?: string[]; server?: BridgeServer }
  | { success: false; command: "edit"; issues: CliIssue[]; next: string[] };
const failure = (issues: { code: string; message: string; path?: string; hint?: string }[]): EditCommandResult => {
  const normalized = issues.map(issue => normalizeIssue(issue));
  return { success: false, command: "edit", issues: normalized, next: nextForIssues(normalized) };
};
const scenePath = (id: string) => `${SCENE_RECIPE_DIRECTORY}/${id}.scene.json`;
const EditInputSchema = z.strictObject({
  sourceAction: z.enum(["outline", "wrap", "group", "expose"]).optional(),
  file: z.string().max(1200).optional(),
  node: z.string().optional(),
  nodes: z.array(z.string()).optional(),
  sourceId: z.string().optional(),
  content: z.boolean().optional(),
  prop: z.string().optional(),
  enumOptions: z.array(z.string()).optional(),
  expectRecipeSha: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  scene: z.string().optional(),
  at: z.number().finite().nonnegative().optional(),
  ops: z.string().optional(),
  opsText: z.string().max(BRIDGE_MAX_BODY_BYTES).optional(),
  expectSha: z.string().regex(/^[0-9a-f]{64}$/, "Use the 64-character hex sha256 printed by a previous command.").optional(),
  write: z.boolean().optional(),
  track: z.string().optional(),
  value: z.string().optional(),
  ease: z.string().optional(),
  label: z.string().max(200).optional(),
  from: z.string().optional(),
  onto: z.string().min(1).max(128).optional(),
  // Presets (velora edit preset ls|show|save|apply)
  action: z.enum(["ls", "show", "save", "apply"]).optional(),
  preset: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a kebab-case preset id.").max(64).optional(),
  to: z.string().min(1).max(128).optional(),
  layer: z.string().min(1).max(128).optional(),
  title: z.string().min(1).max(80).optional(),
  values: z.enum(["absolute", "relative"]).optional(),
  // Bridge
  port: z.number().int().min(0).max(65535).optional(),
  readOnly: z.boolean().optional(),
  launch: z.boolean().optional(),
  url: z.string().optional(),
});
export type EditInput = z.input<typeof EditInputSchema>;
async function readScene(root: string, id: string): Promise<{ target: string; text: string; sha: string } | EditCommandResult> {
  if (!SceneRecipeIdSchema.safeParse(id).success) return failure([{ code: "ERR_EDIT_TARGET", path: "scene", message: `"${id}" is not a scene id (lowercase slug).` }]);
  const target = scenePath(id);
  const text = await services.readText(root, target);
  if (text === undefined) return failure([{ code: "ERR_SCENE_NOT_FOUND", path: "scene", message: `No recipe ${target}.` }]);
  return { target, text, sha: services.textSha256(text) };
}
const editIssues = (issues: EditIssue[]) => failure(issues.map(issue => ({ code: issue.code, path: issue.path, message: issue.message, ...(issue.hint ? { hint: issue.hint } : {}) })));
/** Parse a CLI value: a number, a JSON vector/object, or a plain string (a color). */
function parseValue(text: string): unknown {
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())) return Number(text);
  if (/^[[{"]/.test(text.trim())) { try { return JSON.parse(text); } catch { /* fall through */ } }
  return text;
}
function parseEasing(text: string): unknown {
  return /^[{"]/.test(text.trim()) ? (() => { try { return JSON.parse(text); } catch { return text; } })() : text;
}
/** Apply a batch to a scene: dry run (diff) unless write; compare-and-swap against the read SHA. */
async function editScene(root: string, id: string, ops: unknown, options: { write: boolean; expectSha?: string; label?: string }): Promise<EditCommandResult> {
  const read = await readScene(root, id);
  if ("success" in read) return read;
  if (options.expectSha && options.expectSha !== read.sha)
    return failure([{ code: "ERR_EDIT_CONFLICT", path: "scene", message: `${read.target} changed (sha ${read.sha.slice(0, 12)}…, expected ${options.expectSha.slice(0, 12)}…). Re-read it, then apply again.` }]);
  let document: unknown;
  try { document = parseJsonDocument(read.text); } catch { return failure([{ code: "ERR_SCENE_INVALID", path: read.target, message: "The recipe is not valid JSON." }]); }
  const result = applyEdits(document, ops);
  if (!result.ok) return editIssues(result.issues);
  const next = formatJsonDocument(read.text, result.recipe);
  const labels = (ops as EditOp[]).map(op => describeOp(op));
  const data = { scene: id, path: read.target, sha: read.sha, nextSha: services.textSha256(next), written: false, labels, diff: lineDiff(read.text, next), touched: result.touched, inverse: result.inverse };
  if (!options.write || next === read.text) return { success: true, command: "edit", data: { ...data, written: false },
    next: options.write ? [] : [`velora edit apply --scene ${id} --ops <file> --expect-sha ${read.sha} --write --json`] };
  try { await services.atomicWrite(root, read.target, next, read.text); }
  catch (error) {
    if ((error as { code?: string }).code === "conflict") return failure([{ code: "ERR_EDIT_CONFLICT", path: read.target, message: `${read.target} changed while writing; re-read it and apply again.` }]);
    throw error;
  }
  return { success: true, command: "edit", data: { ...data, written: true }, next: [`velora edit ls --scene ${id} --json`] };
}
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function listing(recipe: Doc, at: number | undefined) {
  const describe = (track: Doc, clip?: string) => ({
    track: { target: track.target, property: track.property, ...(clip ? { clip } : {}) },
    keyframes: (track.keyframes as Doc[]).map(frame => ({ atMs: frame.timeMs, value: frame.value, ...(frame.easing !== undefined ? { easing: frame.easing } : {}) })),
    ...Object.fromEntries(["interpolation", "ease", "noise", "unit", "rove", "orient"].filter(key => track[key] !== undefined).map(key => [key, track[key]])),
  });
  const motion = recipe.definition?.motion;
  const clips: Doc[] = [];
  const tracks: unknown[] = (motion?.tracks ?? []).map((track: Doc) => describe(track));
  const visit = (list: Doc[] | undefined, parent?: string) => {
    for (const clip of list ?? []) {
      clips.push({ id: clip.id, ...(parent ? { parent } : {}), ...Object.fromEntries(Object.entries(clip).filter(([key]) => !["id", "tracks", "clips"].includes(key))), tracks: (clip.tracks ?? []).length });
      for (const track of clip.tracks ?? []) tracks.push(describe(track, clip.id));
      visit(clip.clips, clip.id);
    }
  };
  visit(motion?.clips);
  return {
    durationMs: motion?.durationMs ?? 0, nodes: (recipe.definition?.scene?.nodes ?? []).map((node: Doc) => node.id),
    tracks, clips, links: motion?.links ?? [], constraints: recipe.definition?.scene?.constraints ?? [],
    ...(at !== undefined && motion ? { at, values: (({ issues, ...state }) => ({ ...state, ...(issues.length ? { issues } : {}) }))(evaluateMotion(motion, at)) } : {}),
  };
}

/** The editor URL: the verified studio route plus scene, edit flag, and the bridge in the fragment
 * (fragments never reach servers or logs). */
const presetPath = (id: string) => `${PRESET_DIRECTORY}/${id}.preset.json`;
async function readPreset(root: string, id: string): Promise<{ text: string; sha: string; preset: Preset } | EditCommandResult> {
  const text = await services.readText(root, presetPath(id), 1_000_000);
  if (text === undefined) return failure([{ code: "ERR_PRESET_NOT_FOUND", path: "preset", message: `No preset ${presetPath(id)}.`, hint: "List presets with velora edit preset ls --json." }]);
  let value: unknown;
  try { value = parseJsonDocument(text); } catch { return failure([{ code: "ERR_PRESET_INVALID", path: presetPath(id), message: "The preset is not valid JSON." }]); }
  const parsed = PresetSchema.safeParse(value);
  if (!parsed.success) return failure(parsed.error.issues.map(issue => ({ code: "ERR_PRESET_INVALID", path: issue.path.join("."), message: issue.message })));
  return { text, sha: services.textSha256(text), preset: parsed.data };
}
/** The value a relative preset builds on: the target property's evaluated value at atMs (authored), else its rest value. */
function restBase(recipe: Doc, atMs: number) {
  const { motion, scene } = recipe.definition;
  const parsed = MotionSchema.safeParse(motion);
  const state = parsed.success ? evaluateMotion(parsed.data, atMs / parsed.data.speed) : undefined;
  const camera = CameraSchema.parse(scene.camera ?? {}), focus = FocusSchema.parse(scene.focus ?? {});
  return ({ target, property }: { target: { kind: string; id?: string }; property: string }): number | number[] | undefined => {
    const read = (key: string) => {
      if (target.kind === "camera") return ((state?.camera as Record<string, number> | undefined)?.[key] ?? (camera as Record<string, number>)[key]) + (state?.additive?.camera?.[key] ?? 0);
      if (target.kind === "focus") return ((state?.focus as Record<string, number> | undefined)?.[key] ?? (focus as Record<string, number>)[key]) + (state?.additive?.focus?.[key] ?? 0);
      if (target.kind === "surface" && target.id) {
        const base = TransformSchema.parse(scene.nodes.find((node: Doc) => node.id === target.id)?.transform ?? {}) as Record<string, number>;
        const rest = ["opacity", "brightness", "contrast", "saturate"].includes(key) ? 1 : key === "clipRadius" ? 150 : 0;
        return ((state?.surfaces[target.id] as Record<string, number> | undefined)?.[key] ?? base[key] ?? rest) + (state?.additive?.surfaces?.[target.id]?.[key] ?? 0);
      }
      if (target.kind === "style" && target.id) {
        const style = state?.styles?.[target.id]?.[key];
        return typeof style === "number" ? style : undefined;
      }
    };
    return property === "position" ? ["x", "y", "z"].map(key => read(key) ?? 0) : read(property);
  };
}
/** Preset write policy shared by the CLI and the bridge: create (expected undefined) or compare-and-swap. */
async function writePresetFile(root: string, preset: Preset, expectSha: string | undefined | null): Promise<{ ok: true; sha: string; text: string } | { ok: false; status: number; body: Record<string, unknown> }> {
  const current = await services.readText(root, presetPath(preset.id), 1_000_000);
  const currentSha = current === undefined ? null : services.textSha256(current);
  if ((expectSha ?? null) !== currentSha) return { ok: false, status: 409, body: { sha: currentSha, ...(current !== undefined ? { text: current } : {}) } };
  const text = current === undefined ? JSON.stringify(preset, null, 2) + "\n" : formatJsonDocument(current, preset);
  await services.atomicWrite(root, presetPath(preset.id), text, current);
  return { ok: true, sha: services.textSha256(text), text };
}
export function editorUrl(previewUrl: string, scene: string | undefined, port: number, token: string): string {
  const url = new URL(previewUrl);
  if (scene) url.searchParams.set("velora-scene", scene);
  url.searchParams.set("velora-edit", "1");
  return `${url.href}#velora-bridge=${port}.${token}`;
}
/** Start the bridge for an allowed origin with the scene policy; used by velora edit and velora studio --edit. */
export async function startSceneBridge(root: string, options: { origin: string; port?: number; readOnly: boolean; version: string; projectId?: string; source?: boolean; log?: (entry: Record<string, unknown>) => void }) {
  if (options.source !== false && !options.readOnly) await recoverSourceTransaction(root);
  const token = createBridgeToken();
  let broadcast: BridgeServer["broadcast"] | undefined;
  const sourceHandlers = options.source === false ? {} : sourceBridgeHandlers(root, paths => {
    options.log?.({ event: "source-write", paths });
    broadcast?.("source-changed", { paths });
  });
  // Recent revisions per scene: a batch whose result equals one of them (undo) writes that text verbatim.
  const history = new Map<string, string[]>();
  const remember = (id: string, text: string) => { const list = history.get(id) ?? []; list.unshift(text); history.set(id, list.slice(0, 64)); };
  const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const handlers = {
    hello: () => ({ protocol: 1, version: options.version, ...(options.projectId ? { projectId: options.projectId } : {}), readOnly: options.readOnly,
      capabilities: ["scenes", "edits", "events", "presets", ...(options.source === false ? [] : ["source"])], fileKinds: ["scene", "preset", ...(options.source === false ? [] : ["source"]) ] }),
    async listPresets(): Promise<BridgeReply> {
      return { status: 200, body: { presets: await discoverPresets(root) } };
    },
    async readPreset(id: string): Promise<BridgeReply> {
      const read = await readPreset(root, id);
      if ("success" in read) { const issues = read.success ? [] : read.issues; return { status: issues[0]?.code === "ERR_PRESET_NOT_FOUND" ? 404 : 422, body: { issues } }; }
      return { status: 200, body: { text: read.text, sha256: read.sha, preset: read.preset } };
    },
    async writePreset(id: string, body: unknown): Promise<BridgeReply> {
      const request = z.strictObject({ baseSha: z.union([z.string().regex(/^[0-9a-f]{64}$/), z.null()]), preset: z.unknown() }).safeParse(body);
      if (!request.success) return { status: 422, body: { issues: [{ code: "ERR_PRESET_INVALID", message: "Send {baseSha (null to create), preset}." }] } };
      const parsed = PresetSchema.safeParse(request.data.preset);
      if (!parsed.success) return { status: 422, body: { issues: parsed.error.issues.map(issue => ({ code: "ERR_PRESET_INVALID", path: issue.path.join("."), message: issue.message })) } };
      if (parsed.data.id !== id) return { status: 422, body: { issues: [{ code: "ERR_PRESET_INVALID", path: "id", message: "The preset id must match the URL." }] } };
      const written = await writePresetFile(root, parsed.data, request.data.baseSha);
      if (!written.ok) return { status: written.status, body: written.body };
      options.log?.({ event: "write", path: presetPath(id), after: written.sha, labels: [`Save preset ${id}`] });
      return { status: 200, body: { sha: written.sha } };
    },
    async readScene(id: string): Promise<BridgeReply> {
      const read = await readScene(root, id);
      if ("success" in read) return { status: 404, body: { error: "Scene not found." } };
      remember(id, read.text);
      let recipe: unknown;
      try { recipe = parseJsonDocument(read.text); } catch { return { status: 422, body: { error: "The recipe is not valid JSON." } }; }
      return { status: 200, body: { text: read.text, sha256: read.sha, recipe } };
    },
    async applySceneEdits(id: string, body: unknown): Promise<BridgeReply> {
      const request = z.strictObject({ baseSha: z.string().regex(/^[0-9a-f]{64}$/), ops: z.array(z.unknown()).max(2000), label: z.string().max(200).optional() }).safeParse(body);
      if (!request.success) return { status: request.error.issues.some(issue => issue.code === "too_big") ? 413 : 422, body: { issues: [{ code: "ERR_EDIT_INVALID", message: "Send {baseSha, ops (at most 2000), label?}." }] } };
      const read = await readScene(root, id);
      if ("success" in read) return { status: 404, body: { error: "Scene not found." } };
      if (read.sha !== request.data.baseSha) return { status: 409, body: { sha: read.sha, text: read.text } };
      const before = parseJsonDocument(read.text);
      const result = applyEdits(before, request.data.ops);
      if (!result.ok) return { status: 422, body: { issues: result.issues } };
      remember(id, read.text);
      const known = history.get(id)!.find(text => { try { return sameValue(parseJsonDocument(text), result.recipe); } catch { return false; } });
      const next = known ?? formatJsonDocument(read.text, result.recipe, { reference: history.get(id)![1] });
      try { if (next !== read.text) await services.atomicWrite(root, scenePath(id), next, read.text); }
      catch (error) {
        if ((error as { code?: string }).code !== "conflict") throw error;
        const current = await readScene(root, id);
        return { status: 409, body: "success" in current ? { error: "Scene disappeared." } : { sha: current.sha, text: current.text } };
      }
      const sha = services.textSha256(next);
      remember(id, next);
      options.log?.({ event: "write", path: scenePath(id), before: read.sha, after: sha, labels: (request.data.ops as EditOp[]).map(op => describeOp(op)), ...(request.data.label ? { label: request.data.label } : {}) });
      return { status: 200, body: { sha, inverse: result.inverse } };
    },
  };
  // Scoped-path refusals (symlinks, protected paths) are a 403, never a generic failure.
  const guarded = <A extends unknown[]>(run: (...args: A) => Promise<BridgeReply>) => async (...args: A): Promise<BridgeReply> => {
    try { return await run(...args); }
    catch (error) { if ((error as { code?: string }).code === "denied-path") return { status: 403, body: { error: "That project path is not allowed." } }; throw error; }
  };
  const safe = { hello: handlers.hello, readScene: guarded(handlers.readScene), applySceneEdits: guarded(handlers.applySceneEdits),
    listPresets: guarded(handlers.listPresets), readPreset: guarded(handlers.readPreset), writePreset: guarded(handlers.writePreset), ...sourceHandlers };
  const server = await startEditBridge({ token, origins: [options.origin], readOnly: options.readOnly, handlers: safe, ...(options.port !== undefined ? { port: options.port } : {}), ...(options.log ? { log: options.log } : {}) });
  broadcast = server.broadcast;
  const watcher = watchProjectFiles(root, change => server.broadcast("file-changed", change));
  const stop = server.stop;
  return { token, server: { ...server, stop: async () => { watcher.close(); await stop(); } } };
}

export async function executeEditCommand(operation: EditOperation, input: EditInput, context: { root: string; version?: string; log?: (entry: Record<string, unknown>) => void }): Promise<EditCommandResult> {
  const parsed = EditInputSchema.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues.map(issue => ({ code: "ERR_EDIT_INVALID", path: issue.path.join("."), message: issue.message })));
  const options = parsed.data;
  try {
    const root = await services.canonicalRoot(context.root);
    if (operation === "source") {
      const kind = options.sourceAction ?? "outline";
      if (kind === "outline") return { success: true, command: "edit", data: { outlines: await loadSourceOutlines(root, { file: options.file, scene: options.scene }) } };
      if (options.write) await recoverSourceTransaction(root);
      const sourceRequest = { kind, file: options.file ? services.projectRelativePath(root, options.file) : undefined, node: options.node ?? options.nodes?.[0], id: options.sourceId,
        ...(options.scene ? { scene: options.scene } : {}), ...(kind === "wrap" ? { content: options.content } : {}),
        ...(kind === "group" ? { nodes: options.nodes } : {}), ...(kind === "expose" ? { prop: options.prop, options: options.enumOptions } : {}) };
      let plan: Awaited<ReturnType<typeof prepareSourceEdit>>;
      try { plan = await prepareSourceEdit(root, sourceRequest); }
      catch (error) { if (error instanceof z.ZodError) return failure(error.issues.map(issue => ({ code: "ERR_SOURCE_REFUSED", path: issue.path.join("."), message: issue.message }))); throw error; }
      const [jsx, recipe] = plan.changes;
      if ((options.expectSha && plan.preview.baseShas[jsx.file] !== options.expectSha) || (options.expectRecipeSha && (!recipe || plan.preview.baseShas[recipe.file] !== options.expectRecipeSha)))
        return failure([{ code: "ERR_SOURCE_CONFLICT", message: "A reviewed file hash changed. Run the dry run again before writing." }]);
      if (options.write) await writeSourceTransaction(root, plan.changes);
      return { success: true, command: "edit", data: { ...plan.preview, written: options.write ?? false } };
    }
    if (operation === "bridge") {
      if (!options.url) return failure([{ code: "ERR_MISSING_VALUE", path: "url", message: "Pass the running dev server with --url (or set APP_PORT / PORT)." }]);
      if (options.scene) { const read = await readScene(root, options.scene); if ("success" in read) return read; }
      const verified = await executeProjectCommand("open-preview", { url: options.url, launch: false }, { root });
      if (!verified.success) return { success: false, command: "edit", issues: verified.issues.map(normalizeIssue), next: verified.next ?? nextForIssues(verified.issues.map(normalizeIssue)) };
      const previewUrl = verified.data.url!;
      const { token, server } = await startSceneBridge(root, { origin: new URL(previewUrl).origin, ...(options.port !== undefined ? { port: options.port } : {}), readOnly: options.readOnly ?? false,
        version: context.version ?? "development", projectId: verified.data.project?.projectId, ...(context.log ? { log: context.log } : {}) });
      const url = editorUrl(previewUrl, options.scene, server.port, token);
      if (options.launch) await services.openBrowser(root, url);
      return { success: true, command: "edit", server, data: { bridge: server.origin, url, readOnly: options.readOnly ?? false, ...(options.scene ? { scene: options.scene } : {}) } };
    }
    const write = { write: options.write ?? false, ...(options.expectSha ? { expectSha: options.expectSha } : {}), ...(options.label ? { label: options.label } : {}) };
    if (operation === "preset") {
      const action = options.action ?? "ls";
      if (action === "ls") return { success: true, command: "edit", data: { presets: await discoverPresets(root) } };
      if (!options.preset) return failure([{ code: "ERR_MISSING_VALUE", path: "preset", message: `edit preset ${action} needs --preset <id>.` }]);
      if (action === "show") {
        const read = await readPreset(root, options.preset);
        if ("success" in read) return read;
        return { success: true, command: "edit", data: { path: presetPath(options.preset), sha: read.sha, preset: read.preset } };
      }
      if (!options.scene) return failure([{ code: "ERR_MISSING_VALUE", path: "scene", message: `edit preset ${action} needs --scene <id>.` }]);
      const scene = await readScene(root, options.scene);
      if ("success" in scene) return scene;
      let recipe: Doc;
      try { recipe = parseJsonDocument(scene.text) as Doc; } catch { return failure([{ code: "ERR_SCENE_INVALID", path: scene.target, message: "The recipe is not valid JSON." }]); }
      if (action === "save") {
        if (!options.layer) return failure([{ code: "ERR_MISSING_VALUE", path: "layer", message: "edit preset save needs --layer <surface|camera> (its root tracks become the preset)." }]);
        const tracks = ((recipe?.definition?.motion?.tracks ?? []) as Doc[]).filter(track => options.layer === "camera" ? track.target?.kind === "camera" : (track.target?.kind === "surface" || track.target?.kind === "style") && track.target?.id === options.layer);
        if (!tracks.length) return failure([{ code: "ERR_EDIT_TARGET", path: "layer", message: `${options.layer} has no root tracks in ${options.scene}.` }]);
        let preset: Preset;
        try { preset = presetFromTracks(tracks as never, { id: options.preset, title: options.title ?? options.preset, ...(options.values ? { values: options.values } : {}) }); }
        catch (error) { return failure([{ code: "ERR_PRESET_INVALID", path: "layer", message: error instanceof Error ? error.message : String(error) }]); }
        if (!options.write) return { success: true, command: "edit", data: { path: presetPath(preset.id), written: false, preset } };
        const written = await writePresetFile(root, preset, options.expectSha ?? null);
        if (!written.ok) return failure([{ code: "ERR_EDIT_CONFLICT", path: presetPath(preset.id), message: "The preset exists or changed; pass --expect-sha with its current sha256 to replace it.", hint: `Current sha: ${String(written.body.sha)}` }]);
        return { success: true, command: "edit", data: { path: presetPath(preset.id), written: true, sha: written.sha, preset } };
      }
      // apply
      if (!options.to) return failure([{ code: "ERR_MISSING_VALUE", path: "to", message: "edit preset apply needs --to <layer|camera|animatable id>." }]);
      const read = await readPreset(root, options.preset);
      if ("success" in read) return read;
      const atMs = options.at ?? 0;
      const kind = presetTargetKind(read.preset) === "animatable" ? "animatable" : options.to === "camera" ? "camera" : "surface";
      const target = kind === "camera" ? { camera: true as const } : kind === "animatable" ? { animatable: options.to } : { surface: options.to };
      if (kind === "surface" && !recipe.definition?.scene?.nodes?.some((node: Doc) => node.id === options.to))
        return failure([{ code: "ERR_PRESET_TARGET", path: "to", message: `Scene ${options.scene} has no layer named ${options.to}.` }]);
      const applied = applyPreset(read.preset, target, { atMs, base: restBase(recipe, atMs) });
      if (!applied.ok) return failure([{ code: applied.code, path: "to", message: applied.message }]);
      const durationMs = Math.ceil(clipTiming(applied.clip).endMs);
      const ops: EditOp[] = [];
      if (durationMs > (recipe.definition.motion?.durationMs ?? 0)) ops.push({ op: "motion.set", durationMs });
      ops.push({ op: "clip.set", clip: applied.clip });
      return await editScene(root, options.scene, ops, { ...write, expectSha: write.expectSha ?? scene.sha, ...(options.label ? {} : { label: `Apply preset ${options.preset} to ${options.to}` }) });
    }
    if (!options.scene) return failure([{ code: "ERR_MISSING_VALUE", path: "scene", message: `edit ${operation} needs --scene <id>.` }]);
    if (operation === "ls") {
      const read = await readScene(root, options.scene);
      if ("success" in read) return read;
      let recipe: Doc;
      try { recipe = parseJsonDocument(read.text) as Doc; } catch { return failure([{ code: "ERR_SCENE_INVALID", path: read.target, message: "The recipe is not valid JSON." }]); }
      return { success: true, command: "edit", data: { scene: options.scene, path: read.target, sha: read.sha, ...listing(recipe, options.at) } };
    }
    if (operation === "apply") {
      let text = options.opsText;
      if (text === undefined) {
        if (!options.ops) return failure([{ code: "ERR_MISSING_VALUE", path: "ops", message: "edit apply needs --ops <file> (or - for stdin)." }]);
        text = await services.readText(root, services.relativeTarget(options.ops.replace(/^\.\//, "")), BRIDGE_MAX_BODY_BYTES);
        if (text === undefined) return failure([{ code: "ERR_EDIT_TARGET", path: "ops", message: `No ops file ${options.ops}.` }]);
      }
      let ops: unknown;
      try { ops = parseJsonDocument(text); } catch { return failure([{ code: "ERR_EDIT_INVALID", path: "ops", message: "The ops file is not valid JSON." }]); }
      // Accept either an op array or the inverse/ops envelope another command printed.
      if (ops && typeof ops === "object" && !Array.isArray(ops)) ops = (ops as Doc).ops ?? (ops as Doc).inverse ?? (ops as Doc).data?.inverse;
      return await editScene(root, options.scene, ops, write);
    }
    if (operation === "paste") {
      if (!options.from || options.at === undefined) return failure([{ code: "ERR_MISSING_VALUE", path: options.from ? "at" : "from", message: "edit paste needs --from <clipboard file> and --at <ms>." }]);
      const text = await services.readText(root, services.relativeTarget(options.from.replace(/^\.\//, "")), BRIDGE_MAX_BODY_BYTES);
      if (text === undefined) return failure([{ code: "ERR_EDIT_TARGET", path: "from", message: `No clipboard file ${options.from}.` }]);
      const payload = parseClipboard(text.replace(/^\uFEFF/, ""));
      if (!payload) return failure([{ code: "ERR_EDIT_INVALID", path: "from", message: "Not a Velora keyframe clipboard (application/x-velora-keyframes+json, version 1)." }]);
      const pasted = pasteOps(payload, options.at, options.onto ? { kind: "surface", id: options.onto } : undefined);
      if (!pasted.ok) return failure([{ code: "ERR_EDIT_INVALID", path: "from", message: pasted.message }]);
      return await editScene(root, options.scene, pasted.ops, write);
    }
    if (!options.track || options.at === undefined) return failure([{ code: "ERR_MISSING_VALUE", path: options.track ? "at" : "track", message: `edit ${operation} needs --track <ref> and --at <ms>.` }]);
    const track = parseTrackShorthand(options.track);
    if (!track.ok) return failure([{ code: "ERR_EDIT_TARGET", path: "track", message: track.message, hint: "Use camera.z, focus.distance, <surface>.<prop>, style:<surface>.--name or channel:<id>, with an optional @<clip>." }]);
    const address: TrackAddress = track.track;
    if (operation === "key") {
      if (options.value === undefined) return failure([{ code: "ERR_MISSING_VALUE", path: "value", message: "edit key needs --value." }]);
      return await editScene(root, options.scene, [{ op: "key.set", track: address, atMs: options.at, value: parseValue(options.value), ...(options.ease ? { easing: parseEasing(options.ease) } : {}) }], write);
    }
    if (!options.ease) return failure([{ code: "ERR_MISSING_VALUE", path: "ease", message: "edit ease needs --ease <name or JSON>." }]);
    return await editScene(root, options.scene, [{ op: "key.ease", track: address, atMs: options.at, easing: parseEasing(options.ease) }], write);
  } catch (error) {
    if (error instanceof BridgeStartError) return failure([{ code: error.code, message: error.message }]);
    const code = (error as { code?: string }).code;
    return failure([{ code: code && /^[a-z-]+$|^ERR_/.test(code) ? code : "ERR_INTERNAL", message: error instanceof Error ? error.message : "Edit failed.", ...((error as { target?: string }).target ? { path: (error as { target: string }).target } : {}) }]);
  }
}
