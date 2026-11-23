import { z } from "zod";
import { COMPOSITION_FILE_SUFFIX, CompositionSchema } from "../core/composition";
import { applyEdits, describeOp, lineDiff, type EditOp } from "../core/edit";
import type { MediaPeaks } from "../core/audio";
import { normalizeIssue, nextForIssues } from "../core/cli-schema";
import { formatJsonDocument, parseJsonDocument, sameJsonValue } from "../core/json";
import { fault } from "./errors";
import * as services from "./services";
import { BRIDGE_MAX_BODY_BYTES, type BridgeReply } from "./services/bridge";

const MAX_COMPOSITION_BYTES = 256_000;
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const compositionTarget = (root: string, file: string) => {
  const target = services.projectRelativePath(root, file);
  if (!target.endsWith(COMPOSITION_FILE_SUFFIX)) throw fault("ERR_COMPOSITION_INVALID", `Use a *${COMPOSITION_FILE_SUFFIX} file.`, target);
  return target;
};
export async function readCompositionEdit(root: string, file: string) {
  const target = compositionTarget(root, file);
  const text = await services.readText(root, target, MAX_COMPOSITION_BYTES, { strictUtf8: true });
  if (text === undefined) throw fault("ERR_COMPOSITION_NOT_FOUND", `Composition ${target} was not found.`, target);
  let document: unknown;
  try { document = parseJsonDocument(text); }
  catch { throw fault("ERR_COMPOSITION_INVALID", `Invalid composition JSON in ${target}.`, target); }
  return { target, text, sha: services.textSha256(text), document };
}
const getIssue = (error: unknown) => {
  const { code, target } = error as { code?: string; target?: string };
  return normalizeIssue({ code: code === "conflict" ? "ERR_EDIT_CONFLICT" : code ?? "ERR_INTERNAL", path: target, message: (error as Error).message });
};
type Read = Awaited<ReturnType<typeof readCompositionEdit>>;
function prepare(read: Read, ops: unknown, revisions: string[] = []) {
  const result = applyEdits(read.document, ops, { target: "composition" });
  if (!result.ok) return result;
  const matching = revisions.find(text => sameJsonValue(parseJsonDocument(text), result.composition));
  const text = matching ?? formatJsonDocument(read.text, result.composition, { reference: revisions.find(item => item !== read.text) });
  if (services.textByteLength(text) > MAX_COMPOSITION_BYTES) throw fault("ERR_COMPOSITION_INVALID", "Composition exceeds the 256,000-byte file limit.", read.target);
  return { ...result, text, sha: services.textSha256(text), labels: (ops as EditOp[]).map(describeOp) };
}

export async function executeCompositionEdit(input: { composition: string; ops?: unknown; opsFile?: string; opsText?: string; expectSha?: string; write?: boolean }, context: { root: string }) {
  const command = "compose" as const;
  const failure = (issues: Parameters<typeof normalizeIssue>[0][]) => {
    const normalized = issues.map(normalizeIssue);
    return { success: false as const, command, issues: normalized, next: nextForIssues(normalized) };
  };
  try {
    const root = await services.canonicalRoot(context.root);
    if (input.expectSha !== undefined && !sha.safeParse(input.expectSha).success)
      return failure([{ code: "ERR_EDIT_INVALID", path: "expectSha", message: "Use a 64-character lowercase sha256." }]);
    const read = await readCompositionEdit(root, input.composition);
    if (input.expectSha && input.expectSha !== read.sha)
      return failure([{ code: "ERR_EDIT_CONFLICT", path: read.target, message: `${read.target} changed. Current SHA: ${read.sha}.` }]);
    let ops = input.ops;
    if (ops === undefined) {
      const text = input.opsText ?? (input.opsFile && await services.readText(root, services.projectRelativePath(root, input.opsFile), BRIDGE_MAX_BODY_BYTES));
      if (text === undefined || services.textByteLength(text) > BRIDGE_MAX_BODY_BYTES)
        return failure([{ code: "ERR_EDIT_INVALID", path: "ops", message: "Supply a JSON ops file or stdin up to 1 MB." }]);
      try { ops = parseJsonDocument(text); }
      catch { return failure([{ code: "ERR_EDIT_INVALID", path: "ops", message: "The ops file is not valid JSON." }]); }
      if (ops && typeof ops === "object" && !Array.isArray(ops)) {
        const envelope = ops as { ops?: unknown; inverse?: unknown; data?: { inverse?: unknown } };
        ops = envelope.ops ?? envelope.inverse ?? envelope.data?.inverse;
      }
    }
    const result = prepare(read, ops);
    if (!result.ok) return failure(result.issues);
    const written = !!input.write && read.text !== result.text;
    if (written) await services.atomicWrite(root, read.target, result.text, read.text);
    return { success: true as const, command, data: { path: read.target, sha: read.sha, nextSha: result.sha, written,
      labels: result.labels, diff: lineDiff(read.text, result.text), touched: result.touched, inverse: result.inverse } };
  } catch (error) { return failure([getIssue(error)]); }
}

