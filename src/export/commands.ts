import { RESOURCES } from "../core/resources";
import { AUDIO_DRIFT_BUDGET_MS, SUPPORTED_AUDIO_CODECS, audioPlacement } from "../core/audio";
import { resolveAssetId } from "../core/assets";
import { formatSrt, parseCaptions } from "../core/captions";
import { CaptureManifestSchema, RenderManifestSchema, type CheckRenderResult, type ExportVideoResult, type FrameRenderResult, type FramesRenderResult, type ShotRenderResult, type VideoRenderResult, type VisualCheck } from "../core/export";
import { frameAt, localTime, segmentAt, timeAtFrame, timelineDuration, timelineFromComposition, validateTimeline, TimelineSchema, type Timeline, type TimelineSegment } from "../core/timeline";
import { SceneRecipeSchema, SceneSnapshotSchema, type SceneCatalog } from "../core/recipes";
import {executeRecipeCommand} from "../project/recipes";
import {discoverRecipes, loadComposition} from "../project/discovery";
import {checkCompositionFull} from "../project/commands";
import { canonicalRoot, readText, readBytes } from "../project/services";
import { fault } from "../project/errors";
import * as services from "./services";

/** SOURCE OF TRUTH: executeVideoExport, executeSceneSnapshot, executeFrameRender trusted operations.
 * WHAT: validate requests, local scope and capture state before publishing video.
 * WHY: CLI and other callers must share the same export policy and canonical scene clock.
 * WHERE: cli/index adapts arguments; services owns all browser/filesystem/process effects.
 */
export async function executeVideoExport(input: unknown, context: { root: string; signal?: AbortSignal }): Promise<ExportVideoResult> {
  let session: Awaited<ReturnType<typeof services.openCapture>> | undefined;
  try {
    const parsed = RESOURCES["export-video"].safeParse(input);
    if (!parsed.success) return { success: false, issues: parsed.error.issues.map(i => ({ code: "invalid-export", message: `${i.path.join(".")}: ${i.message}` })) };
    services.validateTarget(parsed.data.output);
    const scope = await services.prepareScope(context.root, parsed.data.output);
    session = await services.openCapture(parsed.data, context.signal);
    const manifest = CaptureManifestSchema.safeParse(await session.manifest());
    if (!manifest.success) throw fault("invalid-capture", "Scene capture bridge must use version 1, the scene viewport selector and a duration between 0 and 120 seconds.");
    if(manifest.data.durationMs===0)throw fault("invalid-capture","Video export needs a scene with a nonzero duration. Static scenes support snapshots.");
    const frames = Math.ceil(manifest.data.durationMs * parsed.data.fps / 1000);
    const data: { output: string; fps: number; frames: number; durationMs: number } & {
      audio?: { file: string; codec: string; driftMs: number; peakDb: number | null };
      captions?: { file: string; cues: number; burnIn: boolean };
    } = { output: parsed.data.output, fps: parsed.data.fps, frames, durationMs: frames * 1000 / parsed.data.fps };
    if (!parsed.data.audio && !parsed.data.captions) {
      await session.encode(scope, parsed.data, manifest.data, frames);
      return { success: true, data };
    }
    // Audio/caption post-pass: encode the silent master to a staged temp file,
    // then mix/burn in one FFmpeg pass and publish only the in-spec result.
    const staged = await services.stageTempVideo(scope);
    try {
      await session.encode(staged.scope, parsed.data, manifest.data, frames);
      const post = await services.mixPostAudioCaptions(scope, staged.scope.output, {
        ...(parsed.data.audio ? { audio: parsed.data.audio } : {}),
        ...(parsed.data.captions ? { captions: parsed.data.captions } : {}),
      });
      Object.assign(data, post);
      return { success: true, data };
    } finally {
      await staged.cleanup();
    }
  } catch (error) {
    const known = error as { code?: string; message?: string };
    return { success: false, issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : "Video export failed. Check the local scene server and retry." }] };
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
  const recipe=SceneRecipeSchema.parse(JSON.parse(original));
  if(recipe.id!==selected.id||JSON.stringify(recipe.definition)!==JSON.stringify(selected.definition))throw fault("source-changed","Scene source changed. Retry the snapshot.");
  // Small cached image; keep the authored aspect ratio and canonical playback clock.
  const width=320, height=Math.max(64,Math.min(640,Math.round(width*recipe.definition.height/recipe.definition.width)));
  session=await services.openCapture({url:opened.data.url!,width,height},context.signal);
  const manifest=CaptureManifestSchema.parse(await session.manifest());
  const timeMs=parsed.data.timeMs??manifest.durationMs/2;
  if(timeMs>manifest.durationMs)throw fault("invalid-snapshot","Snapshot time must be within the scene duration.");
  const snapshot=SceneSnapshotSchema.parse({image:await session.snapshot(timeMs,manifest),timeMs});
  if(context.signal?.aborted)throw fault("export-cancelled","Snapshot cancelled; no image was saved.");
  const content=JSON.stringify({...JSON.parse(original),snapshot},null,2)+"\n";
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
}> {
  const [ffmpeg, chromium] = await Promise.all([services.probeFfmpeg(), services.probeChromium()]);
  return { ffmpeg, chromium };
}

