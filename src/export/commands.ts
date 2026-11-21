import { parseJsonDocument } from "../core/json";
import { RESOURCES } from "../core/resources";
import { AUDIO_DRIFT_BUDGET_MS, SUPPORTED_AUDIO_CODECS, audioPlacement } from "../core/audio";
import { resolveAssetId } from "../core/assets";
import { formatSrt, parseCaptions } from "../core/captions";
import { findDeliveryPreset, deliveryWarnings } from "../core/delivery";
import { ASPECT_FRAMES } from "../core/shots";
import { ALPHA_CODECS, CODEC_CONTAINERS, CaptureManifestSchema, RenderManifestSchema, resolveFinishing, shutterSamples, type ResolvedFinishing, type CheckRenderResult, type ExportVideoResult, type FrameRenderResult, type FramesRenderResult, type ShotRenderResult, type VideoRenderResult, type VisualCheck, type VideoCodec } from "../core/export";
import { frameAt, layersAt, localTime, segmentAt, timeAtFrame, timelineDuration, timelineFromComposition, validateTimeline, type Timeline, type TimelineSegment } from "../core/timeline";
import { SceneRecipeSchema, SceneSnapshotSchema, type SceneCatalog } from "../core/recipes";
import {executeRecipeCommand} from "../project/recipes";
import {discoverRecipes, loadComposition} from "../project/discovery";
import {checkCompositionFull, defaultFrameCacheDir, previewBase} from "../project/commands";
import { canonicalRoot, readText, readBytes, removeFile } from "../project/services";
import { ALL_DELIVER_TARGETS, DeliverInputSchema, DeliverablesManifestSchema, galleryTimesMs, heroEmbedHtml, heroTimeMs, heroVideoTsx, resolveDeliverTargets, sizeLadder, type DeliverTarget, type DeliverablesManifest } from "../core/deliverables";
import { fault } from "../project/errors";
import * as services from "./services";
import { blendTransition, composite, compositeOverlay, finishLook, type Lut3d } from "./compositor";
import type { Composition, CompositionOverlay } from "../core/composition";
import { FLASH_LIMIT_PER_SECOND, bandingScore, flashRisk } from "../core/safety";
import { parseCube, resolveLook, type LookInput } from "../core/looks";
import { encodeBase64Url } from "../core/quickshot";
import { LoudnessSchema, SfxEntrySchema, sfxStartMs, type Loudness, type SfxEntry } from "../core/sound";
import { isOverlapTransition } from "../core/transitions";
import { stageLineage, type StageLineage } from "../core/export";
import type { Stage, StageDpr } from "../core/stage";
import type { LoudnessMeasurement } from "./services";
import { executeEditCommand } from "../project/edit";
import { hashDepthLayers, type DepthEvidence, type ResolvedDepth } from "../core/depth";
import type { EditOp } from "../core/edit";

/** SOURCE OF TRUTH: executeVideoExport, executeSceneSnapshot, executeFrameRender trusted operations.
 * WHAT: validate requests, local scope and capture state before publishing video.
 * WHY: CLI and other callers must share the same export policy and canonical scene clock.
 * WHERE: cli/index adapts arguments; services owns all browser/filesystem/process effects.
 */
const stageCheck = (stage: StageLineage, sceneId?: string) => ({
  id: "stage-dpr", pass: !stage.dprCapped,
  detail: `${sceneId ? sceneId + ": " : ""}Captured at ${stage.effectiveDpr}× DPR${stage.dprCapped ? " (3840 px capture cap)" : ""}.`,
});
const timelineStageFields = (stages: readonly (StageLineage & { sceneId: string })[]) => {
  if (!stages.length) return { fields: {}, checks: [] };
  const { sceneId: _, ...stage } = stages[0];
  const same = stages.every(({ sceneId: _, ...value }) => JSON.stringify(value) === JSON.stringify(stage));
  return { fields: same ? { stage } : { stages }, checks: stages.map(value => stageCheck(value, value.sceneId)) };
};
const depthLineage = (entries: DepthEvidence[] | undefined) => entries?.map(({ surface, hash }) => ({ surface, hash })) ?? [];
async function capturedDepth(session: Awaited<ReturnType<typeof services.openCapture>>, timeMs?: number) {
  const capture = CaptureManifestSchema.safeParse(await session.manifest(timeMs).catch(() => undefined));
  return capture.success ? depthLineage(capture.data.depth) : [];
}

export async function executeDepthResolve(input: { scene: string; url: string; write: boolean }, context: { root: string }) {
  let session: Awaited<ReturnType<typeof services.openCapture>> | undefined;
  try {
    const root = await canonicalRoot(context.root);
    const opened = await executeRecipeCommand("open-scene", { sceneId: input.scene, url: input.url, launch: false }, { root });
    if (!opened.success) return { ...opened, command: "depth" as const };
    const selected = opened.data.selected!;
    const original = await services.readRecipe(root, selected.source, 256_000);
    if (!original || JSON.stringify(SceneRecipeSchema.parse(parseJsonDocument(original)).definition) !== JSON.stringify(selected.definition))
      throw fault("source-changed", "The scene changed while opening the depth capture. Retry after saving.");
    const { width, height, stage } = selected.definition;
    session = await services.openCapture({ url: opened.data.url!, width, height, scale: resolveFinishing({}, { width, height }, stage).supersample });
    const capture = CaptureManifestSchema.parse(await session.manifest(0));
    if (!capture.depth?.length) throw fault("ERR_EDIT_TARGET", "No live depth layers were classified. Enable depth on a surface with visible layers and retry.");
    const bySurface = new Map<string, ResolvedDepth["layers"]>();
    for (const { surface, layers } of capture.depth) {
      const prior = bySurface.get(surface) ?? [];
      for (const layer of layers) {
        const found = prior.find(value => JSON.stringify(value.match) === JSON.stringify(layer.match));
        if (found && (found.tier !== layer.tier || found.z !== layer.z)) throw fault("ERR_EDIT_INVALID", `Depth selectors conflict on ${surface}. Give the surfaces or layers distinct anchors.`);
        if (!found) prior.push(layer);
      }
      bySurface.set(surface, prior);
    }
    const ops: EditOp[] = [...bySurface].map(([surface, layers]) => ({ op: "depth.resolve", surface, resolved: { layers, hash: hashDepthLayers(layers) } }));
    const result = await executeEditCommand("apply", { scene: input.scene, opsText: JSON.stringify(ops), write: input.write, expectSha: services.sha256Hex(original) }, { root });
    return result.success ? { ...result, command: "depth" as const, data: { ...result.data, ops } } : { ...result, command: "depth" as const };
  } catch (error) {
    const known = error as { code?: string; message?: string };
    return { success: false as const, command: "depth" as const, issues: [{ code: known.code ?? "invalid-capture", message: known.message ?? "Depth capture failed." }] };
  } finally { await session?.close(); }
}

export async function executeVideoExport(input: unknown, context: { root: string; signal?: AbortSignal }): Promise<ExportVideoResult> {
  let session: Awaited<ReturnType<typeof services.openCapture>> | undefined;
  try {
    const parsed = RESOURCES["export-video"].safeParse(input);
    if (!parsed.success) return { success: false, issues: parsed.error.issues.map(i => ({ code: "invalid-export", message: `${i.path.join(".")}: ${i.message}` })) };
    services.validateTarget(parsed.data.output);
    const scope = await services.prepareScope(context.root, parsed.data.output);
    const initial = resolveFinishing(parsed.data, parsed.data);
    await requireEncoder(initial.codec);
    session = await services.openCapture({ ...parsed.data, scale: initial.supersample, transparent: initial.transparent,
      stageScale: stage => resolveFinishing(parsed.data, parsed.data, stage).supersample }, context.signal);
    const manifest = CaptureManifestSchema.safeParse(await session.manifest());
    if (!manifest.success) throw fault("invalid-capture", "Scene capture bridge must use version 1, the scene viewport selector and a duration between 0 and 120 seconds.");
    if(manifest.data.durationMs===0)throw fault("invalid-capture","Video export needs a scene with a nonzero duration. Static scenes support snapshots.");
    const finishing = resolveFinishing(parsed.data, parsed.data, manifest.data.stage);
    const stage = manifest.data.stage && stageLineage(manifest.data.stage, finishing, parsed.data.stageDpr);
    const frames = Math.ceil(manifest.data.durationMs * parsed.data.fps / 1000);
    const data: { output: string; fps: number; frames: number; durationMs: number; codec: string; quality: string; poster?: string } & {
      audio?: { file: string; codec: string; driftMs: number; peakDb: number | null };
      captions?: { file: string; cues: number; burnIn: boolean };
      stage?: StageLineage; checks?: ReturnType<typeof stageCheck>[];
      depth?: ReturnType<typeof depthLineage>;
    } = { output: parsed.data.output, fps: parsed.data.fps, frames, durationMs: frames * 1000 / parsed.data.fps, codec: finishing.codec, quality: finishing.quality,
      ...(stage ? { stage, checks: [stageCheck(stage)] } : {}) };
    // Every output frame goes through the shared finisher (motion blur, supersample downscale).
    const durationMs = manifest.data.durationMs;
    const exportLook = await loadExportLook(context.root, manifest.data.look);
    const produce: services.FrameProducer = async (_index, timeMs, shoot) => (await finishFrame(timeMs, parsed.data.fps, durationMs, finishing, shoot, exportLook, parsed.data)).png;
    const posterFrame = parsed.data.poster === undefined ? undefined : Math.min(frames - 1, frameAt(Math.min(parsed.data.poster, durationMs), parsed.data.fps));
    let posterPng: Buffer | undefined;
    const onFrame = (index: number, png: Buffer) => { if (index === posterFrame) posterPng = png; };
    const options = { ...parsed.data, ...finishing };
    const publishPoster = async () => {
      if (!posterPng) return;
      const poster = parsed.data.output.slice(0, parsed.data.output.lastIndexOf(".")) + ".poster.png";
      await services.writeNewFile(await services.prepareFileOutput(context.root, poster), posterPng);
      data.poster = poster;
    };
    const recordDepth = async () => {
      const lineage = await capturedDepth(session!);
      if (lineage.length) data.depth = lineage;
    };
    if (!parsed.data.audio && !parsed.data.captions) {
      await session.encode(scope, options, manifest.data, frames, produce, onFrame);
      await recordDepth();
      await publishPoster();
      return { success: true, data };
    }
    // Audio/caption post-pass: encode the silent master to a staged temp file,
    // then mix/burn in one FFmpeg pass and publish only the in-spec result.
    const staged = await services.stageTempVideo(scope);
    try {
      await session.encode(staged.scope, options, manifest.data, frames, produce, onFrame);
      await recordDepth();
      const post = await services.mixPostAudioCaptions(scope, staged.scope.output, {
        ...(parsed.data.audio ? { audio: parsed.data.audio } : {}),
        ...(parsed.data.captions ? { captions: parsed.data.captions } : {}),
      });
      Object.assign(data, post);
      await publishPoster();
      return { success: true, data };
    } finally {
      await staged.cleanup();
    }
  } catch (error) {
    const known = error as { code?: string; message?: string };
    const message = (known.code && known.message) || (error instanceof Error ? error.message : "Video export failed. Check the local scene server and retry.");
    return { success: false, issues: [{ code: known.code ?? "export-failed", message }] };
  } finally { await session?.close(); }
}

