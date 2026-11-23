import { z } from "zod";
import { applyEdits } from "../core/edit";
import { formatJsonDocument, parseJsonDocument } from "../core/json";
import { SCENE_RECIPE_DIRECTORY, SceneRecipeIdSchema, SceneRecipeSchema } from "../core/recipes";
import { SourceConfirmSchema, SourceFileSchema, SourceRequestSchema, type SourceConfirm, type SourceDocument, type SourcePreview, type SourceRequest } from "../core/source";
import { fault } from "./errors";
import * as services from "./services";
import { createBridgeToken, type BridgeReply } from "./services/bridge";
import { outlineSource, sourceDiff, sourceReferences, transformSource } from "./source";

const SOURCE_LIMIT = 512 * 1024;
const JOURNAL = ".velora/journal/source.json";
const JOURNAL_LIMIT = 2_000_000;
const RECIPE_PATH = /^src\/velora\/scenes\/[a-z0-9]+(?:-[a-z0-9]+)*\.scene\.json$/;
const GENERATED = /^src\/velora\/(?:catalog|projectpreview|preview|adapter|bootstrap|generated)(?:\.|\/)/i;
const DISALLOWED = /(?:^|\/)(?:node_modules|\.next|\.velora|\.git|dist|generated)(?:\/|$)|\/[^/]*\.generated\.[^.]+$/i;
const hash = (text: string) => services.textSha256(text);
type Change = { file: string; before: string; after: string };
type Plan = { changes: Change[]; preview: SourcePreview };
const journalSchema = z.strictObject({ version: z.literal(1), pid: z.number().int().positive().max(2 ** 31 - 1), files: z.array(z.strictObject({
  file: z.string(), before: z.string(), afterSha: z.string().regex(/^[a-f0-9]{64}$/),
})).min(1).max(2) });

const deny = (message: string, file?: string) => fault("denied-path", message, file);
const refused = (message: string, file?: string) => fault("ERR_SOURCE_REFUSED", message, file);
const conflict = (message: string, file?: string) => fault("ERR_SOURCE_CONFLICT", message, file);

function validateSourcePath(file: string) {
  services.relativeTarget(file);
  if (!SourceFileSchema.safeParse(file).success || DISALLOWED.test(file) || GENERATED.test(file)) throw deny("Choose an authored .tsx or .jsx file under src/. Generated files and dependencies cannot be edited.", file);
  const invalidPart = file.split("/").some(part => /[ .]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
  if (invalidPart) throw deny("Use an ordinary file name without reserved Windows path segments.", file);
}

async function policy(root: string) {
  const read = async (target: string) => {
    const text = await services.readText(root, target);
    return text === undefined ? {} : parseJsonDocument(text) as Record<string, unknown>;
  };
  const [project, managed, pending, pkg] = await Promise.all([
    read(".velora/project.json"), read(".velora/integration.json"), read(".velora/integration-pending.json"), read("package.json"),
  ]);
  if (project.adapter === "site") throw refused("Any-site mode has no local React JSX. Open the React host project for source integration.");
  const paths = new Set([...Object.keys((managed.files ?? {}) as object), ...Object.keys((pending.files ?? {}) as object),
    ...[project.entry, project.adapterPath, project.generatedPath].filter((value): value is string => typeof value === "string")].map(file => file.toLowerCase()));
  const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) };
  const isNextApp = project.adapter === "next-app" || (!project.adapter && !!(deps as Record<string, unknown>).next &&
    (await Promise.all(["app", "src/app"].flatMap(dir => ["tsx", "jsx", "ts", "js"].map(ext => services.isRegularFile(root, `${dir}/layout.${ext}`))))).some(Boolean));
  return { paths, needsClient: isNextApp };
}

async function readSource(root: string, file: string, settings: Awaited<ReturnType<typeof policy>>) {
  validateSourcePath(file);
  if (settings.paths.has(file.toLowerCase())) throw deny("This file is recorded as Velora-managed. Choose the authored scene binding or a local component.", file);
  return services.readText(root, file, SOURCE_LIMIT, { strictUtf8: true });
}