const PEAKS_CACHE = ".velora/cache/peaks";
const inFlight = new Map<string, Promise<MediaPeaks>>();
const peaksSchema = z.strictObject({ sha256: sha, bucketMs: z.literal(10), durationMs: z.number().min(0).max(360_000), peaks: z.string().max(96_000) });
export async function compositionMediaPeaks(root: string, file: string, assetId: string): Promise<MediaPeaks> {
  const read = await readCompositionEdit(root, file);
  const parsed = CompositionSchema.safeParse(read.document);
  if (!parsed.success) throw fault("ERR_COMPOSITION_INVALID", "Correct the composition before requesting waveforms.", read.target);
  const asset = parsed.data.assets.find(entry => entry.id === assetId && entry.type === "audio");
  if (!asset || !asset.path.startsWith("assets/")) throw fault("denied-path", "Choose an audio asset declared in this composition under assets/.");
  const { absolute, sha256 } = await services.waveformSource(root, asset.path);
  const cacheFile = `${PEAKS_CACHE}/${sha256}.json`;
  const key = `${root}/${cacheFile}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const load = async () => {
    const cached = await services.readText(root, cacheFile, MAX_COMPOSITION_BYTES);
    if (cached) {
      try {
        const result = peaksSchema.safeParse(parseJsonDocument(cached));
        if (result.success && result.data.sha256 === sha256 && result.data.peaks.length === Math.ceil(Math.ceil(result.data.durationMs / 10) * 2 / 3) * 4) return result.data;
      } catch { /* Rebuild a truncated cache entry. */ }
    }
    const peaks = await services.decodeMediaPeaks(absolute, sha256);
    if ((await services.waveformSource(root, asset.path)).sha256 !== sha256) throw fault("source-changed", "The audio asset changed while decoding.", asset.path);
    try { await services.atomicWrite(root, cacheFile, JSON.stringify(peaks), cached); }
    catch (error) { if ((error as { code?: string }).code !== "conflict") throw error; }
    return peaks;
  };
  const work = load();
  inFlight.set(key, work);
  try { return await work; }
  finally { inFlight.delete(key); }
}

const writeSchema = z.strictObject({ baseSha: sha, ops: z.array(z.unknown()).max(2000), label: z.string().max(200).optional() });
export function compositionBridgeHandlers(root: string, log?: (entry: Record<string, unknown>) => void) {
  const revisions = new Map<string, string[]>();
  const remember = (target: string, text: string) => {
    const list = revisions.get(target) ?? [];
    revisions.delete(target);
    revisions.set(target, [text, ...list.filter(previous => previous !== text)].slice(0, 24));
    if (revisions.size > 8) revisions.delete(revisions.keys().next().value!);
  };
  const respond = async (run: () => Promise<BridgeReply>): Promise<BridgeReply> => {
    try { return await run(); }
    catch (error) {
      const issue = getIssue(error);
      const status = issue.code === "denied-path" ? 403 : ["ERR_COMPOSITION_NOT_FOUND", "ENOENT"].includes(issue.code) ? 404 : 422;
      return { status, body: { issues: [issue] } };
    }
  };
  return {
    readComposition: (file: string) => respond(async () => {
      const read = await readCompositionEdit(root, file);
      remember(read.target, read.text);
      return { status: 200, body: { text: read.text, sha256: read.sha, path: read.target } };
    }),
    applyCompositionEdits: (file: string, body: unknown) => respond(async () => {
      const request = writeSchema.safeParse(body);
      if (!request.success) return { status: request.error.issues.some(issue => issue.code === "too_big") ? 413 : 422,
        body: { issues: [{ code: "ERR_EDIT_INVALID", path: "ops", message: "Send {baseSha, ops (at most 2000), label?}." }] } };
      const read = await readCompositionEdit(root, file);
      if (read.sha !== request.data.baseSha) return { status: 409, body: { sha: read.sha, text: read.text } };
      remember(read.target, read.text);
      const result = prepare(read, request.data.ops, revisions.get(read.target));
      if (!result.ok) return { status: 422, body: { issues: result.issues } };
      try { if (result.text !== read.text) await services.atomicWrite(root, read.target, result.text, read.text); }
      catch (error) {
        if ((error as { code?: string }).code !== "conflict") throw error;
        const current = await readCompositionEdit(root, file);
        return { status: 409, body: { sha: current.sha, text: current.text } };
      }
      remember(read.target, result.text);
      log?.({ event: "write", path: read.target, before: read.sha, after: result.sha, labels: result.labels, label: request.data.label });
      return { status: 200, body: { sha: result.sha, inverse: result.inverse } };
    }),
    mediaPeaks: (file: string, asset: string) => respond(async () => ({ status: 200, body: await compositionMediaPeaks(root, file, asset) })),
  };
}