/** Capture one canonical frame and save it with the recipe, never mount scenes in list tiles. */
export async function executeSceneSnapshot(input:unknown,context:{root:string;signal?:AbortSignal}){
 let session:Awaited<ReturnType<typeof services.openCapture>>|undefined;
 try{
  const parsed=RESOURCES["snapshot-scene"].safeParse(input);
  if(!parsed.success)return {success:false as const,issues:parsed.error.issues.map(i=>({code:"invalid-snapshot",message:`${i.path.join(".")}: ${i.message}`}))};
  const opened=await executeRecipeCommand("open-scene",{sceneId:parsed.data.sceneId,url:parsed.data.url,launch:false},context);
  if(!opened.success)return {success:false as const,issues:opened.issues.map(i=>({code:"invalid-scene",message:i.message}))};
  const selected=opened.data.selected!;
  const original=await services.readRecipe(context.root,selected.source,256_000);
  if(!original)throw fault("source-changed","Scene source disappeared. Restore it and retry.");
  const recipe=SceneRecipeSchema.parse(parseJsonDocument(original));
  if(recipe.id!==selected.id||JSON.stringify(recipe.definition)!==JSON.stringify(selected.definition))throw fault("source-changed","Scene source changed. Retry the snapshot.");
  // Small cached image; keep the authored aspect ratio and canonical playback clock.
  const width=320, height=Math.max(64,Math.min(640,Math.round(width*recipe.definition.height/recipe.definition.width)));
  session=await services.openCapture({url:opened.data.url!,width,height},context.signal);
  const manifest=CaptureManifestSchema.parse(await session.manifest());
  const timeMs=parsed.data.timeMs??manifest.durationMs/2;
  if(timeMs>manifest.durationMs)throw fault("invalid-snapshot","Snapshot time must be within the scene duration.");
  const snapshot=SceneSnapshotSchema.parse({image:await session.snapshot(timeMs,manifest),timeMs});
  if(context.signal?.aborted)throw fault("export-cancelled","Snapshot cancelled; no image was saved.");
  const content=JSON.stringify({...(parseJsonDocument(original) as object),snapshot},null,2)+"\n";
  if(services.textBytes(content)>256_000)throw fault("snapshot-too-large","Recipe and snapshot exceed 256000 bytes. Simplify the scene source before retrying.");
  await services.writeRecipe(context.root,selected.source,content,original);
  return {success:true as const,data:{sceneId:recipe.id,source:selected.source,timeMs}};
  }catch(error){
   const known=error as {code?:string;message?:string};
   return {success:false as const,issues:[{code:known.code??"snapshot-failed",message:known.code&&known.message?known.message:"Snapshot failed. Check the scene, browser installation and source, then retry."}]};
  }finally{await session?.close()}
}

/** Capture-prerequisite probe for `velora doctor`.
 * WHAT: report real FFmpeg/Chromium availability without rendering.
 * WHY: agents diagnose export failures before spending minutes on a render.
 * WHERE: cli/index merges this with the project-side doctor checks.
 */
export async function probeCapturePrerequisites(): Promise<{
  ffmpeg: { available: boolean; detail: string };
  chromium: { available: boolean; detail: string };
  encoders?: Record<string, boolean>;
}> {
  const [ffmpeg, chromium] = await Promise.all([services.probeFfmpeg(), services.probeChromium()]);
  // Encoders are listed only once ffmpeg is known to run (no extra cold-start contention).
  const encoders = ffmpeg.available ? await services.probeEncoders() : undefined;
  return { ffmpeg, chromium, ...(encoders ? { encoders } : {}) };
}

// png is absent once a spill sink has taken the bytes (video renders stay bounded in memory).
export type RenderedFrame = { frame: number; timeMs: number; sceneId: string; segmentId: string; png?: Buffer; sha: string; cached: boolean; clamped: boolean; renderMs: number; subFrames?: string[]; layers?: { id: string; sha: string }[] };
type LayerResult = { sha: string; cached: boolean; clamped: boolean; renderMs: number; subFrames?: string[] };
export type LayerStore = { write: (key: string, png: Buffer) => Promise<void>; read: (key: string) => Promise<Buffer> };
/** Styled captions rendered by the studio's captions scene and composited as the top layer. */
export type CaptionLayer = { file: string; style: string; wordsFile?: string; durationMs: number; text: string; words?: string };
type CaptureUnit = { key: string; label: string; recipeId?: string; captions?: CaptionLayer; segmentId: string; transparent: boolean; inheritLook: boolean;
  items: { frame: number; timeMs: number; localMs: number; layered: boolean }[] };
/**
 * Finish one output frame from captured samples: the trailing-shutter sub-frames for motion blur
 * (adaptive skip when every sample is identical, so static frames stay byte-identical to no blur)
 * and the linear-light downscale of supersampled captures. Shared by render, export and shot.
 */
export type ExportLook = { look?: ReturnType<typeof resolveLook>; lut?: Lut3d };
/** Resolve a look's export finishing, loading its .cube LUT from the project. */
export async function loadExportLook(root: string, input: LookInput | undefined): Promise<ExportLook> {
  const look = resolveLook(input);
  if (!look?.lut) return { look };
  const text = await readText(root, look.lut, 8_000_000);
  if (text === undefined) throw fault("ERR_LOOK_INVALID", `LUT ${look.lut} was not found.`, "look.lut");
  try { return { look, lut: parseCube(text) }; }
  catch (error) { throw fault("ERR_LOOK_INVALID", `LUT ${look.lut} is invalid: ${error instanceof Error ? error.message : "unreadable"}`, "look.lut"); }
}
export async function finishFrame(timeMs: number, fps: number, endMs: number, finishing: Pick<ResolvedFinishing, "motionBlur" | "motionSamples" | "supersample">,
  sample: (timeMs: number) => Promise<Buffer>, exportLook: ExportLook = {}, size?: { width: number; height: number }): Promise<{ png: Buffer; subFrames?: string[] }> {
  const times = shutterSamples(timeMs, fps, finishing.motionBlur, finishing.motionSamples, endMs);
  const shots: Buffer[] = [];
  for (const time of times) shots.push(await sample(time));
  const shas = shots.map(services.sha256Hex);
  const distinct = new Set(shas).size > 1;
  const factor = finishing.supersample >= 2 ? Math.floor(finishing.supersample) : 1;
  const fractionalSize = finishing.supersample > 1 && !Number.isInteger(finishing.supersample) ? size : undefined;
  const png = finishLook(composite(distinct ? shots : [shots[0]], factor, fractionalSize), exportLook.look, exportLook.lut);
  return { png, ...(distinct ? { subFrames: shas } : {}) };
}
// Probe once per render: a missing encoder fails before any frame is captured.
async function requireEncoder(codec: ResolvedFinishing["codec"]) {
  if (codec === "h264") return;
  const encoders = await services.probeEncoders();
  if (encoders && !encoders[codec]) throw fault("ERR_CODEC_UNAVAILABLE", `This FFmpeg build has no ${services.CODEC_ENCODERS[codec]} encoder for --codec ${codec}.`);
}
// Output frame size for a capture scale: drafts encode from half-size frames (FFmpeg scales up).
const capturedSize = (width: number, height: number, scale: number) => scale < 1 ? { width: Math.max(2, Math.round(width * scale / 2) * 2), height: Math.max(2, Math.round(height * scale / 2) * 2) } : { width, height };
export type FrameWanted = { frame: number; timeMs: number };
export type ProgressFn = (done: number, total: number) => void;
export const DEFAULT_FRAME_CACHE = "node_modules/.cache/velora/frames";
// Shared timeline renderer: groups wanted frames by owning segment, renders
// each group through one capture session (segments run concurrently, frames
// stay serial-deterministic), synthesizes black void for gaps, and assembles
// results keyed by global frame. Single stills, sequences and video share it.
async function renderTimelineFrames(options: {
  root: string; url: string; version: string;
  fps: number; width: number; height: number; seed: number;
  catalog: SceneCatalog; timeline: Timeline; wanted: FrameWanted[];
  cacheDir: string | undefined; noCache: boolean; parallel: number;
  signal?: AbortSignal; onProgress?: ProgressFn;
  spill?: (frame: number, png: Buffer) => Promise<void>;
  finishing?: ResolvedFinishing;
  stageDpr?: StageDpr;
  /** Composition default look for scenes that declare none. */
  look?: LookInput;
  /** V2/V3 overlay tracks, composited over V1 in order (transparent capture, own local time). */
  overlays?: readonly CompositionOverlay[];
  /** Styled (DOM) captions rendered as the topmost overlay. */
  captions?: CaptionLayer;
  /** Where layer frames wait for compositing (disk in video mode, memory otherwise). */
  layerStore?: LayerStore;
}) {
  const { root, url, version, fps, width, height, seed, catalog, timeline, wanted, noCache, parallel, signal, onProgress, spill } = options;
  const finishing = options.finishing ?? resolveFinishing({}, { width, height });
  const output = capturedSize(width, height, finishing.supersample);
  const cacheDir = options.cacheDir ?? await defaultFrameCacheDir(options.root);
  // Host edits change pixels without touching the binding; an unfingerprintable tree renders uncached.
  const hostSha = noCache ? undefined : await services.hostFingerprint(root);
  const caching = hostSha !== undefined;
  const sorted = [...wanted].sort((a, b) => a.frame - b.frame);
  const frames = new Map<number, RenderedFrame>();
  const stageEvidence = new Map<string, StageLineage & { sceneId: string }>();
  const depthEvidence = new Map<string, ReturnType<typeof depthLineage>>();
  // With a spill sink, results keep metadata only; the sink owns the PNG bytes.
  const results = { set: async (frame: number, entry: RenderedFrame) => {
    if (spill && entry.png) { await spill(frame, entry.png); const { png: _spilled, ...meta } = entry; frames.set(frame, meta); }
    else frames.set(frame, entry);
  } };
  const overlays = options.overlays ?? [];
  // A frame is layered when it sits in an overlap window or under an overlay; everything else keeps the
  // single-capture path, so plain timelines render byte-identically to earlier versions.
  const overlaysAt = (timeMs: number) => overlays.filter(overlay => timeMs >= overlay.startMs && timeMs < overlay.startMs + overlay.durationMs);
  const plan = sorted.map(item => {
    const layers = layersAt(timeline, item.timeMs);
    const tops = overlaysAt(item.timeMs);
    const captioned = !!options.captions && item.timeMs < options.captions.durationMs;
    return { item, layers, tops, captioned, layered: layers.segments.length > 1 || tops.length > 0 || captioned };
  });
  const units = new Map<string, CaptureUnit>();
  const unit = (key: string, make: () => CaptureUnit) => { const found = units.get(key) ?? make(); units.set(key, found); return found; };
  for (const { item, layers, tops, captioned, layered } of plan) {
    for (const { segment, localMs } of layers.segments)
      unit(`seg:${segment.id}`, () => ({ key: `seg:${segment.id}`, label: `segment ${segment.id} (scene ${segment.recipe})`, recipeId: segment.recipe, segmentId: segment.id, transparent: false, inheritLook: true, items: [] }))
        .items.push({ frame: item.frame, timeMs: item.timeMs, localMs, layered });
    for (const overlay of tops)
      unit(`ov:${overlay.id}`, () => ({ key: `ov:${overlay.id}`, label: `overlay ${overlay.id} (scene ${overlay.recipe})`, recipeId: overlay.recipe, segmentId: overlay.id, transparent: true, inheritLook: false, items: [] }))
        .items.push({ frame: item.frame, timeMs: item.timeMs, localMs: item.timeMs - overlay.startMs + (overlay.inMs ?? 0), layered: true });
    if (captioned)
      unit("captions", () => ({ key: "captions", label: "captions overlay", captions: options.captions, segmentId: "captions", transparent: true, inheritLook: false, items: [] }))
        .items.push({ frame: item.frame, timeMs: item.timeMs, localMs: item.timeMs, layered: true });
  }
  const total = [...units.values()].reduce((sum, entry) => sum + entry.items.length, 0) + plan.filter(entry => !entry.layers.segments.length && !entry.layered).length;
  let done = 0;
  const tick = () => { done++; onProgress?.(done, total); };
  const memory = new Map<string, Buffer>();
  const store: LayerStore = options.layerStore ?? { write: async (key, png) => { memory.set(key, png); }, read: async key => memory.get(key)! };
  const layerMeta = new Map<string, LayerResult>();
  // Capture one unit (a V1 segment, an overlay or the captions layer) at its items' local times.
  const captureUnit = async (entry: CaptureUnit): Promise<void> => {
    let opened: string, recipeSha: string, bindingSha: string, durationLook: LookInput | undefined, authoredStage: Stage | undefined;
    let hasDepth = false;
    let sceneId = entry.recipeId ?? "captions";
    if (entry.captions) {
      const captions = entry.captions;
      opened = `${await previewBase(root, url)}?velora-preview=1&velora-captions=${encodeURIComponent(captions.file)}&velora-caption-style=${captions.style}&velora-caption-size=${width}x${height}&velora-caption-duration=${Math.ceil(captions.durationMs)}${captions.wordsFile ? `&velora-caption-words=${encodeURIComponent(captions.wordsFile)}` : ""}`;
      recipeSha = services.sha256Hex(`${captions.style}|${captions.text}|${captions.words ?? ""}`);
      bindingSha = "velora-captions-v1";
    } else {
      const recipe = catalog.scenes.find((scene) => scene.id === entry.recipeId);
      if (!recipe) throw fault("ERR_SCENE_NOT_FOUND", `Recipe "${entry.recipeId}" is not in the validated catalog. Run velora scenes --json to list available IDs.`, "render.composition");
      sceneId = recipe.id;
      const recipeText = await services.readRecipe(root, recipe.source, 256_000);
      const bindingText = await readText(root, recipe.binding, 2_000_000);
      if (recipeText === undefined || bindingText === undefined) throw fault("source-changed", "Scene source disappeared. Restore it and retry.");
      const scene = await executeRecipeCommand("open-scene", { sceneId: recipe.id, url, launch: false }, { root });
      if (!scene.success) throw fault("ERR_SCENE_INVALID", scene.issues.map((i) => i.message).join("\n"));
      const inherited = entry.inheritLook && !recipe.definition.look && options.look;
      opened = inherited ? `${scene.data.url!}${scene.data.url!.includes("?") ? "&" : "?"}velora-look=${encodeBase64Url(JSON.stringify(options.look))}` : scene.data.url!;
      recipeSha = services.sha256Hex(recipeText) + (inherited ? `;look=${services.sha256Hex(JSON.stringify(options.look))}` : "");
      bindingSha = services.sha256Hex(bindingText);
      durationLook = recipe.definition.look ?? (entry.inheritLook ? options.look : undefined);
      authoredStage = recipe.definition.stage;
      hasDepth = Object.values(recipe.definition.depth ?? {}).some(config => config.mode !== "off");
    }
    const unitFinishing = { ...finishing, supersample: resolveFinishing({ quality: finishing.quality, stageDpr: options.stageDpr }, { width, height }, authoredStage).supersample };
    const transparent = finishing.transparent || entry.transparent;
    const baseVariant = unitFinishing.supersample !== 1 || transparent ? `scale=${unitFinishing.supersample};alpha=${transparent ? 1 : 0}` : undefined;
    const exportLook = await loadExportLook(root, durationLook);
    const session = await services.openCapture({ url: opened, width, height, scale: unitFinishing.supersample, transparent }, signal);
    try {
      const bridge = CaptureManifestSchema.safeParse(await session.manifest());
      if (!bridge.success) throw fault("invalid-capture", "Scene capture bridge must use version 1, the scene viewport selector and a duration between 0 and 120 seconds.");
      if (authoredStage) stageEvidence.set(sceneId, { sceneId, ...stageLineage(authoredStage, unitFinishing, options.stageDpr) });
      const initialDepth = hasDepth ? await capturedDepth(session, Math.min(entry.items[0]?.localMs ?? 0, bridge.data.durationMs)) : depthLineage(bridge.data.depth);
      const variant = initialDepth.length ? `${baseVariant ?? ""};depth=${JSON.stringify(initialDepth)}` : baseVariant;
      for (const item of entry.items) {
        if (signal?.aborted) throw fault("export-cancelled", "Render cancelled; no output was published.");
        const started = Date.now();
        const clamped = item.localMs > bridge.data.durationMs;
        // Every sample (one, or the shutter's sub-frames) is cached by its own local time.
        let allCached = true;
        const sample = async (time: number) => {
          const key = caching ? services.frameCacheKey({ recipeSha, bindingSha, hostSha: hostSha!, timeMs: time, fps, width, height, seed, version, variant }) : "";
          const hit = caching ? await services.frameCacheLookup(root, cacheDir, key) : undefined;
          if (hit) return hit.png;
          allCached = false;
          const png = services.decodePngDataUrl(await session.snapshot(Math.min(time, bridge.data.durationMs), bridge.data));
          if (caching) await services.frameCacheStore(root, cacheDir, key, png);
          return png;
        };
        const finished = await finishFrame(item.localMs, fps, bridge.data.durationMs, unitFinishing, sample, exportLook, { width, height });
        const result: LayerResult = { sha: services.sha256Hex(finished.png), cached: caching && allCached, clamped, renderMs: Date.now() - started, ...(finished.subFrames ? { subFrames: finished.subFrames } : {}) };
        if (item.layered) { await store.write(`${entry.key}:${item.frame}`, finished.png); layerMeta.set(`${entry.key}:${item.frame}`, result); }
        else await results.set(item.frame, { frame: item.frame, timeMs: item.timeMs, sceneId, segmentId: entry.segmentId, png: finished.png, ...result });
        tick();
      }
      const finalDepth = await capturedDepth(session);
      if (finalDepth.length) depthEvidence.set(sceneId, finalDepth);
    } finally {
      await session.close();
    }
  };
  const queue = [...units.values()];
  const workers = Math.max(1, Math.min(Math.max(1, Math.floor(parallel)), queue.length || 1));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const entry = queue.shift();
      if (!entry) return;
      // Unexpected capture errors name the segment and scene they came from.
      await captureUnit(entry).catch((error: unknown) => {
        if (error && typeof error === "object" && "code" in error) throw error;
        throw fault("export-failed", `Capture failed in ${entry.label}${detailOf(error)}.`);
      });
    }
  }));
  // Gaps without layers are black void; layered frames are blended and composited in timeline order.
  for (const { item, layers, tops, captioned, layered } of plan) {
    if (signal?.aborted) throw fault("export-cancelled", "Render cancelled; no output was published.");
    if (!layered && layers.segments.length) continue;
    const started = Date.now();
    const parts: { id: string; sha: string }[] = [];
    let cached = true, clamped = false, renderMs = 0;
    const take = async (key: string, id: string) => {
      const meta = layerMeta.get(`${key}:${item.frame}`)!;
      parts.push({ id, sha: meta.sha });
      cached &&= meta.cached; clamped ||= meta.clamped; renderMs += meta.renderMs;
      return store.read(`${key}:${item.frame}`);
    };
    let png: Buffer;
    if (!layers.segments.length) { png = services.voidPng(output.width, output.height, finishing.transparent); cached = false; }
    else if (layers.blend) {
      const [a, b] = layers.segments;
      const transition = layers.blend.transition;
      png = blendTransition(transition.type, await take(`seg:${a.segment.id}`, a.segment.id), await take(`seg:${b.segment.id}`, b.segment.id), layers.blend.progress,
        { ...(transition.direction ? { direction: transition.direction } : {}), seed: transition.seed ?? seed });
    } else png = await take(`seg:${layers.segments[0].segment.id}`, layers.segments[0].segment.id);
    for (const overlay of overlays) if (tops.includes(overlay)) png = compositeOverlay(png, await take(`ov:${overlay.id}`, overlay.id), overlay.opacity, overlay.blend);
    if (captioned) png = compositeOverlay(png, await take("captions", "captions"));
    const top = layers.segments.length === 2 && (layers.blend?.progress ?? 0) >= 0.5 ? layers.segments[1] : layers.segments[0];
    await results.set(item.frame, { frame: item.frame, timeMs: item.timeMs, sceneId: top ? top.segment.recipe : "black-void", segmentId: top ? top.segment.id : "gap",
      png, sha: services.sha256Hex(png), cached: parts.length > 0 && cached, clamped, renderMs: renderMs + Date.now() - started, ...(parts.length > 1 ? { layers: parts } : {}) });
    if (!layers.segments.length && !layered) tick();
  }
  return { rendered: frames, stages: [...stageEvidence.values()].sort((a, b) => a.sceneId.localeCompare(b.sceneId)),
    depth: [...depthEvidence.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([sceneId, values]) => values.map(value => ({ sceneId, ...value }))) };
}