async function sceneSources(root: string, id: string, settings: Awaited<ReturnType<typeof policy>>) {
  if (!SceneRecipeIdSchema.safeParse(id).success) throw refused("Choose a valid scene ID.");
  const base = `${SCENE_RECIPE_DIRECTORY}/${id}`;
  const files = new Map<string, { text: string; owner?: string; repeated?: boolean }>();
  for (const file of [`${base}.tsx`, `${base}.jsx`]) {
    const text = await readSource(root, file, settings);
    if (text !== undefined) files.set(file, { text });
  }
  if (files.size !== 1) throw refused(files.size ? "The scene has both TSX and JSX bindings. Keep a single binding before editing." : "This scene has no local TSX or JSX binding.");
  const [binding, primary] = [...files][0];
  const follow = async (from: string, reference: ReturnType<typeof sourceReferences>[number]) => {
    const { specifier, owner, repeated } = reference;
    const target = services.resolveProjectImport(from, specifier);
    const stem = target.replace(/\.[cm]?[jt]sx?$/i, "");
    const candidates = SourceFileSchema.safeParse(target).success ? [target] : [stem + ".tsx", stem + ".jsx", stem + "/index.tsx", stem + "/index.jsx"];
    for (const file of candidates) {
      if (!SourceFileSchema.safeParse(file).success || DISALLOWED.test(file) || GENERATED.test(file) || settings.paths.has(file.toLowerCase())) continue;
      let imported: string | undefined;
      try { imported = await readSource(root, file, settings); }
      catch (error) { if (["denied-path", "invalid-file"].includes((error as { code?: string }).code ?? "")) continue; throw error; }
      if (imported !== undefined) {
        if (file !== binding && file !== from) {
          files.set(file, { text: imported, owner, repeated: repeated || files.has(file) });
          return { file, text: imported };
        }
        return;
      }
    }
  };
  for (const reference of sourceReferences(binding, primary.text).slice(0, 64)) {
    const imported = await follow(binding, reference);
    // A single default re-export is the effective binding, so inspect its direct imports too.
    if (!imported || !reference.reexportsDefault) continue;
    for (const child of sourceReferences(imported.file, imported.text, reference.reexportsDefault).slice(0, 64)) await follow(imported.file, child);
  }
  return files;
}

export async function loadSourceOutlines(root: string, input: { file?: string; scene?: string }): Promise<SourceDocument[]> {
  if (!input.file && !input.scene) throw refused("Provide a file or a scene ID.");
  const settings = await policy(root);
  const file = input.file ? services.projectRelativePath(root, input.file) : undefined;
  if (file) {
    validateSourcePath(file);
    if (settings.paths.has(file.toLowerCase())) throw deny("This source file is Velora-managed.", file);
  }
  const files = input.scene ? await sceneSources(root, input.scene, settings) : new Map([[file!, { text: await readSource(root, file!, settings), owner: undefined }]]);
  if (file && !files.has(file)) throw deny("The file is outside this scene binding and its direct local imports.", file);
  const outlines: SourceDocument[] = [];
  for (const [key, { text, owner }] of files) {
    if (file && key !== file) continue;
    if (text === undefined) throw fault("ERR_SOURCE_NOT_FOUND", "The JSX file was not found.", key);
    try {
      const outline = outlineSource(key, text);
      if (owner) for (const node of outline.nodes) node.owner ??= owner;
      outlines.push({ ...outline, absolutePath: await services.scopedPath(root, key), sha: hash(text) });
    }
    catch (error) { if (file || key.startsWith(`${SCENE_RECIPE_DIRECTORY}/${input.scene}.`)) throw error; }
  }
  return outlines;
}

const key = (file: string) => file.toLowerCase();
async function validateChanges(root: string, files: readonly { file: string }[]) {
  if (new Set(files.map(change => key(change.file))).size !== files.length || !files.length || files.length > 2 || (files.length === 2 && !RECIPE_PATH.test(files[1].file)))
    throw refused("The source transaction does not contain one JSX file and an optional scene recipe.");
  validateSourcePath(files[0].file);
  if ((await policy(root)).paths.has(key(files[0].file))) throw deny("This source file is now Velora-managed.", files[0].file);
  await Promise.all(files.map(file => services.scopedPath(root, file.file)));
}

export async function recoverSourceTransaction(root: string): Promise<void> {
  const saved = await services.readText(root, JOURNAL, JOURNAL_LIMIT);
  if (saved === undefined) return;
  const journal = journalSchema.safeParse(parseJsonDocument(saved));
  if (!journal.success) throw fault("ERR_SOURCE_RECOVERY", "The source journal could not be read. Inspect .velora/journal/source.json before editing source.");
  if (services.projectProcessIsRunning(journal.data.pid)) throw conflict("A source transaction is already in progress. Wait for it to finish and refresh the outline.");
  const { files } = journal.data;
  await validateChanges(root, files);
  const current = await Promise.all(files.map(file => services.readText(root, file.file)));
  const committed = files.every((file, index) => current[index] !== undefined && hash(current[index]!) === file.afterSha);
  if (!committed) for (const [index, file] of files.entries()) {
    if (current[index] !== undefined && hash(current[index]!) === file.afterSha) await services.atomicWrite(root, file.file, file.before, current[index]);
  }
  await services.removeText(root, JOURNAL, saved);
}