export type RenderedFrame = { frame: number; timeMs: number; sceneId: string; segmentId: string; png: Buffer; sha: string; cached: boolean; clamped: boolean; renderMs: number };
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
}): Promise<Map<number, RenderedFrame>> {
  const { root, url, version, fps, width, height, seed, catalog, timeline, wanted, noCache, parallel, signal, onProgress } = options;
  const cacheDir = options.cacheDir ?? DEFAULT_FRAME_CACHE;
  const sorted = [...wanted].sort((a, b) => a.frame - b.frame);
  const results = new Map<number, RenderedFrame>();
  let done = 0;
  const tick = () => { done++; onProgress?.(done, sorted.length); };
  const groups = new Map<string, { segment: TimelineSegment | null; frames: FrameWanted[] }>();
  for (const item of sorted) {
    const segment = segmentAt(timeline, item.timeMs) ?? null;
    const key = segment ? `scene:${segment.id}` : "gap";
    const group = groups.get(key) ?? { segment, frames: [] as FrameWanted[] };
    group.frames.push(item);
    groups.set(key, group);
  }
  const renderGroup = async (group: { segment: TimelineSegment | null; frames: FrameWanted[] }): Promise<void> => {
    if (!group.segment) {
      for (const item of group.frames) {
        if (signal?.aborted) throw fault("export-cancelled", "Render cancelled; no output was published.");
        const started = Date.now();
        const png = services.voidPng(width, height);
        results.set(item.frame, { frame: item.frame, timeMs: item.timeMs, sceneId: "black-void", segmentId: "gap", png, sha: services.sha256Hex(png), cached: false, clamped: false, renderMs: Date.now() - started });
        tick();
      }
      return;
    }
    const segment = group.segment;
    const recipe = catalog.scenes.find((scene) => scene.id === segment.recipe);
    if (!recipe) throw fault("ERR_SCENE_NOT_FOUND", `Recipe "${segment.recipe}" is not in the validated catalog. Run velora scenes --json to list available IDs.`, "render.composition");
    const recipeText = await services.readRecipe(root, recipe.source, 256_000);
    const bindingText = await readText(root, recipe.binding, 2_000_000);
    if (recipeText === undefined || bindingText === undefined) throw fault("source-changed", "Scene source disappeared. Restore it and retry.");
    const opened = await executeRecipeCommand("open-scene", { sceneId: recipe.id, url, launch: false }, { root });
    if (!opened.success) throw fault("ERR_SCENE_INVALID", opened.issues.map((i) => i.message).join("\n"));
    const session = await services.openCapture({ url: opened.data.url!, width, height }, signal);
    try {
      const bridge = CaptureManifestSchema.safeParse(await session.manifest());
      if (!bridge.success) throw fault("invalid-capture", "Scene capture bridge must use version 1, the scene viewport selector and a duration between 0 and 120 seconds.");
      for (const item of group.frames) {
        if (signal?.aborted) throw fault("export-cancelled", "Render cancelled; no output was published.");
        const started = Date.now();
        const local = localTime(segment, item.timeMs);
        const finish = (png: Buffer, sha: string, cached: boolean, clamped: boolean): RenderedFrame =>
          ({ frame: item.frame, timeMs: item.timeMs, sceneId: recipe.id, segmentId: segment.id, png, sha, cached, clamped, renderMs: Date.now() - started });
        if (!noCache) {
          const key = services.frameCacheKey({ recipeSha: services.sha256Hex(recipeText), bindingSha: services.sha256Hex(bindingText), timeMs: local, fps, width, height, seed, version });
          const hit = await services.frameCacheLookup(root, cacheDir, key);
          if (hit) {
            results.set(item.frame, finish(hit.png, hit.sha, true, false));
            tick();
            continue;
          }
        }
        const clamped = local > bridge.data.durationMs;
        const png = services.decodePngDataUrl(await session.snapshot(clamped ? bridge.data.durationMs : local, bridge.data));
        if (!noCache) {
          const key = services.frameCacheKey({ recipeSha: services.sha256Hex(recipeText), bindingSha: services.sha256Hex(bindingText), timeMs: local, fps, width, height, seed, version });
          await services.frameCacheStore(root, cacheDir, key, png);
        }
        results.set(item.frame, finish(png, services.sha256Hex(png), false, clamped));
        tick();
      }
    } finally {
      await session.close();
    }
  };
  const queue = [...groups.values()];
  const workers = Math.max(1, Math.min(Math.max(1, Math.floor(parallel)), queue.length || 1));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const group = queue.shift();
      if (!group) return;
      await renderGroup(group);
    }
  }));
  return results;
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
    const cacheDir = parsed.data.cacheDir ?? DEFAULT_FRAME_CACHE;
    const scope = await services.prepareFileOutput(root, parsed.data.out);
    const manifestPath = parsed.data.out.replace(/\.png$/i, "") + ".manifest.json";
    const catalog = await discoverRecipes(root);
    const sourceText = await readText(root, parsed.data.composition, 256_000);
    if (sourceText === undefined) throw fault("source-changed", "Composition source disappeared. Restore it and retry.");
    const rendered = await renderTimelineFrames({
      root, url: context.url ?? "http://127.0.0.1:5173", version,
      fps, width: composition.width, height: composition.height, seed: composition.seed,
      catalog, timeline, wanted: [{ frame, timeMs }], cacheDir, noCache, parallel: 1, signal: context.signal,
    });
    const entry = rendered.get(frame);
    if (!entry) throw fault("export-failed", "Frame render produced no output.");
    const manifest = RenderManifestSchema.parse({
      version: 1 as const, kind: "frame" as const, compositionId: composition.id,
      compositionSha: services.sha256Hex(sourceText),
      seed: composition.seed, fps, width: composition.width, height: composition.height,
      durationMs: timeline.durationMs,
      segments: timeline.segments.map((s) => ({ id: s.id, recipe: s.recipe, startMs: s.startMs, durationMs: s.durationMs, frames: frameAt(s.startMs + s.durationMs, fps) - frameAt(s.startMs, fps) })),
      frames: [{ frame: entry.frame, timeMs: entry.timeMs, sceneId: entry.sceneId, segmentId: entry.segmentId, file: parsed.data.out, sha: entry.sha, renderMs: entry.renderMs, ...(entry.cached ? { cached: true as const } : {}), ...(entry.clamped ? { clamped: true as const } : {}) }],
      veloraVersion: version,
      checks: [{ id: "bridge-present", pass: true, detail: entry.sceneId === "black-void" ? "Timeline gap renders black void without a browser." : "Capture bridge served this frame." }],
      createdAt: new Date().toISOString(),
    });
    await services.writeNewFile(scope, entry.png);
    await services.writeNewTextFile(await services.prepareFileOutput(root, manifestPath), JSON.stringify(manifest, null, 2) + "\n");
    return { success: true, data: { out: parsed.data.out, manifest: manifestPath, frame: entry.frame, timeMs: entry.timeMs, sceneId: entry.sceneId, segmentId: entry.segmentId, sha: entry.sha, cached: entry.cached } };
  } catch (error) {
    const known = error as { code?: string; message?: string; target?: string };
    return { success: false, issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : "Frame render failed. Check the composition, scene server and retry.", ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
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
    const fps = parsed.data.fps ?? composition.fps;
    const width = parsed.data.width ?? composition.width;
    const height = parsed.data.height ?? composition.height;
    const timeline = TimelineSchema.parse({
      version: 1 as const, fps,
      durationMs: timelineDuration(composition.scenes),
      segments: composition.scenes.map((s) => ({ id: s.id, recipe: s.recipe, startMs: s.startMs, durationMs: s.durationMs })),
    });
    const checked = validateTimeline(timeline);
    if (!checked.valid) return { success: false, issues: checked.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) };
    const total = Math.ceil((timeline.durationMs * fps) / 1000);
    if (total < 1) throw fault("ERR_FRAME_OUT_OF_RANGE", "The timeline spans less than one frame.", "render.composition");
    const scope = await services.prepareFileOutput(root, parsed.data.out);
    const manifestPath = parsed.data.out.replace(/\.mp4$/i, "") + ".manifest.json";
    const sourceText = await readText(root, parsed.data.composition, 256_000);
    if (sourceText === undefined) throw fault("source-changed", "Composition source disappeared. Restore it and retry.");
    const wanted: FrameWanted[] = Array.from({ length: total }, (_, frame) => ({ frame, timeMs: timeAtFrame(frame, fps) }));
    const noCache = parsed.data.noCache ?? false;
    const cacheDir = parsed.data.cacheDir ?? DEFAULT_FRAME_CACHE;
    const parallel = parsed.data.parallel ?? services.defaultParallelism();
    const rendered = await renderTimelineFrames({
      root, url, version, fps, width, height, seed: composition.seed,
      catalog: full.catalog, timeline, wanted, cacheDir, noCache, parallel,
      signal: context.signal, onProgress: context.onProgress,
    });
    const ordered = wanted.map((w) => rendered.get(w.frame)!);
    const pngs = ordered.map((entry) => entry.png);
    const finalAbs = await services.resolveOutput(root, parsed.data.out);
    const needsMux = composition.audio.length > 0 || !!composition.captions;
    let ffmpegArgs: string[];
    let audioData: { tracks: { id: string; assetId: string; startMs: number }[]; driftMs: number } | undefined;
    let captionsData: { file?: string; cues: number; burnIn: boolean; windows: { startMs: number; endMs: number }[] } | undefined;
    if (!needsMux) {
      ffmpegArgs = (await services.encodeFrameBuffers(pngs, finalAbs, { fps, width, height, cwd: root, signal: context.signal })).ffmpegArgs;
    } else {
      tmpDir = await services.makeTempDir(root, ".velora-video-");
      const tmpVideo = `${tmpDir}/video.mp4`;
      await services.encodeFrameBuffers(pngs, tmpVideo, { fps, width, height, cwd: root, signal: context.signal });
      const tracks = [];
      for (const track of composition.audio) {
        const resolved = resolveAssetId(full.assets, full.aliases, track.assetId);
        if (!resolved) throw fault("ERR_ASSET_NOT_FOUND", `Audio asset "${track.assetId}" was not discovered.`, "render.composition");
        const absolute = await services.resolveOutput(root, resolved);
        const probe = await services.probeAudioFile(absolute);
        if (!probe.codec) throw fault("ERR_AUDIO_CODEC", `Audio ${resolved} could not be probed.`, "render.composition");
        const placed = audioPlacement(track, fps);
        tracks.push({ id: track.id, file: absolute, startMs: placed.startMs, offsetMs: track.offsetMs, gain: track.gain, fadeInMs: track.fadeInMs, fadeOutMs: track.fadeOutMs, audioMs: probe.durationMs ?? 0, ...(track.duckUnder ? { duckUnderTrackId: track.duckUnder.trackId } : {}) });
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
        if (composition.captions.burnIn) {
          captionsFile = lower.endsWith(".vtt")
            ? await services.writeTempText(tmpDir, "captions.srt", formatSrt(parsedCaptions.cues))
            : await services.resolveOutput(root, ref);
        }
      }
      let fontsDir: string | undefined;
      if (captionsFile) fontsDir = await services.existingDir(root, "assets");
      ffmpegArgs = (await services.muxAudioCaptions({ video: tmpVideo, tracks, ...(captionsFile ? { captionsFile } : {}), ...(fontsDir ? { fontsDir } : {}), output: finalAbs })).ffmpegArgs;
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
    const manifest = RenderManifestSchema.parse({
      version: 1 as const, kind: "video" as const, compositionId: composition.id,
      compositionSha: services.sha256Hex(sourceText),
      seed: composition.seed, fps, width, height, durationMs: timeline.durationMs,
      segments: timeline.segments.map((s) => ({ id: s.id, recipe: s.recipe, startMs: s.startMs, durationMs: s.durationMs, frames: ordered.filter((e) => e.segmentId === s.id).length })),
      frames: ordered.map((entry) => ({ frame: entry.frame, timeMs: entry.timeMs, sceneId: entry.sceneId, segmentId: entry.segmentId, sha: entry.sha, renderMs: entry.renderMs, ...(entry.cached ? { cached: true as const } : {}), ...(entry.clamped ? { clamped: true as const } : {}) })),
      ...(audioData ? { audio: audioData } : {}),
      ...(captionsData ? { captions: captionsData } : {}),
      ffmpegArgs, veloraVersion: version,
      checks: [{ id: "bridge-present", pass: true, detail: "Segments captured through the capture bridge; gaps render black void." }],
      createdAt: new Date().toISOString(),
    });
    await services.writeNewTextFile(await services.prepareFileOutput(root, manifestPath), JSON.stringify(manifest, null, 2) + "\n");
    const cachedFrames = ordered.filter((e) => e.cached).length;
    return { success: true, data: { out: parsed.data.out, manifest: manifestPath, frames: total, durationMs: timeline.durationMs, fps, width, height, seed: composition.seed, cachedFrames, renderedFrames: total - cachedFrames } };
  } catch (error) {
    const known = error as { code?: string; message?: string; target?: string };
    return { success: false, issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : "Video render failed. Check the composition, scene server and retry.", ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
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
    const rendered = await renderTimelineFrames({
      root, url, version, fps, width: composition.width, height: composition.height, seed: composition.seed,
      catalog: full.catalog, timeline, wanted,
      cacheDir: parsed.data.cacheDir ?? DEFAULT_FRAME_CACHE, noCache: parsed.data.noCache ?? false,
      parallel: services.defaultParallelism(), signal: context.signal, onProgress: context.onProgress,
    });
    const pad = (n: number) => String(n).padStart(5, "0");
    const frames = [...wanted].sort((a, b) => a.frame - b.frame).map((w) => {
      const entry = rendered.get(w.frame)!;
      return { entry, file: `frame-${pad(w.frame)}.png` };
    });
    for (const { entry, file } of frames) {
      const scope = await services.prepareFileOutput(root, `${parsed.data.out}/${file}`);
      await services.writeNewFile(scope, entry.png);
    }
    const manifest = RenderManifestSchema.parse({
      version: 1 as const, kind: "frames" as const, compositionId: composition.id,
      compositionSha: services.sha256Hex(sourceText),
      seed: composition.seed, fps, width: composition.width, height: composition.height,
      durationMs: timeline.durationMs,
      segments: timeline.segments.map((s) => ({ id: s.id, recipe: s.recipe, startMs: s.startMs, durationMs: s.durationMs, frames: frameAt(s.startMs + s.durationMs, fps) - frameAt(s.startMs, fps) })),
      frames: frames.map(({ entry, file }) => ({ frame: entry.frame, timeMs: entry.timeMs, sceneId: entry.sceneId, segmentId: entry.segmentId, file, sha: entry.sha, renderMs: entry.renderMs, ...(entry.cached ? { cached: true as const } : {}), ...(entry.clamped ? { clamped: true as const } : {}) })),
      veloraVersion: version,
      checks: [{ id: "bridge-present", pass: true, detail: "Frames captured through the capture bridge; gaps render black void." }],
      createdAt: new Date().toISOString(),
    });
    await services.writeNewTextFile(await services.prepareFileOutput(root, manifestPath), JSON.stringify(manifest, null, 2) + "\n");
    return { success: true, data: { out: parsed.data.out, manifest: manifestPath, total: frames.length,
      frames: frames.map(({ entry, file }) => ({ frame: entry.frame, file, sha: entry.sha })) } };
  } catch (error) {
    const known = error as { code?: string; message?: string; target?: string };
    return { success: false, issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : "Frame extraction failed. Check the composition, scene server and retry.", ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
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
    session = await services.openCapture({ url: opened.data.url!, width: selected.definition.width, height: selected.definition.height }, context.signal);
    const bridge = CaptureManifestSchema.safeParse(await session.manifest());
    if (!bridge.success) throw fault("invalid-capture", "Scene capture bridge must use version 1, the scene viewport selector and a duration between 0 and 120 seconds.");
    const clamped = parsed.data.timeMs > bridge.data.durationMs;
    const png = services.decodePngDataUrl(await session.snapshot(clamped ? bridge.data.durationMs : parsed.data.timeMs, bridge.data));
    const sha = services.sha256Hex(png);
    await services.writeNewFile(scope, png);
    return { success: true, data: { out: parsed.data.out, sceneId: selected.id, timeMs: parsed.data.timeMs, sha, ...(clamped ? { clamped: true as const } : {}) } };
  } catch (error) {
    const known = error as { code?: string; message?: string; target?: string };
    return { success: false, issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : "Shot capture failed. Check the scene, server and retry.", ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
  } finally {
    await session?.close();
  }
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
        document = JSON.parse(text);
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
          document = JSON.parse(text);
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
      issues: [{ code: known.code ?? "export-failed", message: known.code && known.message ? known.message : "Visual check failed. Check the rendered evidence and retry.", ...(typeof known.target === "string" ? { path: known.target } : {}) }] };
  } finally {
    if (tmpDir) await services.cleanupTemp(tmpDir).catch(() => {});
  }
}