/** Render one exact timeline frame from a composition to PNG plus a manifest.
 * WHAT: resolve frame<->time through the canonical clock, capture the owning
 * scene (or black void for gaps) and publish bytes with a reproducibility manifest.
 * WHY: agents inspect real pixels at exact positions without hand-rolling seeks.
 * WHERE: cli `render --frame/--time` adapts arguments; frames/video build on this.
 */
export async function executeFrameRender(
  input: unknown,
  context: { root: string; url?: string; version?: string; signal?: AbortSignal },
): Promise<FrameRenderResult> {
  try {
    const parsed = RESOURCES["render-frame"].safeParse(input);
    if (!parsed.success) return { success: false, issues: parsed.error.issues.map((i) => ({ code: "invalid-input", message: `${i.path.join(".")}: ${i.message}` })) };
    if (!context || typeof context.root !== "string") throw fault("invalid-scope", "Provide an absolute local project directory.");
    const version = context.version ?? "development";
    let root: string;
    try {
      root = await canonicalRoot(context.root);
    } catch {
      throw fault("invalid-scope", "Provide an absolute local project directory.");
    }
    const loaded = await loadComposition(root, parsed.data.composition);
    if ("issues" in loaded) return { success: false, issues: loaded.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) };
    const composition = loaded.composition;
    const timeline = timelineFromComposition(composition);
    const checked = validateTimeline(timeline);
    if (!checked.valid) return { success: false, issues: checked.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) };
    const fps = composition.fps;
    // Both modes converge on the canonical grid: --time resolves to its
    // nearest frame first, so requested milliseconds never leak into renders.
    const frame = parsed.data.frame !== undefined ? parsed.data.frame : frameAt(parsed.data.timeMs!, fps);
    const timeMs = timeAtFrame(frame, fps);
    if (!(timeMs < timeline.durationMs))
      throw fault("ERR_FRAME_OUT_OF_RANGE", `Frame ${frame} (${timeMs}ms) is outside the ${timeline.durationMs}ms timeline.`, "render.frame");
    const noCache = parsed.data.noCache ?? false;
    const cacheDir = parsed.data.cacheDir ?? await defaultFrameCacheDir(root);
    const scope = await services.prepareFileOutput(root, parsed.data.out);
    const manifestPath = parsed.data.out.replace(/\.png$/i, "") + ".manifest.json";
    const catalog = await discoverRecipes(root);
    const sourceText = await readText(root, parsed.data.composition, 256_000);
    if (sourceText === undefined) throw fault("source-changed", "Composition source disappeared. Restore it and retry.");
    const { rendered, stages, depth } = await renderTimelineFrames({
      root, url: context.url ?? "http://127.0.0.1:5173", version,
      fps, width: composition.width, height: composition.height, seed: composition.seed, look: composition.look, overlays: composition.overlays, captions: await captionLayerFor(root, composition),
      catalog, timeline, wanted: [{ frame, timeMs }], cacheDir, noCache, parallel: 1, signal: context.signal, stageDpr: parsed.data.stageDpr,
    });
    const entry = rendered.get(frame);
    if (!entry) throw fault("export-failed", "Frame render produced no output.");
    const evidence = timelineStageFields(stages);
    const manifest = RenderManifestSchema.parse({
      version: 1 as const, kind: "frame" as const, compositionId: composition.id,
      compositionSha: services.sha256Hex(sourceText),
      seed: composition.seed, fps, width: composition.width, height: composition.height,
      durationMs: timeline.durationMs,
      segments: timeline.segments.map((s) => ({ id: s.id, recipe: s.recipe, startMs: s.startMs, durationMs: s.durationMs, frames: frameAt(s.startMs + s.durationMs, fps) - frameAt(s.startMs, fps) })),
      frames: [{ frame: entry.frame, timeMs: entry.timeMs, sceneId: entry.sceneId, segmentId: entry.segmentId, file: parsed.data.out, sha: entry.sha, renderMs: entry.renderMs, ...(entry.cached ? { cached: true as const } : {}), ...(entry.clamped ? { clamped: true as const } : {}) }],
      veloraVersion: version, ...evidence.fields, ...(depth.length ? { depth } : {}),
      checks: [{ id: "bridge-present", pass: true, detail: entry.sceneId === "black-void" ? "Timeline gap renders black void without a browser." : "Capture bridge served this frame." }, ...evidence.checks],
      createdAt: new Date().toISOString(),
    });
    await services.writeNewFile(scope, entry.png!);
    await services.writeNewTextFile(await services.prepareFileOutput(root, manifestPath), JSON.stringify(manifest, null, 2) + "\n");
    return { success: true, data: { out: parsed.data.out, manifest: manifestPath, frame: entry.frame, timeMs: entry.timeMs, sceneId: entry.sceneId, segmentId: entry.segmentId, sha: entry.sha, cached: entry.cached } };
  } catch (error) {
    const known = error as { code?: string; message?: string; target?: string };
    return { success: false, issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : `Frame render failed${detailOf(error)}. Check the composition, scene server and retry.`, ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
  }
}