export async function writeSourceTransaction(root: string, changes: Change[]) {
  await recoverSourceTransaction(root);
  await validateChanges(root, changes);
  for (const { file, before } of changes) if (await services.readText(root, file) !== before) throw conflict("A file changed after the diff was prepared. Refresh and review a new diff.", file);
  const journal = JSON.stringify({ version: 1, pid: services.currentProjectProcess(), files: changes.map(change => ({ file: change.file, before: change.before, afterSha: hash(change.after) })) });
  if (services.textByteLength(journal) > JOURNAL_LIMIT) throw refused("The source pre-images exceed the transaction size limit.");
  try { await services.atomicWrite(root, JOURNAL, journal, undefined); }
  catch (error) { if ((error as { code?: string }).code === "conflict") throw conflict("Another source transaction started. Refresh the outline and try again."); throw error; }
  const written: Change[] = [];
  try {
    for (const entry of changes) { await services.atomicWrite(root, entry.file, entry.after, entry.before); written.push(entry); }
  } catch (error) {
    try {
      for (const entry of written.reverse()) {
        if (await services.readText(root, entry.file) !== entry.after) throw conflict("A file changed during rollback.", entry.file);
        await services.atomicWrite(root, entry.file, entry.before, entry.after);
      }
      await services.removeText(root, JOURNAL, journal);
    } catch { throw fault("ERR_SOURCE_RECOVERY", "The source transaction needs recovery. Keep your external edits and restart the bridge to inspect the pending journal."); }
    if ((error as { code?: string }).code === "conflict") throw conflict("A file changed during the transaction. The source write was rolled back. Review a new diff.");
    throw error;
  }
  await services.removeText(root, JOURNAL, journal);
}

function withHeaders(file: string, before: string, after: string) {
  return `--- a/${file}\n+++ b/${file}\n${sourceDiff(before, after)}`;
}

export async function prepareSourceEdit(root: string, input: unknown): Promise<Plan> {
  const request = SourceRequestSchema.parse(input);
  if (await services.readText(root, JOURNAL, JOURNAL_LIMIT) !== undefined)
    throw conflict("A source transaction is pending. Wait for it to finish or restart the writable edit bridge to recover it.");
  const settings = await policy(root);
  const inferred = /^src\/velora\/scenes\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(?:tsx|jsx)$/.exec(request.file)?.[1];
  const scene = request.scene ?? inferred;
  if (!scene) throw refused("Provide --scene for a local component so the edit is scoped to its scene binding.");
  validateSourcePath(request.file);
  if (settings.paths.has(key(request.file))) throw deny("This file is Velora-managed.", request.file);
  await services.scopedPath(root, request.file);
  const files = await sceneSources(root, scene, settings);
  const selected = files.get(request.file);
  if (!selected) throw deny("Only this scene's binding and its direct local TSX or JSX imports can be changed.", request.file);
  if (selected.repeated) throw refused("The scene renders this import in multiple or conditional locations. Give each instance a distinct layer ID in source.", request.file);
  const { text: before, owner } = selected;
  if (request.expectedSha && request.expectedSha !== hash(before)) throw conflict("The source changed since this outline was loaded. Refresh the outline before previewing.", request.file);
  const changed = transformSource(request, before, settings.needsClient, owner);
  if (services.textByteLength(changed.text) > SOURCE_LIMIT) throw refused("The updated JSX would exceed 512 KB.", request.file);
  const changes: Change[] = [{ file: request.file, before, after: changed.text }];
  const outline = outlineSource(request.file, changed.text);
  if (changed.ops.length) {
    const file = `${SCENE_RECIPE_DIRECTORY}/${scene}.scene.json`;
    const before = await services.readText(root, file, SOURCE_LIMIT, { strictUtf8: true });
    if (before === undefined) throw fault("ERR_SOURCE_NOT_FOUND", "The scene recipe was not found.", file);
    const recipe = SceneRecipeSchema.parse(parseJsonDocument(before));
    if (recipe.id !== scene || recipe.definition.scene.nodes.some(node => node.id === request.id)) throw refused("Use a new layer ID and confirm the recipe matches the selected scene.", file);
    // Validate against the parsed contract but preserve the user's raw values and layout on write.
    const result = applyEdits(parseJsonDocument(before), changed.ops);
    if (!result.ok) throw refused(result.issues.map(issue => issue.message).join(" "), file);
    changes.push({ file, before, after: formatJsonDocument(before, result.recipe) });
  }
  const preview: SourcePreview = {
    previewId: createBridgeToken(), baseShas: Object.fromEntries(changes.map(change => [change.file, hash(change.before)])), outline,
    diffs: await Promise.all(changes.map(async change => ({ file: change.file, diff: withHeaders(change.file, change.before, change.after), git: await services.gitFileStatus(root, change.file) }))),
    ...((request.kind === "wrap" || request.kind === "group") ? { layoutWarning: "A Surface adds a positioned div with preserve-3d. Inline elements, flex items and grid items may reflow." } : {}),
  };
  return { changes, preview };
}