/** Render a full composition timeline to MP4 plus a reproducibility manifest.
 * WHAT: every global frame renders through the shared timeline renderer
 * (segments concurrently, frames serially, gaps as black void), encodes as one
 * global PNG stream, then mixes positioned audio and burns captions.
 * WHY: agents get cinematic multi-scene video with evidence, not promises.
 * WHERE: cli `render` (video mode) adapts arguments; frames/shot/check reuse
 * the same renderer core and manifest lineage.
 */
export async function executeVideoRender(
  input: unknown,
  context: { root: string; url?: string; version?: string; signal?: AbortSignal; onProgress?: ProgressFn },
): Promise<VideoRenderResult> {
  let tmpDir: string | undefined;
  try {
    const parsed = RESOURCES["render-video"].safeParse(input);
    if (!parsed.success) return { success: false, issues: parsed.error.issues.map((i) => ({ code: "invalid-input", message: `${i.path.join(".")}: ${i.message}` })) };
    if (!context || typeof context.root !== "string") throw fault("invalid-scope", "Provide an absolute local project directory.");
    const version = context.version ?? "development";
    const url = context.url ?? "http://127.0.0.1:5173";
    let root: string;
    try {
      root = await canonicalRoot(context.root);
    } catch {
      throw fault("invalid-scope", "Provide an absolute local project directory.");
    }
    const full = await checkCompositionFull(root, parsed.data.composition);
    if (full.issues.length) return { success: false, issues: full.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) };
    const composition = full.composition!;
    // A delivery preset supplies defaults; explicit flags win.
    const target = parsed.data.preset === undefined ? undefined : findDeliveryPreset(parsed.data.preset);
    const preset = target;
    if (parsed.data.preset !== undefined && !target) throw fault("invalid-input", `Unknown delivery preset "${parsed.data.preset}". List presets with velora guide --json (capabilities.delivery).`, "render.preset");
    const fps = parsed.data.fps ?? (target && !(target.fps as number[]).includes(composition.fps) ? target.fps[0] : composition.fps);
    const width = parsed.data.width ?? target?.width ?? composition.width;
    const height = parsed.data.height ?? target?.height ?? composition.height;
    const requested = { ...parsed.data, codec: parsed.data.codec ?? target?.codec, quality: parsed.data.quality ?? target?.quality, gifFps: parsed.data.gifFps ?? target?.gifFps };
    const finishing = resolveFinishing(requested, { width, height });
    const extension = parsed.data.out.slice(parsed.data.out.lastIndexOf(".")).toLowerCase();
    if (target && !CODEC_CONTAINERS[finishing.codec].includes(extension))
      throw fault("invalid-input", `Preset ${target.id} encodes ${finishing.codec}; name the output ${CODEC_CONTAINERS[finishing.codec][0]} or pass --codec.`, "render.out");
    if (finishing.transparent && !ALPHA_CODECS.includes(finishing.codec))
      throw fault("invalid-input", `--transparent needs an alpha codec (${ALPHA_CODECS.join(" or ")}); ${finishing.codec} has no alpha.`, "render.transparent");
    if (composition.captions?.burnIn && finishing.codec !== "h264")
      throw fault("invalid-input", "Burned-in captions re-encode H.264; render with --codec h264, or set captions.burnIn to false.", "render.composition");
    const warnings: { code: string; message: string }[] = [];
    await requireEncoder(finishing.codec);
    const timeline = timelineFromComposition(composition, fps);
    const checked = validateTimeline(timeline);
    if (!checked.valid) return { success: false, issues: checked.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) };
    const total = Math.ceil((timeline.durationMs * fps) / 1000);
    if (total < 1) throw fault("ERR_FRAME_OUT_OF_RANGE", "The timeline spans less than one frame.", "render.composition");
    const scope = await services.prepareFileOutput(root, parsed.data.out);
    const base = parsed.data.out.slice(0, -extension.length);
    // MP4 keeps <name>.manifest.json; other containers keep their extension so variants never collide.
    const manifestPath = (extension === ".mp4" ? base : parsed.data.out) + ".manifest.json";
    // Refuse before rendering: a late manifest conflict must never leave a published video behind.
    for (const target of [parsed.data.out, manifestPath, ...(parsed.data.poster !== undefined ? [base + ".poster.png"] : [])])
      if (await services.fileSize(await services.resolveOutput(root, target)) !== undefined)
        throw fault("output-exists", `Output ${target} already exists. Choose another filename.`, target);
    const sourceText = await readText(root, parsed.data.composition, 256_000);
    if (sourceText === undefined) throw fault("source-changed", "Composition source disappeared. Restore it and retry.");
    const wanted: FrameWanted[] = Array.from({ length: total }, (_, frame) => ({ frame, timeMs: timeAtFrame(frame, fps) }));
    const noCache = parsed.data.noCache ?? false;
    const cacheDir = parsed.data.cacheDir ?? await defaultFrameCacheDir(root);
    const parallel = parsed.data.parallel ?? services.defaultParallelism();
    tmpDir = await services.makeTempDir(root, ".velora-video-");
    const frameDir = `${tmpDir}/frames`;
    const layerDir = `${tmpDir}/layers`;
    // Layer frames (transitions, overlays, captions) wait on disk so long renders stay bounded in memory.
    const layerStore: LayerStore = { write: (key, png) => services.spillFile(layerDir, key, png), read: key => services.readSpilledFile(layerDir, key) };
    const { rendered, stages, depth } = await renderTimelineFrames({
      root, url, version, fps, width, height, seed: composition.seed, look: composition.look, overlays: composition.overlays, captions: await captionLayerFor(root, composition),
      catalog: full.catalog, timeline, wanted, cacheDir, noCache, parallel,
      signal: context.signal, onProgress: context.onProgress,
      spill: (frame, png) => services.spillFrame(frameDir, frame, png), finishing, layerStore, stageDpr: requested.stageDpr,
    });
    const ordered = wanted.map((w) => rendered.get(w.frame)!);
    const pngs = services.spilledFrames(frameDir, ordered.map((entry) => entry.frame));
    const finalAbs = await services.resolveOutput(root, parsed.data.out);
    const encode = { fps, width, height, cwd: root, signal: context.signal, codec: finishing.codec, quality: finishing.quality, transparent: finishing.transparent, gifFps: finishing.gifFps, x264: finishing.x264, crf: finishing.crf, ...(finishing.crfOverride !== undefined ? { crfOverride: finishing.crfOverride } : {}) };
    // GIF carries no audio or captions; say so instead of failing the render.
    const silent = finishing.codec === "gif";
    if (silent && (composition.audio.length || composition.captions))
      warnings.push({ code: "WARN_GIF_SILENT", message: "GIF has no audio or caption track; they were left out of this render." });
    // Sound design: composition sfx plus each transition's sfx, placed at the cut.
    const sfxEntries = compositionSfx(composition);
    const needsMux = !silent && (composition.audio.length > 0 || !!composition.captions || sfxEntries.length > 0);
    let loudnessData: { target: Loudness; measured: LoudnessMeasurement; result: LoudnessMeasurement; skipped?: true } | undefined;
    let ffmpegArgs: string[];
    let audioData: { tracks: { id: string; assetId: string; startMs: number }[]; driftMs: number } | undefined;
    let captionsData: { file?: string; cues: number; burnIn: boolean; windows: { startMs: number; endMs: number }[] } | undefined;
    if (!needsMux) {
      ffmpegArgs = (await services.encodeFrameBuffers(pngs, finalAbs, encode)).ffmpegArgs;
    } else {
      const tmpVideo = `${tmpDir}/video${extension}`;
      await services.encodeFrameBuffers(pngs, tmpVideo, encode);
      const tracks = [];
      for (const track of composition.audio) {
        const resolved = resolveAssetId(full.assets, full.aliases, track.assetId);
        if (!resolved) throw fault("ERR_ASSET_NOT_FOUND", `Audio asset "${track.assetId}" was not discovered.`, "render.composition");
        const absolute = await services.resolveOutput(root, resolved);
        const probe = await services.probeAudioFile(absolute);
        if (!probe.codec) throw fault("ERR_AUDIO_CODEC", `Audio ${resolved} could not be probed.`, "render.composition");
        const placed = audioPlacement(track, fps);
        tracks.push({ id: track.id, file: absolute, startMs: placed.startMs, offsetMs: track.offsetMs, gain: track.gain, fadeInMs: track.fadeInMs, fadeOutMs: track.fadeOutMs, audioMs: probe.durationMs ?? 0,
          ...(track.durationMs !== undefined ? { durationMs: track.durationMs } : {}), ...(track.duckUnder ? { duckUnderTrackId: track.duckUnder.trackId } : {}) });
      }
      for (const entry of sfxEntries) {
        const file = `${tmpDir}/sfx/${entry.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.wav`;
        const { durationMs } = await services.synthesizeSfx(entry, file);
        tracks.push({ id: entry.id, file, startMs: sfxStartMs(entry), offsetMs: 0, gain: 1, fadeInMs: 0, fadeOutMs: 0, audioMs: durationMs });
      }
      if (tracks.filter((t) => t.duckUnderTrackId).length > 1)
        throw fault("ERR_AUDIO_INVALID", "Only one ducking relationship is supported. Premix additional ducking outside Velora.", "render.composition");
      let captionsFile: string | undefined;
      let cues = 0;
      let windows: { startMs: number; endMs: number }[] = [];
      if (composition.captions) {
        const ref = composition.captions.file;
        const lower = ref.toLowerCase();
        const text = await readText(root, ref, 256_000);
        if (text === undefined) throw fault("ERR_CAPTION_INVALID", `Caption file ${ref} was not found.`, "render.composition");
        const parsedCaptions = parseCaptions(text, lower.endsWith(".vtt") ? "vtt" : "srt");
        if ("issues" in parsedCaptions) throw fault("ERR_CAPTION_INVALID", `Caption file ${ref} is invalid: ${parsedCaptions.issues[0].message}`, "render.composition");
        cues = parsedCaptions.cues.length;
        windows = parsedCaptions.cues.map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs }));
        if (composition.captions.burnIn && !domCaptions(composition.captions)) {
          captionsFile = lower.endsWith(".vtt")
            ? await services.writeTempText(tmpDir, "captions.srt", formatSrt(parsedCaptions.cues))
            : await services.resolveOutput(root, ref);
        }
      }
      let fontsDir: string | undefined;
      if (captionsFile) fontsDir = await services.existingDir(root, "assets");
      ffmpegArgs = (await services.muxAudioCaptions({ video: tmpVideo, tracks, ...(captionsFile ? { captionsFile } : {}), ...(fontsDir ? { fontsDir } : {}), output: finalAbs })).ffmpegArgs;
      // Two-pass loudness normalization of the mix (default -14 LUFS / -1 dBTP; loudness: false skips it).
      if (tracks.length && composition.loudness !== false) {
        // The composition's loudness wins; otherwise the delivery preset's target (e.g. -14 LUFS for social).
        const target = LoudnessSchema.parse(composition.loudness ?? (preset?.loudnessLufs !== undefined ? { integrated: preset.loudnessLufs } : {}));
        loudnessData = { target, ...(await services.normalizeLoudness(finalAbs, target)) };
      }
      if (tracks.length) {
        const drift = await services.probeAvDrift(finalAbs);
        if (drift.driftMs === null || drift.driftMs > AUDIO_DRIFT_BUDGET_MS) {
          await services.cleanupTemp(finalAbs).catch(() => {});
          throw fault("ERR_AUDIO_DRIFT", drift.driftMs === null
            ? `Could not measure A/V drift for ${parsed.data.out}; nothing was published.`
            : `A/V drift is ${drift.driftMs}ms over the ${AUDIO_DRIFT_BUDGET_MS}ms budget; nothing was published.`, parsed.data.out);
        }
        audioData = { tracks: composition.audio.map((track) => {
          const placed = audioPlacement(track, fps);
          return { id: track.id, assetId: track.assetId, startMs: placed.startMs };
        }), driftMs: drift.driftMs };
      }
      if (composition.captions) captionsData = { file: composition.captions.file, cues, burnIn: composition.captions.burnIn, windows };
    }
    // Poster: the finished frame nearest the requested time, written beside the video.
    let poster: string | undefined;
    if (parsed.data.poster !== undefined) {
      poster = base + ".poster.png";
      const index = Math.min(ordered.length - 1, frameAt(Math.min(parsed.data.poster, timeline.durationMs), fps));
      await services.writeNewFile(await services.prepareFileOutput(root, poster), await pngs.read(index));
    }
    // Aspect variants re-capture the timeline at each frame size; the scene cover-fits the new frame.
    const variants: { aspect: string; out: string; width: number; height: number }[] = [];
    for (const aspect of parsed.data.aspects ?? []) {
      const frame = ASPECT_FRAMES[aspect];
      const scale = Math.min(1, 3840 / Math.max(frame.width, frame.height), Math.max(width, height) / Math.max(frame.width, frame.height));
      const size = { width: Math.round(frame.width * scale / 2) * 2, height: Math.round(frame.height * scale / 2) * 2 };
      if (size.width === width && size.height === height) continue;
      const out = `${base}-${size.width}x${size.height}${extension}`;
      const variantDir = `${tmpDir}/variant-${variants.length}`;
      const { rendered: variantFrames } = await renderTimelineFrames({
        root, url, version, fps, ...size, seed: composition.seed, look: composition.look, overlays: composition.overlays, captions: await captionLayerFor(root, composition), catalog: full.catalog, timeline, wanted, cacheDir, noCache, parallel,
        signal: context.signal, onProgress: context.onProgress, spill: (index, png) => services.spillFrame(variantDir, index, png),
        finishing: resolveFinishing(requested, size), stageDpr: requested.stageDpr,
      });
      await services.encodeFrameBuffers(services.spilledFrames(variantDir, wanted.map(w => variantFrames.get(w.frame)!.frame)), await services.resolveOutput(root, out), { ...encode, ...size });
      variants.push({ aspect, out, ...size });
    }
    if (variants.length && composition.audio.length)
      warnings.push({ code: "WARN_VARIANT_SILENT", message: "Aspect variants are encoded without the audio mix; mux audio into them in your editor or render each aspect with --width/--height." });
    if (target) {
      const bytes = await services.fileSize(finalAbs);
      warnings.push(...deliveryWarnings(target, { width, height, fps, durationMs: timeline.durationMs, ...(bytes !== undefined ? { bytes } : {}) }));
    }
    const evidence = timelineStageFields(stages);
    const manifest = RenderManifestSchema.parse({
      version: 1 as const, kind: "video" as const, compositionId: composition.id,
      compositionSha: services.sha256Hex(sourceText),
      seed: composition.seed, fps, width, height, durationMs: timeline.durationMs,
      segments: timeline.segments.map((s) => ({ id: s.id, recipe: s.recipe, startMs: s.startMs, durationMs: s.durationMs, frames: ordered.filter((e) => e.segmentId === s.id).length })),
      frames: ordered.map((entry) => ({ frame: entry.frame, timeMs: entry.timeMs, sceneId: entry.sceneId, segmentId: entry.segmentId, sha: entry.sha, renderMs: entry.renderMs, ...(entry.cached ? { cached: true as const } : {}), ...(entry.clamped ? { clamped: true as const } : {}), ...(entry.subFrames ? { subFrames: entry.subFrames } : {}), ...(entry.layers ? { layers: entry.layers } : {}) })),
      ...(audioData ? { audio: audioData } : {}),
      ...(captionsData ? { captions: captionsData } : {}),
      // JSON has no NaN or infinity: unmeasurable values are recorded as null with skipped: true.
      ...(loudnessData ? { loudness: JSON.parse(JSON.stringify(loudnessData, (_key, value) => typeof value === "number" && !Number.isFinite(value) ? null : value)) } : {}),
      ...(sfxEntries.length && needsMux ? { sfx: sfxEntries.map(({ id, preset, atMs, gainDb, seed }) => ({ id, preset, atMs, gainDb, seed })) } : {}),
      ffmpegArgs, veloraVersion: version,
      quality: finishing.quality, codec: finishing.codec, container: extension.slice(1), colorimetry: finishing.codec === "gif" ? undefined : "bt709",
      ...(finishing.motionBlur > 0 ? { motionBlur: { shutter: finishing.motionBlur, samples: finishing.motionSamples } } : {}),
      supersample: Math.max(finishing.supersample, ...stages.map(stage => stage.effectiveDpr)), transparent: finishing.transparent, workers: parallel, ...(poster ? { poster } : {}),
      ...evidence.fields, ...(depth.length ? { depth } : {}), checks: [{ id: "bridge-present", pass: true, detail: "Segments captured through the capture bridge; gaps render black void." }, ...evidence.checks],
      createdAt: new Date().toISOString(),
    });
    await services.writeNewTextFile(await services.prepareFileOutput(root, manifestPath), JSON.stringify(manifest, null, 2) + "\n");
    const cachedFrames = ordered.filter((e) => e.cached).length;
    return { success: true, data: { out: parsed.data.out, manifest: manifestPath, frames: total, durationMs: timeline.durationMs, fps, width, height, seed: composition.seed, cachedFrames, renderedFrames: total - cachedFrames,
      codec: finishing.codec, quality: finishing.quality, ...(poster ? { poster } : {}), ...(variants.length ? { variants } : {}), ...(warnings.length ? { warnings } : {}) } };
  } catch (error) {
    const known = error as { code?: string; message?: string; target?: string };
    return { success: false, issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : `Video render failed${detailOf(error)}. Check the composition, scene server and retry.`, ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
  } finally {
    if (tmpDir) await services.cleanupTemp(tmpDir).catch(() => {});
  }
}

/** Extract a PNG sequence plus manifest.json from a composition.
 * WHAT: a frame subset (every Nth or explicit times) rendered through the
 * shared timeline renderer and published as files with a frames manifest.
 * WHY: agents inspect evidence stills without re-rendering whole videos.
 * WHERE: cli `frames` adapts arguments; check consumes the manifest.
 */
export async function executeFramesRender(
  input: unknown,
  context: { root: string; url?: string; version?: string; signal?: AbortSignal; onProgress?: ProgressFn },
): Promise<FramesRenderResult> {
  try {
    const parsed = RESOURCES["render-frames"].safeParse(input);
    if (!parsed.success) return { success: false, issues: parsed.error.issues.map((i) => ({ code: "invalid-input", message: `${i.path.join(".")}: ${i.message}` })) };
    if (!context || typeof context.root !== "string") throw fault("invalid-scope", "Provide an absolute local project directory.");
    const version = context.version ?? "development";
    const url = context.url ?? "http://127.0.0.1:5173";
    let root: string;
    try {
      root = await canonicalRoot(context.root);
    } catch {
      throw fault("invalid-scope", "Provide an absolute local project directory.");
    }
    const full = await checkCompositionFull(root, parsed.data.composition);
    if (full.issues.length) return { success: false, issues: full.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) };
    const composition = full.composition!;
    const fps = composition.fps;
    const timeline = timelineFromComposition(composition);
    const checked = validateTimeline(timeline);
    if (!checked.valid) return { success: false, issues: checked.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) };
    const total = Math.ceil((timeline.durationMs * fps) / 1000);
    let wanted: FrameWanted[];
    if (parsed.data.at !== undefined) {
      const seen = new Set<number>();
      wanted = [];
      for (const at of parsed.data.at) {
        const frame = frameAt(at, fps);
        const timeMs = timeAtFrame(frame, fps);
        if (!(timeMs < timeline.durationMs))
          throw fault("ERR_FRAME_OUT_OF_RANGE", `Time ${at}ms (frame ${frame}) is outside the ${timeline.durationMs}ms timeline.`, "render.frames");
        if (!seen.has(frame)) {
          seen.add(frame);
          wanted.push({ frame, timeMs });
        }
      }
    } else {
      const every = parsed.data.every ?? fps;
      wanted = [];
      for (let frame = 0; frame < total; frame += every) wanted.push({ frame, timeMs: timeAtFrame(frame, fps) });
    }
    if (!wanted.length) throw fault("ERR_FRAME_OUT_OF_RANGE", "No frames selected within the timeline span.", "render.frames");
    const manifestPath = `${parsed.data.out}/manifest.json`;
    await services.prepareFileOutput(root, manifestPath);
    const sourceText = await readText(root, parsed.data.composition, 256_000);
    if (sourceText === undefined) throw fault("source-changed", "Composition source disappeared. Restore it and retry.");
    const { rendered, stages, depth } = await renderTimelineFrames({
      root, url, version, fps, width: composition.width, height: composition.height, seed: composition.seed, look: composition.look, overlays: composition.overlays, captions: await captionLayerFor(root, composition),
      catalog: full.catalog, timeline, wanted,
      cacheDir: parsed.data.cacheDir ?? await defaultFrameCacheDir(root), noCache: parsed.data.noCache ?? false,
      parallel: services.defaultParallelism(), signal: context.signal, onProgress: context.onProgress,
    });
    const pad = (n: number) => String(n).padStart(5, "0");
    const frames = [...wanted].sort((a, b) => a.frame - b.frame).map((w) => {
      const entry = rendered.get(w.frame)!;
      return { entry, file: `frame-${pad(w.frame)}.png` };
    });
    for (const { entry, file } of frames) {
      const scope = await services.prepareFileOutput(root, `${parsed.data.out}/${file}`);
      await services.writeNewFile(scope, entry.png!);
    }
    const evidence = timelineStageFields(stages);
    const manifest = RenderManifestSchema.parse({
      version: 1 as const, kind: "frames" as const, compositionId: composition.id,
      compositionSha: services.sha256Hex(sourceText),
      seed: composition.seed, fps, width: composition.width, height: composition.height,
      durationMs: timeline.durationMs,
      segments: timeline.segments.map((s) => ({ id: s.id, recipe: s.recipe, startMs: s.startMs, durationMs: s.durationMs, frames: frameAt(s.startMs + s.durationMs, fps) - frameAt(s.startMs, fps) })),
      frames: frames.map(({ entry, file }) => ({ frame: entry.frame, timeMs: entry.timeMs, sceneId: entry.sceneId, segmentId: entry.segmentId, file, sha: entry.sha, renderMs: entry.renderMs, ...(entry.cached ? { cached: true as const } : {}), ...(entry.clamped ? { clamped: true as const } : {}) })),
      veloraVersion: version, ...evidence.fields, ...(depth.length ? { depth } : {}),
      checks: [{ id: "bridge-present", pass: true, detail: "Frames captured through the capture bridge; gaps render black void." }, ...evidence.checks],
      createdAt: new Date().toISOString(),
    });
    await services.writeNewTextFile(await services.prepareFileOutput(root, manifestPath), JSON.stringify(manifest, null, 2) + "\n");
    let contactSheet: string | undefined;
    if (parsed.data.contactSheet) {
      contactSheet = `${parsed.data.out}/contact-sheet.png`;
      const sheet = services.contactSheet(frames.map(({ entry }) => entry.png!), parsed.data.columns ? { columns: parsed.data.columns } : {});
      await services.writeNewFile(await services.prepareFileOutput(root, contactSheet), sheet);
    }
    return { success: true, data: { out: parsed.data.out, manifest: manifestPath, total: frames.length,
      frames: frames.map(({ entry, file }) => ({ frame: entry.frame, file, sha: entry.sha })), ...(contactSheet ? { contactSheet } : {}) } };
  } catch (error) {
    const known = error as { code?: string; message?: string; target?: string };
    return { success: false, issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : `Frame extraction failed${detailOf(error)}. Check the composition, scene server and retry.`, ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
  }
}