function response<T>(run: (input: T) => Promise<BridgeReply>) {
  return async (input: T): Promise<BridgeReply> => {
    try { return await run(input); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (!code?.startsWith("ERR_SOURCE_") && !["conflict", "denied-path", "invalid-file", "ENOENT"].includes(code ?? "") && !(error instanceof z.ZodError) && !(error instanceof SyntaxError)) throw error;
      const status = code === "denied-path" ? 403 : code === "ERR_SOURCE_NOT_FOUND" || code === "ENOENT" ? 404
        : code === "conflict" || code === "ERR_SOURCE_CONFLICT" || code === "ERR_SOURCE_RECOVERY" ? 409 : 422;
      const message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join(".")} ${issue.message}`.trim()).join(" ")
        : code === "ENOENT" ? "The local source file disappeared. Refresh the outline." : (error as Error).message;
      return { status, body: { error: message, issues: [{ code: code ?? "ERR_SOURCE_REFUSED", message }] } };
    }
  };
}

export function sourceBridgeHandlers(root: string, onWrite: (paths: string[]) => void) {
  const plans = new Map<string, { plan: Plan; created: number }>();
  const undo = new Map<string, Change[]>();
  function keep<T>(map: Map<string, T>, id: string, data: T) {
    if (map.size >= 8) map.delete(map.keys().next().value!);
    map.set(id, data);
  }
  function confirmed(body: unknown): SourceConfirm { return SourceConfirmSchema.parse(body); }
  return {
    sourceOutline: response(async (input: { file?: string; scene?: string }) => ({ status: 200, body: { outlines: await loadSourceOutlines(root, input) } })),
    sourcePreview: response(async (body: unknown) => {
      const plan = await prepareSourceEdit(root, body);
      keep(plans, plan.preview.previewId, { plan, created: Date.now() });
      return { status: 200, body: plan.preview };
    }),
    sourceApply: response(async (body: unknown) => {
      const request = confirmed(body);
      const entry = plans.get(request.previewId);
      if (!entry || Date.now() - entry.created > 10 * 60_000) throw conflict("The source preview expired. Review a new diff before applying.");
      const { plan } = entry;
      if (Object.keys(request.baseShas).length !== plan.changes.length || plan.changes.some(change => request.baseShas[change.file] !== hash(change.before)))
        throw conflict("Both reviewed file hashes must match the confirmation.");
      await writeSourceTransaction(root, plan.changes);
      plans.delete(request.previewId);
      const undoId = createBridgeToken();
      keep(undo, undoId, plan.changes.map(change => ({ ...change, before: change.after, after: change.before })));
      onWrite(plan.changes.map(change => change.file));
      return { status: 200, body: { undoId, outline: plan.preview.outline } };
    }),
    sourceUndo: response(async (body: unknown) => {
      const { undoId } = z.strictObject({ undoId: SourceConfirmSchema.shape.previewId }).parse(body);
      const changes = undo.get(undoId);
      if (!changes) throw conflict("The source undo is no longer in this session. Review the files in Git.");
      try { await writeSourceTransaction(root, changes); }
      catch (error) { if ((error as { code?: string }).code === "ERR_SOURCE_CONFLICT") throw conflict("A file changed since this source edit. Review it in Git before undoing."); throw error; }
      undo.delete(undoId);
      onWrite(changes.map(change => change.file));
      return { status: 200, body: { undone: true } };
    }),
  };
}