/** Capture one still from a single scene without a composition. */
export async function executeShotRender(
  input: unknown,
  context: { root: string; url?: string; version?: string; signal?: AbortSignal },
): Promise<ShotRenderResult> {
  let session: Awaited<ReturnType<typeof services.openCapture>> | undefined;
  try {
    const parsed = RESOURCES["render-shot"].safeParse(input);
    if (!parsed.success) return { success: false, issues: parsed.error.issues.map((i) => ({ code: "invalid-input", message: `${i.path.join(".")}: ${i.message}` })) };
    if (!context || typeof context.root !== "string") throw fault("invalid-scope", "Provide an absolute local project directory.");
    let root: string;
    try {
      root = await canonicalRoot(context.root);
    } catch {
      throw fault("invalid-scope", "Provide an absolute local project directory.");
    }
    const url = context.url ?? "http://127.0.0.1:5173";
    const opened = await executeRecipeCommand("open-scene", { sceneId: parsed.data.scene, url, launch: false }, { root });
    if (!opened.success) return { success: false, issues: opened.issues.map((i) => ({ code: "ERR_SCENE_INVALID", path: i.path, message: i.message })) };
    const selected = opened.data.selected!;
    const scope = await services.prepareFileOutput(root, parsed.data.out);
    const size = { width: selected.definition.width, height: selected.definition.height };
    // Still preview of export finishing: the same finisher as render and export.
    const finishing = resolveFinishing(parsed.data, size, selected.definition.stage);
    session = await services.openCapture({ url: opened.data.url!, ...size, scale: finishing.supersample, transparent: finishing.transparent }, context.signal);
    const bridge = CaptureManifestSchema.safeParse(await session.manifest());
    if (!bridge.success) throw fault("invalid-capture", "Scene capture bridge must use version 1, the scene viewport selector and a duration between 0 and 120 seconds.");
    const clamped = parsed.data.timeMs > bridge.data.durationMs;
    const capture = session;
    const exportLook = parsed.data.finish ? await loadExportLook(root, bridge.data.look) : {};
    const { png } = await finishFrame(clamped ? bridge.data.durationMs : parsed.data.timeMs, parsed.data.fps ?? 60, bridge.data.durationMs, finishing,
      async time => services.decodePngDataUrl(await capture.snapshot(time, bridge.data)), exportLook, size);
    const depth = await capturedDepth(session);
    const sha = services.sha256Hex(png);
    await services.writeNewFile(scope, png);
    const stage = selected.definition.stage && stageLineage(selected.definition.stage, finishing, parsed.data.stageDpr);
    return { success: true, data: { out: parsed.data.out, sceneId: selected.id, timeMs: parsed.data.timeMs, sha, ...(clamped ? { clamped: true as const } : {}),
      ...(stage ? { stage, checks: [stageCheck(stage)] } : {}), ...(depth.length ? { depth } : {}) } };
  } catch (error) {
    const known = error as { code?: string; message?: string; target?: string };
    return { success: false, issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : `Shot capture failed${detailOf(error)}. Check the scene, server and retry.`, ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
  } finally {
    await session?.close();
  }
}

function recordFlash(record: (id: string, pass: boolean, detail: string, frameRefs?: string[]) => void, failures: { code: string; message: string }[], report: ReturnType<typeof flashRisk>, target: string) {
  const at = report.atMs !== undefined ? ` from ${Math.round(report.atMs)}ms` : "";
  record("flash-safety", report.pass, report.pass
    ? `At most ${report.worst} flash${report.worst === 1 ? "" : "es"} per second over a large area (limit ${FLASH_LIMIT_PER_SECOND}; WCAG 2.3.1 approximation).`
    : `${report.worst} ${report.kind} flashes per second${at} over ${Math.round(report.area * 100)}% of the frame (limit ${FLASH_LIMIT_PER_SECOND}).`,
    report.pass || report.atMs === undefined ? undefined : [`${Math.round(report.atMs)}ms`]);
  if (!report.pass) failures.push({ code: "ERR_FLASH_RISK", message: `${target}: ${report.worst} ${report.kind} flashes per second${at} exceed the ${FLASH_LIMIT_PER_SECOND}-per-second limit.` });
}
// Advisory only: banding never fails a check.
function recordBanding(record: (id: string, pass: boolean, detail: string, frameRefs?: string[]) => void, worst: number, file: string) {
  const visible = worst > 0.15;
  record("banding", true, visible
    ? `ADV_BANDING: ${Math.round(worst * 100)}% of ${file} is flat 8-bit gradient steps; add look grain or render --codec hevc.`
    : `No large banded gradients (worst ${Math.round(worst * 100)}%).`, visible ? [file] : undefined);
}
// The first line of an unexpected error, so failures name their cause instead of a generic sentence.
function detailOf(error: unknown): string {
  return error instanceof Error && error.message ? `: ${error.message.split("\n")[0].slice(0, 300)}` : "";
}
/** Composition sfx plus transition sfx (at the cut: mid-window for overlap transitions, the segment start otherwise). */
export function compositionSfx(composition: Pick<Composition, "sfx" | "scenes">): SfxEntry[] {
  const entries = [...composition.sfx];
  for (const scene of composition.scenes) {
    const sfx = scene.transition?.sfx;
    if (!sfx || !scene.transition) continue;
    const spec = typeof sfx === "string" ? { preset: sfx, gainDb: -6 } : sfx;
    const atMs = isOverlapTransition(scene.transition.type) ? scene.startMs + scene.transition.durationMs / 2 : scene.startMs;
    entries.push(SfxEntrySchema.parse({ id: `transition-${scene.id}`, preset: spec.preset, atMs, gainDb: spec.gainDb, seed: scene.transition.seed ?? 1 }));
  }
  return entries.sort((a, b) => a.atMs - b.atMs);
}
// DOM caption styles render as an overlay layer; "burn" (or no style) keeps the FFmpeg subtitles path.
const domCaptions = (captions: { style?: string } | undefined) => !!captions?.style && captions.style !== "burn";
/** The styled-captions layer for a composition, with the caption (and word) text that keys the cache. */
async function captionLayerFor(root: string, composition: Composition): Promise<CaptionLayer | undefined> {
  if (!composition.captions || !domCaptions(composition.captions)) return undefined;
  const text = await readText(root, composition.captions.file, 256_000);
  if (text === undefined) throw fault("ERR_CAPTION_INVALID", `Caption file ${composition.captions.file} was not found.`, "render.composition");
  const words = composition.captions.wordsFile ? await readText(root, composition.captions.wordsFile, 1_000_000) : undefined;
  if (composition.captions.wordsFile && words === undefined) throw fault("ERR_CAPTION_INVALID", `Words file ${composition.captions.wordsFile} was not found.`, "render.composition");
  return { file: composition.captions.file, style: composition.captions.style!, ...(composition.captions.wordsFile ? { wordsFile: composition.captions.wordsFile } : {}),
    durationMs: timelineDuration(composition.scenes), text, ...(words !== undefined ? { words } : {}) };
}
function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}
function refsOf(refs: string[]): { frameRefs?: string[]; more: string } {
  return refs.length > 10 ? { frameRefs: refs.slice(0, 10), more: ` (+${refs.length - 10} more)` } : { frameRefs: refs.length ? refs : undefined, more: "" };
}
/** Run automated visual checks over rendered evidence (frames or video).
 * WHAT: technical-only verification (manifest integrity, blank/dimension/
 * coverage/drift/budget evidence). Never artistic scores.
 * WHY: agents close the render loop on pixels, not promises.
 * WHERE: cli `check` adapts arguments; reviewAuthoring stays advisory.
 * Checks that cannot evaluate (no cue windows, no timings, no audio) are
 * omitted with nothing hidden: the returned list is exactly what ran.
 */
export async function executeCheck(
  input: unknown,
  context: { root: string },
): Promise<CheckRenderResult> {
  let tmpDir: string | undefined;
  try {
    const parsed = RESOURCES["render-check"].safeParse(input);
    if (!parsed.success) return { success: false, command: "check", issues: parsed.error.issues.map((i) => ({ code: "invalid-input", message: `${i.path.join(".")}: ${i.message}` })) };
    if (!context || typeof context.root !== "string") throw fault("invalid-scope", "Provide an absolute local project directory.");
    let root: string;
    try {
      root = await canonicalRoot(context.root);
    } catch {
      throw fault("invalid-scope", "Provide an absolute local project directory.");
    }
    const checks: VisualCheck[] = [];
    const failures: { code: string; message: string }[] = [];
    const target = parsed.data.frames ?? parsed.data.video!;
    const record = (id: string, pass: boolean, detail: string, frameRefs?: string[]) => {
      checks.push({ id, pass, detail, ...(frameRefs?.length ? { frameRefs } : {}) });
    };
    if (parsed.data.frames !== undefined) {
      const dir = parsed.data.frames;
      const manifestRel = `${dir}/manifest.json`;
      const text = await services.readRecipe(root, manifestRel, 2_000_000);
      if (text === undefined) throw fault("ERR_VISUAL_MANIFEST", `Manifest ${manifestRel} was not found. Render frames first.`, target);
      let document: unknown;
      try {
        document = parseJsonDocument(text);
      } catch {
        throw fault("ERR_VISUAL_MANIFEST", `Manifest ${manifestRel} is not valid JSON.`, target);
      }
      const manifest = RenderManifestSchema.safeParse(document);
      if (!manifest.success) throw fault("ERR_VISUAL_MANIFEST", `Manifest ${manifestRel} is invalid: ${manifest.error.issues[0].message}`, target);
      const data = manifest.data;
      if (data.kind !== "frames" && data.kind !== "frame")
        throw fault("ERR_VISUAL_MANIFEST", `Manifest ${manifestRel} describes ${data.kind}, not frames.`, target);
      const resolved: { file: string; png: Buffer }[] = [];
      const missing: string[] = [];
      const mismatched: string[] = [];
      for (const entry of data.frames) {
        const candidates = entry.file ? [entry.file, `${dir}/${entry.file.split("/").pop()}`] : [`${dir}/frame-${String(entry.frame).padStart(5, "0")}.png`];
        let png: Buffer | undefined;
        let used = candidates[0];
        for (const candidate of candidates) {
          try {
            // Frame PNGs are bounded captures; the read cap matches services.
            const bytes = await readBytes(root, candidate, 2_000_000);
            if (bytes !== undefined) {
              png = bytes;
              used = candidate;
              break;
            }
          } catch { continue; }
        }
        if (!png) {
          missing.push(entry.file ?? `${dir}/frame-${entry.frame}`);
          continue;
        }
        if (services.sha256Hex(png) !== entry.sha) {
          mismatched.push(used);
          continue;
        }
        resolved.push({ file: used, png });
      }
      {
        const bad = [...missing.map((f) => `${f} (missing)`), ...mismatched.map((f) => `${f} (sha mismatch)`)];
        const { frameRefs, more } = refsOf(bad);
        record("manifest-valid", !bad.length, bad.length ? `${bad.length} frame files fail integrity${more}.` : `${resolved.length} frame files match the manifest SHAs.`, frameRefs);
        if (bad.length) failures.push({ code: "ERR_VISUAL_MANIFEST", message: `Manifest integrity failed for ${bad.length} frames${more}.` });
      }
      const decoded = new Map<string, { width: number; height: number; pixels: Buffer } | null>();
      for (const { file, png } of resolved) {
        try {
          const parsed = services.parsePng(png);
          decoded.set(file, { width: parsed.width, height: parsed.height, pixels: parsed.pixels });
        } catch {
          decoded.set(file, null);
        }
      }
      {
        const bad: string[] = [];
        for (const { file } of resolved) {
          const image = decoded.get(file);
          if (!image) bad.push(`${file} (unreadable PNG)`);
          else if (image.width !== data.width || image.height !== data.height) bad.push(`${file} (${image.width}x${image.height})`);
        }
        const { frameRefs, more } = refsOf(bad);
        record("dimensions", !bad.length, bad.length ? `${bad.length} frames differ from ${data.width}x${data.height}${more}.` : `All frames are ${data.width}x${data.height}.`, frameRefs);
        if (bad.length) failures.push({ code: "ERR_VISUAL_DIMENSIONS", message: `Frame dimensions differ from the ${data.width}x${data.height} canvas${more}.` });
      }
      {
        const bad: string[] = [];
        for (const entry of data.frames) {
          if (entry.sceneId === "black-void") continue;
          const candidates = entry.file ? [entry.file, `${dir}/${entry.file.split("/").pop()}`] : [];
          const file = candidates.find((c) => decoded.has(c) && decoded.get(c) !== null);
          if (!file) continue;
          const image = decoded.get(file)!;
          const { mean, variance } = services.luminanceStats(image.pixels);
          if (mean < 4 && variance < 4) bad.push(file);
        }
        const { frameRefs, more } = refsOf(bad);
        record("no-blank", !bad.length, bad.length ? `${bad.length} near-black frames${more}.` : "No near-black frames (timeline gaps excluded).", frameRefs);
        if (bad.length) failures.push({ code: "ERR_VISUAL_BLANK", message: `${bad.length} rendered frames are blank${more}.` });
      }
      {
        const windows = data.captions?.windows ?? [];
        if (windows.length) {
          const uncovered = windows.filter((w) => !data.frames.some((e) => e.timeMs >= w.startMs && e.timeMs < w.endMs));
          record("caption-coverage", !uncovered.length, uncovered.length
            ? `${uncovered.length} cue windows contain no frame (${uncovered.map((w) => `${w.startMs}-${w.endMs}ms`).join(", ")}).`
            : `All ${windows.length} cue windows contain frames.`);
          if (uncovered.length) failures.push({ code: "ERR_VISUAL_COVERAGE", message: `${uncovered.length} caption cue windows contain no rendered frame.` });
        }
      }
      {
        // Flash safety needs consecutive frames: a sparse sequence (--every N) cannot see flicker.
        const ordered = [...data.frames].sort((a, b) => a.frame - b.frame);
        const consecutive = ordered.length >= 3 && ordered.every((entry, index) => index === 0 || entry.frame === ordered[index - 1].frame + 1);
        if (consecutive) {
          const grid = ordered.map(entry => {
            const file = entry.file ? [entry.file, `${dir}/${entry.file.split("/").pop()}`].find(c => decoded.get(c)) : undefined;
            const image = file ? decoded.get(file) : undefined;
            return image ? { timeMs: entry.timeMs, rgb: services.gridOf(image.pixels, image.width, image.height, 8, 8) } : undefined;
          }).filter((frame): frame is { timeMs: number; rgb: Buffer } => !!frame);
          recordFlash(record, failures, flashRisk(grid, 64), target);
        } else record("flash-safety", true, "Skipped: flash analysis needs consecutive frames (render without --every/--at, or check the video).");
        let worst = 0, worstFile = "";
        for (const [file, image] of decoded) if (image) { const score = bandingScore(image.pixels, image.width, image.height); if (score > worst) { worst = score; worstFile = file; } }
        recordBanding(record, worst, worstFile);
      }
      {
        const timings = data.frames.map((e) => e.renderMs).filter((v): v is number => typeof v === "number");
        if (timings.length) {
          const p95 = percentile95(timings);
          const budget = parsed.data.budgetMs;
          const over = budget !== undefined && p95 > budget;
          record("fps-budget", !over, `Frame render p95 is ${Math.round(p95)}ms over ${timings.length} frames${budget !== undefined ? ` against a ${budget}ms budget` : " (no budget given; evidence only)"}.`);
          if (over) failures.push({ code: "ERR_VISUAL_BUDGET", message: `Frame render p95 ${Math.round(p95)}ms exceeds the ${budget}ms budget.` });
        }
      }
    } else {
      const abs = await services.resolveOutput(root, parsed.data.video!);
      const probe = await services.probeVideoFile(abs);
      if (!probe.video) {
        record("streams-present", false, `No video stream found in ${parsed.data.video}.`);
        failures.push({ code: "ERR_VISUAL_MANIFEST", message: `No video stream found in ${parsed.data.video}.` });
      } else {
        record("streams-present", true, `${probe.video.codec} ${probe.video.width}x${probe.video.height}, ${probe.durationMs !== null ? `${Math.round(probe.durationMs)}ms` : "unknown duration"}.`);
      }
      let manifest: { fps: number; width: number; height: number; durationMs: number; segments: { startMs: number; durationMs: number }[]; frames: { frame: number; timeMs: number; renderMs?: number }[]; audio?: { driftMs?: number }; captions?: { burnIn?: boolean; windows?: { startMs: number; endMs: number }[] } } | undefined;
      if (parsed.data.manifest) {
        const text = await services.readRecipe(root, parsed.data.manifest, 2_000_000);
        if (text === undefined) throw fault("ERR_VISUAL_MANIFEST", `Manifest ${parsed.data.manifest} was not found.`, target);
        let document: unknown;
        try {
          document = parseJsonDocument(text);
        } catch {
          throw fault("ERR_VISUAL_MANIFEST", `Manifest ${parsed.data.manifest} is not valid JSON.`, target);
        }
        const { RenderManifestSchema } = await import("../core/export");
        const validated = RenderManifestSchema.safeParse(document);
        if (!validated.success) throw fault("ERR_VISUAL_MANIFEST", `Manifest ${parsed.data.manifest} is invalid: ${validated.error.issues[0].message}`, target);
        manifest = validated.data;
        const mismatches: string[] = [];
        if (probe.video) {
          if (manifest.fps !== undefined && Math.abs(probe.video.fps - manifest.fps) > 0.01) mismatches.push(`fps ${probe.video.fps} != ${manifest.fps}`);
          if (manifest.width !== undefined && probe.video.width !== manifest.width) mismatches.push(`width ${probe.video.width} != ${manifest.width}`);
          if (manifest.height !== undefined && probe.video.height !== manifest.height) mismatches.push(`height ${probe.video.height} != ${manifest.height}`);
          if (manifest.frames.length > 0 && probe.video.frames !== null && manifest.frames.length !== probe.video.frames) mismatches.push(`frames ${probe.video.frames} != ${manifest.frames.length}`);
        }
        record("manifest-valid", !mismatches.length, mismatches.length ? `Manifest disagrees with the video: ${mismatches.join("; ")}.` : "Manifest matches the probed video.");
        if (mismatches.length) failures.push({ code: "ERR_VISUAL_MANIFEST", message: `Manifest disagrees with the video: ${mismatches.join("; ")}.` });
      }
      if (probe.video) {
        tmpDir = await services.makeTempDir(root, ".velora-check-");
        const samples = await services.decodeVideoSamples(abs, tmpDir, 16);
        {
          const bad: string[] = [];
          const dims = new Set<string>();
          // Mirror the frames suite: timeline gaps synthesize black void by
          // design, so gap samples are excluded from blank detection when the
          // manifest maps segments to times.
          const ranges = (manifest?.segments ?? []).map((segment) => ({ start: segment.startMs, end: segment.startMs + segment.durationMs }));
          const inGap = (timeMs: number) => ranges.length > 0 && !ranges.some((range) => timeMs >= range.start && timeMs < range.end);
          let skipped = 0;
          for (const [i, sample] of samples.entries()) {
            try {
              const decoded = services.parsePng(sample.png);
              dims.add(`${decoded.width}x${decoded.height}`);
              if (inGap(sample.timeMs)) { skipped++; continue; }
              const { mean, variance } = services.luminanceStats(decoded.pixels);
              if (mean < 4 && variance < 4) bad.push(`sample-${i}`);
            } catch {
              bad.push(`sample-${i} (unreadable)`);
            }
          }
          const { frameRefs, more } = refsOf(bad);
          const gapNote = skipped > 0 ? " (timeline gaps excluded)" : "";
          record("no-blank", !bad.length, bad.length ? `${bad.length} blank samples${more}${gapNote}.` : `${samples.length - skipped} sampled frames are non-blank${gapNote}.`, frameRefs);
          if (bad.length) failures.push({ code: "ERR_VISUAL_BLANK", message: `${bad.length} sampled video frames are blank${more}${gapNote}.` });
          if (dims.size > 1) {
            record("dimensions", false, `Sampled frames differ in size: ${[...dims].join(", ")}.`);
            failures.push({ code: "ERR_VISUAL_DIMENSIONS", message: "Sampled video frames differ in size." });
          } else if (samples.length) {
            record("dimensions", true, `Sampled frames share one size.`);
          }
        }
        {
          const windows = manifest?.captions?.windows ?? [];
          if (windows.length) {
            const uncovered = windows.filter((w) => !samples.some((s) => s.timeMs >= w.startMs && s.timeMs < w.endMs));
            const detail = manifest?.captions?.burnIn === false ? "captions recorded without burn-in; " : "";
            record("caption-visible", !uncovered.length, uncovered.length
              ? `${detail}${uncovered.length} cue windows have no sampled frame.`
              : `${detail}All ${windows.length} cue windows are covered by sampled frames.`);
            if (uncovered.length) failures.push({ code: "ERR_VISUAL_COVERAGE", message: `${uncovered.length} caption cue windows have no sampled video frame.` });
          }
        }
        {
          const grid = await services.decodeLuminanceGrid(abs);
          recordFlash(record, failures, flashRisk(grid.frames, 64), target);
          let worst = 0, worstFile = "";
          for (const [i, sample] of samples.entries()) {
            try { const image = services.parsePng(sample.png); const score = bandingScore(image.pixels, image.width, image.height); if (score > worst) { worst = score; worstFile = `sample-${i}`; } } catch { /* unreadable samples are reported above */ }
          }
          recordBanding(record, worst, worstFile);
        }
        {
          const recorded = manifest?.audio;
          if (recorded) {
            if (recorded.driftMs !== undefined) {
              const over = recorded.driftMs > 40;
              record("av-drift", !over, `Manifest records A/V drift ${recorded.driftMs}ms against the 40ms budget.`);
              if (over) failures.push({ code: "ERR_VISUAL_DRIFT", message: `Recorded A/V drift ${recorded.driftMs}ms exceeds 40ms.` });
            } else if (probe.audio) {
              const drift = await services.probeAvDrift(abs);
              if (drift.driftMs === null || drift.driftMs > 40) {
                record("av-drift", false, drift.driftMs === null ? "Could not measure A/V drift." : `Measured A/V drift ${drift.driftMs}ms exceeds 40ms.`);
                failures.push({ code: "ERR_VISUAL_DRIFT", message: drift.driftMs === null ? "Could not measure A/V drift." : `Measured A/V drift ${drift.driftMs}ms exceeds 40ms.` });
              } else {
                record("av-drift", true, `Measured A/V drift ${drift.driftMs}ms within 40ms.`);
              }
            } else {
              record("av-drift", false, "Manifest claims audio but the video has no audio stream.");
              failures.push({ code: "ERR_VISUAL_MANIFEST", message: "Manifest claims audio but the video has no audio stream." });
            }
          } else if (probe.audio) {
            const drift = await services.probeAvDrift(abs);
            if (drift.driftMs === null || drift.driftMs > 40) {
              record("av-drift", false, drift.driftMs === null ? "Could not measure A/V drift." : `Measured A/V drift ${drift.driftMs}ms exceeds 40ms.`);
              failures.push({ code: "ERR_VISUAL_DRIFT", message: drift.driftMs === null ? "Could not measure A/V drift." : `Measured A/V drift ${drift.driftMs}ms exceeds 40ms.` });
            } else {
              record("av-drift", true, `Measured A/V drift ${drift.driftMs}ms within 40ms.`);
            }
          }
        }
      }
    }
    if (failures.length)
      return { success: false as const, command: "check" as const, data: { target, checks },
        issues: failures.map((f) => ({ code: f.code, path: target, message: f.message })) };
    return { success: true as const, command: "check" as const, data: { target, checks } };
  } catch (error) {
    const known = error as { code?: string; message?: string; target?: string };
    return { success: false as const, command: "check" as const,
      issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : `Visual check failed${detailOf(error)}. Check the rendered evidence and retry.`, ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
  } finally {
    if (tmpDir) await services.cleanupTemp(tmpDir).catch(() => {});
  }
}

/** Every launch asset from one composition.
 * WHAT: for each requested target (core/deliverables) render the preset's video through executeVideoRender
 * (size, codec, quality, loudness from the preset), climb a deterministic CRF ladder until the file fits the
 * preset's byte budget, and publish it with its poster; website-hero adds an H.264 fallback, a JPEG poster
 * and embed snippets; og-image and product-hunt add exact-size stills. deliverables.json records every file,
 * SHA, size, attempt, loudness and warning.
 * WHY: a launch needs a dozen correctly sized files; one reproducible command replaces hand-tuned exports.
 * WHERE: cli `deliver` adapts arguments; attempts live in <out>/.velora-attempts and are removed at the end.
 */
export type DeliverResult =
  | { success: true; data: { out: string; manifest: string; targets: { name: string; preset: string; files: string[]; warnings: { code: string; message: string }[] }[] } }
  | { success: false; issues: { code: string; message: string; path?: string }[] };
export async function executeDeliver(
  input: unknown,
  context: { root: string; url?: string; version?: string; signal?: AbortSignal; onProgress?: ProgressFn },
  render: typeof executeVideoRender = executeVideoRender,
  still: typeof executeFrameRender = executeFrameRender,
): Promise<DeliverResult> {
  const parsed = DeliverInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map((i) => ({ code: "invalid-input", message: `${i.path.join(".")}: ${i.message}` })) };
  const options = parsed.data;
  let root: string;
  try { root = await canonicalRoot(context.root); }
  catch { return { success: false, issues: [{ code: "invalid-scope", message: "Provide an absolute local project directory." }] }; }
  const { targets, unknown } = resolveDeliverTargets(options.targets);
  if (unknown.length) return { success: false, issues: unknown.map((name) => ({ code: "ERR_DELIVER_TARGET", path: "targets", message: `Unknown target "${name}". Use ${ALL_DELIVER_TARGETS.join(", ")} or a delivery preset id.` })) };
  const full = await checkCompositionFull(root, options.composition);
  if (full.issues.length) return { success: false, issues: full.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) };
  const composition = full.composition!;
  const outDir = (options.out ?? `deliverables/${composition.id}`).replace(/\\/g, "/").replace(/\/+$/, "");
  if (await services.existingDir(root, outDir)) return { success: false, issues: [{ code: "output-exists", path: outDir, message: `${outDir} already exists. Deliver writes a fresh directory; choose another --out or move the old one.` }] };
  const scratch = `${outDir}/.velora-attempts`;
  const hero = heroTimeMs(composition);
  const durationMs = timelineDuration(composition.scenes);
  const shared = { composition: options.composition, ...(options.parallel ? { parallel: options.parallel } : {}), ...(options.noCache ? { noCache: true } : {}),
    ...(options.stageDpr ? { stageDpr: options.stageDpr } : {}) };
  const manifestFor = (out: string) => out.toLowerCase().endsWith(".mp4") ? out.slice(0, -4) + ".manifest.json" : out + ".manifest.json";
  const report: DeliverablesManifest["targets"] = [];
  let attemptId = 0;
  type RenderedVideo = { out: string; bytes: number; width: number; height: number; durationMs: number; codec: string; manifest: string; poster?: string; measuredLufs?: number; warnings: { code: string; message: string }[] };
  // One video at a preset through the size ladder; returns the published file (or the last attempt over budget).
  async function deliverVideo(target: DeliverTarget, finalName: string, attempts: DeliverablesManifest["targets"][number]["attempts"], extra: { codec?: VideoCodec; poster?: boolean } = {}): Promise<RenderedVideo> {
    const codec = extra.codec ?? target.preset.codec;
    const quality = options.quality ?? target.preset.quality;
    const ladder = sizeLadder(codec, quality, target.preset.gifFps ?? 15);
    let chosen: { out: string; data: Extract<VideoRenderResult, { success: true }>["data"]; bytes: number } | undefined;
    for (const step of ladder) {
      const out = `${scratch}/${attemptId++}-${finalName}`;
      const result = await render({ ...shared, out, preset: target.preset.id, quality, codec,
        ...(step.crf !== undefined ? { crf: step.crf } : {}), ...(step.gifFps !== undefined ? { gifFps: step.gifFps } : {}),
        ...(extra.poster !== false && codec !== "gif" ? { poster: hero } : {}) }, { ...context, root });
      if (!result.success) throw fault(result.issues[0]?.code ?? "export-failed", `${target.name}: ${result.issues[0]?.message ?? "render failed"}`, `targets.${target.name}`);
      const bytes = (await services.fileSize(await services.resolveOutput(root, out))) ?? 0;
      const withinBudget = !target.preset.maxBytes || bytes <= target.preset.maxBytes;
      attempts.push({ ...(step.crf !== undefined ? { crf: step.crf } : {}), ...(step.gifFps !== undefined ? { gifFps: step.gifFps } : {}), bytes, withinBudget });
      chosen = { out, data: result.data, bytes };
      if (withinBudget) break;
    }
    const finalOut = `${outDir}/${finalName}`;
    await services.promoteFile(root, chosen!.out, finalOut);
    await services.promoteFile(root, chosen!.data.manifest, manifestFor(finalOut));
    let poster: string | undefined;
    if (chosen!.data.poster) {
      poster = finalOut.replace(/\.[a-z0-9]+$/i, "") + ".poster.png";
      await services.promoteFile(root, chosen!.data.poster, poster);
    }
    // Loudness evidence from the render manifest; very long manifests (over the 2 MB read cap) simply omit it.
    const manifestText = await readText(root, manifestFor(finalOut), 2_000_000).catch(() => undefined);
    const renderManifest = RenderManifestSchema.safeParse(manifestText ? JSON.parse(manifestText) : {});
    const measured = renderManifest.success ? renderManifest.data.loudness?.result?.integrated ?? undefined : undefined;
    const warnings = [...(chosen!.data.warnings ?? [])];
    if (!attempts.at(-1)!.withinBudget)
      warnings.push({ code: "WARN_DELIVER_BUDGET", message: `${target.preset.title}: ${finalName} is ${(chosen!.bytes / 1048576).toFixed(1)} MB after ${attempts.length} attempts, over the ${((target.preset.maxBytes ?? 0) / 1048576).toFixed(0)} MB budget. Shorten the cut or lower the frame rate.` });
    return { out: finalOut, bytes: chosen!.bytes, width: chosen!.data.width, height: chosen!.data.height, durationMs: chosen!.data.durationMs, codec: chosen!.data.codec ?? codec,
      manifest: manifestFor(finalOut), ...(poster ? { poster } : {}), ...(typeof measured === "number" ? { measuredLufs: measured } : {}), warnings };
  }
  // One exact-size still: the composition frame at timeMs, cover-cropped to the preset (or given) size.
  async function deliverStill(name: string, timeMs: number, size: { width: number; height: number }, warnings: { code: string; message: string }[]): Promise<string> {
    const frameOut = `${scratch}/${attemptId++}-${name.replace(/\.[a-z]+$/i, "")}.png`;
    const result = await still({ composition: options.composition, timeMs, out: frameOut, ...(options.noCache ? { noCache: true } : {}),
      ...(options.stageDpr ? { stageDpr: options.stageDpr } : {}) }, { ...context, root });
    if (!result.success) throw fault(result.issues[0]?.code ?? "export-failed", `${name}: ${result.issues[0]?.message ?? "frame render failed"}`, `targets.${name}`);
    const png = await services.readRendered(root, frameOut);
    if (!png) throw fault("export-failed", `${name}: the rendered frame is missing.`);
    const out = `${outDir}/${name}`;
    await services.encodeStill(root, png, out, size);
    if (Math.abs(composition.width / composition.height - size.width / size.height) > 0.02 && !warnings.some((w) => w.code === "WARN_DELIVER_CROPPED"))
      warnings.push({ code: "WARN_DELIVER_CROPPED", message: `${composition.width}x${composition.height} frames are center-cropped to ${size.width}x${size.height}; compose a dedicated scene if the crop loses the subject.` });
    return out;
  }
  try {
    await services.ensureDir(root, scratch);
    for (const target of targets) {
      const files: DeliverablesManifest["targets"][number]["files"] = [];
      const attempts: DeliverablesManifest["targets"][number]["attempts"] = [];
      const warnings: { code: string; message: string }[] = [];
      const add = async (filePath: string, role: DeliverablesManifest["targets"][number]["files"][number]["role"], meta: Partial<DeliverablesManifest["targets"][number]["files"][number]> = {}) => {
        files.push({ path: filePath, role, bytes: (await services.fileSize(await services.resolveOutput(root, filePath))) ?? 0, sha256: await services.sha256File(root, filePath), ...meta });
      };
      let measuredLufs: number | undefined;
      const addVideo = async (video: RenderedVideo, role: "video" | "fallback") => {
        await add(video.out, role, { width: video.width, height: video.height, durationMs: video.durationMs, codec: video.codec, renderManifest: video.manifest });
        warnings.push(...video.warnings.filter((w) => !warnings.some((seen) => seen.code === w.code && seen.message === w.message)));
        measuredLufs ??= video.measuredLufs;
      };
      if (target.kind === "video" || target.kind === "product-hunt") {
        const extension = CODEC_CONTAINERS[target.preset.codec][0];
        const video = await deliverVideo(target, `${target.name}${extension}`, attempts);
        await addVideo(video, "video");
        if (video.poster) await add(video.poster, "poster", { width: video.width, height: video.height });
        if (target.kind === "product-hunt")
          for (const [index, timeMs] of galleryTimesMs(durationMs).entries())
            await add(await deliverStill(`${target.name}-${index + 1}.png`, timeMs, target.preset, warnings), "still", { width: target.preset.width, height: target.preset.height });
      } else if (target.kind === "website-hero") {
        const webm = await deliverVideo(target, "hero.webm", attempts);
        const mp4 = await deliverVideo(target, "hero.mp4", attempts, { codec: "h264", poster: false });
        await addVideo(webm, "video");
        await addVideo(mp4, "fallback");
        const posterPng = webm.poster ? await services.readRendered(root, webm.poster) : undefined;
        if (!posterPng) throw fault("export-failed", "website-hero: the poster frame is missing.");
        await services.encodeStill(root, posterPng, `${outDir}/hero.poster.jpg`, { width: webm.width, height: webm.height });
        await removeFile(root, webm.poster!);
        await add(`${outDir}/hero.poster.jpg`, "poster", { width: webm.width, height: webm.height });
        const heroFiles = { webm: "hero.webm", mp4: "hero.mp4", poster: "hero.poster.jpg", width: webm.width, height: webm.height, title: composition.title };
        await services.writeNewTextFile(await services.prepareFileOutput(root, `${outDir}/embed.html`), heroEmbedHtml(heroFiles));
        await services.writeNewTextFile(await services.prepareFileOutput(root, `${outDir}/HeroVideo.tsx`), heroVideoTsx(heroFiles));
        await add(`${outDir}/embed.html`, "embed");
        await add(`${outDir}/HeroVideo.tsx`, "component");
        if (durationMs > 15_000) warnings.push({ code: "WARN_DELIVER_HERO_LONG", message: `Website heroes read best at 8-15 s; this film is ${(durationMs / 1000).toFixed(1)} s.` });
      } else {
        await add(await deliverStill(`${target.name}.png`, hero, target.preset, warnings), "still", { width: target.preset.width, height: target.preset.height });
      }
      report.push({ name: target.name, preset: target.preset.id, kind: target.kind, presetLastVerified: target.preset.lastVerified,
        ...(target.preset.loudnessLufs !== undefined && target.kind !== "still" ? { loudnessLufs: composition.loudness === false ? undefined : composition.loudness?.integrated ?? target.preset.loudnessLufs } : {}),
        ...(measuredLufs !== undefined ? { measuredLufs } : {}), files, attempts, warnings });
    }
    const sourceText = (await readText(root, options.composition, 2_000_000)) ?? "";
    const manifest = DeliverablesManifestSchema.parse({
      version: 1, composition: options.composition, compositionId: composition.id, compositionSha: services.sha256Hex(sourceText),
      heroTimeMs: hero, veloraVersion: context.version ?? "development", createdAt: new Date().toISOString(), targets: report,
    });
    const manifestPath = `${outDir}/deliverables.json`;
    await services.writeNewTextFile(await services.prepareFileOutput(root, manifestPath), JSON.stringify(manifest, null, 2) + "\n");
    return { success: true, data: { out: outDir, manifest: manifestPath, targets: report.map((t) => ({ name: t.name, preset: t.preset, files: t.files.map((f) => f.path), warnings: t.warnings })) } };
  } catch (error) {
    const known = error as { code?: string; message?: string; target?: string };
    return { success: false, issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : `Deliver failed${detailOf(error)}.`, ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
  } finally {
    await services.removeScratchDir(root, scratch).catch(() => {});
    await services.removeEmptyDir(root, outDir);
  }
}
