import { lstat, mkdir, mkdtemp, link, rm, rmdir, readdir, open, writeFile, readFile, rename } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { cpus, freemem } from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { parsePng, pngChunk } from "./compositor";
import type { Browser, Page } from "playwright";
import type { CaptureBridge, CaptureManifest, ExportVideo, ResolvedFinishing, VideoCodec } from "../core/export";
import { AUDIO_DRIFT_BUDGET_MS, SUPPORTED_AUDIO_CODECS } from "../core/audio";
import { DEFAULT_LOUDNESS, SFX_PRESETS, sfxGraph, type Loudness, type SfxEntry } from "../core/sound";
import { formatSrt, parseCaptions } from "../core/captions";
import { SCENE_RECIPE_DIRECTORY } from "../core/recipes";
import { canonicalRoot, relativeTarget, scopedPath, readText, atomicWrite, probeExecutable, probeAudioFile, type AudioProbe } from "../project/services";
import { fault } from "../project/errors";

/** SOURCE OF TRUTH: video capture effects.
 * WHAT: scoped no-overwrite publication, live browser screenshots and bounded FFmpeg streaming.
 * WHY: effects stay outside adapters and trusted export policy; motion remains in the scene.
 * WHERE: export/commands supplies validated requests/manifest; project/services owns path guards.
 */
export const validateTarget = relativeTarget;
export async function prepareScope(root: string, output: string) {
  const canonical = await canonicalRoot(root);
  const target = await scopedPath(canonical, output);
  try { await lstat(target); throw fault("output-exists", "Output already exists. Choose another .mp4 filename."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { root: canonical, output };
}
// Capture-only transparency: the preview's black void stays the default everywhere else.
export const TRANSPARENT_CAPTURE_CSS = "html,body,[data-velora-preview],.velora-viewport,.velora-canvas,[data-velora-capture],[data-velora-scene]{background:transparent!important;background-color:transparent!important}";
export type CaptureOptions = Pick<ExportVideo, "url" | "width" | "height"> & {
  /** Device scale factor: 2 supersamples (downscaled later in linear light), 0.5 drafts. */
  scale?: number;
  transparent?: boolean;
};
// Frame finishing applied before encoding: sub-frame capture and compositing for one output frame.
export type FrameProducer = (index: number, timeMs: number, shoot: (timeMs: number) => Promise<Buffer>) => Promise<Buffer>;
export async function openCapture(input: CaptureOptions, signal?: AbortSignal) {
  let browser: Browser | undefined;
  let page: Page;
  let aborted = signal?.aborted ?? false;
  let encoder: ReturnType<typeof spawn> | undefined;
  const abort = () => { aborted = true; encoder?.kill("SIGKILL"); void browser?.close(); };
  const check = () => { if (aborted) throw fault("export-cancelled", "Video export cancelled; no output was published."); };
  signal?.addEventListener("abort", abort, { once: true });
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  const close = async () => {
    signal?.removeEventListener("abort", abort);
    process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort);
    encoder?.kill("SIGKILL"); await browser?.close().catch(() => {});
  };
  try {
    check();
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ headless: true, channel: "chromium" });
    } catch { throw fault("missing-chromium", "Install Playwright and its browser: npm install playwright && npx playwright install chromium."); }
    page = await browser.newPage({ viewport: { width: input.width, height: input.height }, deviceScaleFactor: input.scale ?? 1 });
    const transparent = !!input.transparent;
    page.setDefaultTimeout(10_000);
    await page.route("**/*", route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest() && (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:')) return route.abort();
      return route.continue();
    });
    await page.goto(input.url, { waitUntil: "load", timeout: 30_000 });
    // Product chrome can visually overlap the capture rectangle. Hide its semantic
    // marker and host development-tools portal only in this private export page; the user's preview stays untouched.
    await page.addStyleTag({content:'[data-velora-preview-chrome],nextjs-portal{visibility:hidden!important}'});
    if (transparent) await page.addStyleTag({ content: TRANSPARENT_CAPTURE_CSS });
    // Parallel renders load several copies of the app at once, so a Velora page that is still loading
    // gets the same 30 s window as the page load; a page with no Velora markup at all fails after 5 s.
    const bridged = await page.waitForFunction((started) => {
      if (typeof (window as unknown as { __VELORA_CAPTURE__?: CaptureBridge }).__VELORA_CAPTURE__?.seek === "function") return "ready";
      const velora = document.querySelector("[data-velora-project],[data-velora-preview],[data-velora-library]") || /Loading your scenes/.test(document.body?.textContent ?? "");
      return !velora && Date.now() - started > 5000 ? "absent" : false;
    }, Date.now(), { timeout: 30_000, polling: 100 }).then(handle => handle.jsonValue(), () => "timeout");
    if (bridged !== "ready") throw fault("missing-capture", "This page has no ready Velora capture bridge. Open a scene with capture enabled and retry.");
    await page.evaluate(async () => {
      await Promise.race([
        Promise.all([document.fonts.ready, ...Array.from(document.images).map(image => image.decode().catch(() => {}))]),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Scene assets did not become ready.")), 10_000)),
      ]);
    });
    return {
      close,
      manifest: () => page.evaluate(() => {
        const bridge = (window as unknown as { __VELORA_CAPTURE__: CaptureBridge }).__VELORA_CAPTURE__;
        return { version: bridge.version, durationMs: bridge.durationMs, selector: bridge.selector, ...(bridge.look ? { look: bridge.look } : {}) };
      }),
      async snapshot(timeMs:number, manifest:CaptureManifest){
        check();
        // Route frames load the dev app again inside the page; under parallel renders that can take a while.
        // networkidle is a best-effort settle: a busy dev server (HMR, dependency optimizing, sibling workers)
        // may never go quiet for 500 ms. Readiness is owned by the bridge: seek awaits every capture-settle
        // hook (RouteFrame load, fonts, decoded images, video seeks), so a timeout here must not fail the render.
        await page.waitForLoadState("networkidle",{timeout:15_000}).catch(()=>undefined);
        await page.evaluate(()=>document.fonts.ready.then(()=>{}));
        const locator=page.locator(manifest.selector);
        if(await locator.count()!==1)throw fault("invalid-capture","Capture must identify exactly one scene viewport.");
        await page.evaluate(elapsed=>(window as unknown as {__VELORA_CAPTURE__:CaptureBridge}).__VELORA_CAPTURE__.seek(elapsed),timeMs);
        const rect=await locator.boundingBox();
        if(!rect||rect.width<1||rect.height<1||rect.width>3840||rect.height>3840)throw fault("invalid-capture","Scene viewport must be visible and bounded.");
        const png=await page.screenshot({clip:rect,type:"png",animations:"disabled",omitBackground:transparent,timeout:30_000});check();
        return "data:image/png;base64,"+png.toString("base64");
      },
      async encode(scope: { root: string; output: string }, options: ExportVideo & Partial<ResolvedFinishing>, manifest: CaptureManifest, frames: number, produce?: FrameProducer, onFrame?: (index: number, png: Buffer) => Promise<void> | void) {
        let temporary: string | undefined;
        try {
          check();
          const locator = page.locator(manifest.selector);
          if (await locator.count() !== 1) throw fault("invalid-capture", "Capture must identify exactly one visible scene viewport.");
          await locator.scrollIntoViewIfNeeded();
          const rect = await locator.boundingBox();
          if (!rect || rect.width < 1 || rect.height < 1 || rect.width > 3840 || rect.height > 3840) throw fault("invalid-capture", "Scene viewport must be visible and at most 3840 pixels per side.");
          const target = await scopedPath(scope.root, scope.output);
          await mkdir(path.dirname(target), { recursive: true });
          await scopedPath(scope.root, scope.output);
          temporary = await mkdtemp(path.join(path.dirname(target), ".velora-export-"));
          const video = path.join(temporary, "video" + path.extname(scope.output).toLowerCase());
          encoder = spawn("ffmpeg", videoEncodeArgs({ fps: options.fps, width: options.width, height: options.height, frames,
            codec: options.codec, quality: options.quality, transparent: options.transparent, gifFps: options.gifFps, x264: options.x264, crf: options.crf }, video), { cwd: scope.root, shell: false, stdio: ["pipe", "ignore", "pipe"] });
          const timeout = setTimeout(() => encoder?.kill("SIGKILL"), 15 * 60_000);
          let stderr = "";
          encoder.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
          const finished = new Promise<void>((resolve, reject) => {
            encoder!.once("error", () => { clearTimeout(timeout); reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")); });
            encoder!.once("close", code => { clearTimeout(timeout); code === 0 ? resolve() : reject(fault("encoding-failed", `FFmpeg failed. ${stderr.slice(-1000)}`)); });
          });
          void finished.catch(() => {});
          encoder.stdin!.on("error", () => {});
          const shoot = async (elapsed: number) => {
            check();
            await page.evaluate(time => (window as unknown as { __VELORA_CAPTURE__: CaptureBridge }).__VELORA_CAPTURE__.seek(time), elapsed);
            return page.screenshot({ clip: rect, type: "png", animations: "disabled", omitBackground: transparent, timeout: 30_000 });
          };
          for (let i = 0; i < frames; i++) {
            check();
            const png = produce ? await produce(i, i * 1000 / options.fps, shoot) : await shoot(i * 1000 / options.fps);
            await onFrame?.(i, png);
            if(i>0 && i % (options.fps*2)===0) process.stderr.write(`Captured ${i}/${frames} frames\n`);
            await Promise.race([new Promise<void>((resolve, reject) => encoder!.stdin!.write(png, error => error ? reject(error) : resolve())), finished.then(() => { throw fault("encoding-failed", "Encoder stopped before all scene frames were written."); })]);
          }
          encoder.stdin!.end();
          await finished; check();
          await scopedPath(scope.root, scope.output);
          try { await link(video, target); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw fault("output-exists", "Output appeared during export. Choose another filename."); throw error; }
        } catch (error) { check(); throw error; }
        finally { encoder?.kill("SIGKILL"); if (temporary) await rm(temporary, { recursive: true, force: true }); }
      },
    };
  } catch (error) { await close(); check(); throw error; }
}

// Reuse scoped, compare-before-write project effects for cached recipe imagery.
export const readRecipe=readText;
export const writeRecipe=atomicWrite;
export function textBytes(text:string){return Buffer.byteLength(text,"utf8")}
export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
// Scoped no-overwrite file publication for PNG/JSON outputs. Unlike MP4
// outputs the message names no container; traversal and symlinks stay denied.
export async function prepareFileOutput(root: string, output: string): Promise<{ root: string; output: string }> {
  const canonical = await canonicalRoot(root);
  const target = await scopedPath(canonical, output);
  try { await lstat(target); throw fault("output-exists", `Output ${output} already exists. Choose another filename.`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { root: canonical, output };
}
export async function writeNewFile(scope: { root: string; output: string }, data: Buffer | string): Promise<void> {
  const target = await scopedPath(scope.root, scope.output);
  await mkdir(path.dirname(target), { recursive: true });
  await scopedPath(scope.root, scope.output);
  let handle;
  try {
    handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => {});
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw fault("output-exists", `Output ${scope.output} already exists. Choose another filename.`);
    throw error;
  }
  await scopedPath(scope.root, scope.output);
}
export function decodePngDataUrl(dataUrl: string): Buffer {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) throw fault("invalid-capture", "Capture must return a PNG data URL.");
  return Buffer.from(dataUrl.slice(prefix.length), "base64");
}
// Text sibling of writeNewFile: commands pass strings, services own bytes,
// so command layers never touch the Buffer runtime global.
export async function writeNewTextFile(scope: { root: string; output: string }, text: string): Promise<void> {
  return writeNewFile(scope, Buffer.from(text, "utf8"));
}
// Content-hash frame cache. Keys hash everything that affects pixels
// (recipe + binding bytes, host source fingerprint, frame time, fps, dimensions,
// seed, code version); entries are verified by recomputed SHA on read.
// variant distinguishes capture modes (supersample scale, transparency); standard captures keep their keys.
export function frameCacheKey(parts: { recipeSha: string; bindingSha: string; hostSha: string; timeMs: number; fps: number; width: number; height: number; seed: number; version: string; variant?: string }): string {
  return sha256Hex([parts.recipeSha, parts.bindingSha, parts.hostSha, String(parts.timeMs), String(parts.fps), String(parts.width), String(parts.height), String(parts.seed), parts.version, ...(parts.variant ? [parts.variant] : [])].join("|"));
}
// Bindings import arbitrary host components and styles, so their bytes alone cannot
// key the cache. Stat-only fingerprint of what can change pixels: code, styles and
// markup anywhere, plus images, video and fonts under source/asset directories and the
// lockfile. Scene recipes and bindings are already keyed per scene (helpers live outside
// the discovery directory), so editing one scene re-renders only that scene. Render outputs (stills, manifests), compositions, audio and captions never
// change a scene's pixels, so re-renders after timeline edits stay cached. Any counted
// edit (or touch) invalidates; above the cap the caller renders without the cache.
export const HOST_FINGERPRINT_MAX_FILES = 20_000;
const fingerprintSkip = new Set(["node_modules", "dist", "build", "out", "coverage", "test-results"]);
const fingerprintMediaRoots = new Set(["src", "app", "pages", "components", "lib", "styles", "public", "assets"]);
const fingerprintCode = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|html|json)$/i;
const fingerprintMedia = /\.(?:svg|png|jpe?g|webp|gif|avif|woff2?|ttf|otf|mp4|webm)$/i;
const fingerprintOutput = /(?:^|\.)manifest\.json$|\.composition\.json$/i;
function fingerprinted(relative: string, name: string): boolean {
  if (fingerprintOutput.test(name)) return false;
  if (fingerprintCode.test(name)) return true;
  return fingerprintMedia.test(name) && fingerprintMediaRoots.has(relative.split("/")[0]);
}
export async function hostFingerprint(root: string): Promise<string | undefined> {
  const entries: string[] = [];
  const walk = async (relative: string): Promise<boolean> => {
    const directory = relative ? path.join(root, relative) : root;
    let items;
    try { items = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
    items.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const item of items) {
      const child = relative ? `${relative}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (item.name.startsWith(".") || fingerprintSkip.has(item.name) || child === SCENE_RECIPE_DIRECTORY) continue;
        if (!await walk(child)) return false;
      } else if (item.isFile() && fingerprinted(child, item.name)) {
        const info = await lstat(path.join(root, child));
        entries.push(`${child}|${info.size}|${Math.trunc(info.mtimeMs)}`);
        if (entries.length > HOST_FINGERPRINT_MAX_FILES) return false;
      }
    }
    return true;
  };
  return await walk("") ? sha256Hex(entries.join("\n")) : undefined;
}
export async function frameCacheLookup(root: string, cacheDir: string, key: string): Promise<{ png: Buffer; sha: string } | undefined> {
  let file: string;
  try { file = await scopedPath(root, `${cacheDir}/${key}.png`); }
  catch { return undefined; }
  let bytes: Buffer;
  try { bytes = await readFile(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  const sha = sha256Hex(bytes);
  return { png: bytes, sha };
}
export async function frameCacheStore(root: string, cacheDir: string, key: string, png: Buffer): Promise<string> {
  const dir = await scopedPath(root, cacheDir);
  await mkdir(dir, { recursive: true });
  const file = await scopedPath(root, `${cacheDir}/${key}.png`);
  await writeFile(file, png);
  return sha256Hex(png);
}
// Minimal black-frame encoder for timeline gaps, which render black void by
// contract. RGB, filter-zero scanlines; parsePng round-trips every byte.
export { parsePng, voidPng } from "./compositor";
// Mean and variance of luminance over RGBA pixels: the no-blank check's signal.
export function luminanceStats(pixels: Buffer): { mean: number; variance: number } {
  const count = Math.floor(pixels.length / 4);
  if (!count) return { mean: 0, variance: 0 };
  let sum = 0;
  for (let i = 0; i < count; i++) sum += 0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2];
  const mean = sum / count;
  let squares = 0;
  for (let i = 0; i < count; i++) {
    const delta = 0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2] - mean;
    squares += delta * delta;
  }
  return { mean, variance: squares / count };
}

// Aspect-cover filter shared by live capture encoding and buffer encoding:
// the authored scene scales uniformly to cover the frame, edges cropped.
export function coverFilter(width: number, height: number, transparent = false): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${transparent ? ":color=black@0" : ""}`;
}
export type EncodeOptions = { fps: number; width: number; height: number; frames: number } & Partial<Pick<ResolvedFinishing, "codec" | "quality" | "transparent" | "gifFps" | "x264" | "crf" | "crfOverride">>;
// Broadcast colorimetry: full-range sRGB PNGs convert to limited-range BT.709 YUV and the stream is
// tagged so browsers and editors decode the same colors (FFmpeg defaults to an untagged BT.601 matrix).
const BT709_TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
// setparams stamps the frames too: FFmpeg 7+ prefers frame properties (from the PNG input) over output flags.
const toYuv = (format: string) => `scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=${format},setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`;
const GIF_MAX_WIDTH = 960;
// Per-codec quality: [draft, standard, master] CRF (or prores qscale) and encoder speed.
const CODEC_QUALITY: Record<Exclude<VideoCodec, "h264" | "gif">, { crf: [number, number, number]; speed: [string, string, string] }> = {
  hevc: { crf: [30, 22, 18], speed: ["veryfast", "slow", "slower"] },
  vp9: { crf: [40, 31, 24], speed: ["5", "2", "1"] },
  av1: { crf: [45, 32, 24], speed: ["10", "6", "4"] },
  prores4444: { crf: [13, 9, 5], speed: ["", "", ""] },
};
/** FFmpeg arguments for one PNG stream (stdin) to one output; pure, unit-tested per codec and preset. */
export function videoEncodeArgs(options: EncodeOptions, output: string): string[] {
  const codec = options.codec ?? "h264";
  const transparent = !!options.transparent;
  const level = options.quality === "draft" ? 0 : options.quality === "master" ? 2 : 1;
  const input = ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "image2pipe", "-framerate", String(options.fps), "-vcodec", "png", "-i", "pipe:0", "-an"];
  const cover = coverFilter(options.width, options.height, transparent);
  const frames = ["-frames:v", String(options.frames)];
  if (codec === "gif") {
    const width = Math.min(options.width, GIF_MAX_WIDTH);
    // Two passes in one graph: a palette from frame differences, then error-diffusion dithering.
    return [...input, "-vf", `${cover},fps=${options.gifFps ?? 20},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`,
      "-loop", "0", "-n", output];
  }
  if (codec === "h264")
    return [...input, "-vf", `${cover},${toYuv("yuv420p")}`, "-c:v", "libx264", "-preset", options.x264 ?? "medium", "-crf", String(options.crfOverride ?? options.crf ?? 18),
      "-profile:v", "high", "-pix_fmt", "yuv420p", ...BT709_TAGS, "-movflags", "+faststart", ...frames, "-n", output];
  const base = CODEC_QUALITY[codec];
  // The deliver size ladder overrides rate control; speed stays the preset's.
  const tuning = { speed: base.speed, crf: options.crfOverride === undefined ? base.crf : [options.crfOverride, options.crfOverride, options.crfOverride] as [number, number, number] };
  if (codec === "hevc")
    return [...input, "-vf", `${cover},${toYuv("yuv420p")}`, "-c:v", "libx265", "-preset", tuning.speed[level], "-crf", String(tuning.crf[level]),
      "-tag:v", "hvc1", "-pix_fmt", "yuv420p", ...BT709_TAGS, "-movflags", "+faststart", ...frames, "-n", output];
  if (codec === "vp9") {
    const format = transparent ? "yuva420p" : "yuv420p";
    return [...input, "-vf", `${cover},${toYuv(format)}`, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(tuning.crf[level]), "-cpu-used", tuning.speed[level],
      "-row-mt", "1", ...(transparent ? ["-auto-alt-ref", "0"] : []), "-pix_fmt", format, ...BT709_TAGS, ...frames, "-n", output];
  }
  if (codec === "av1") {
    const webm = output.toLowerCase().endsWith(".webm");
    return [...input, "-vf", `${cover},${toYuv("yuv420p")}`, "-c:v", "libsvtav1", "-crf", String(tuning.crf[level]), "-preset", tuning.speed[level],
      "-pix_fmt", "yuv420p", ...BT709_TAGS, ...(webm ? [] : ["-movflags", "+faststart"]), ...frames, "-n", output];
  }
  // ProRes 4444 (10-bit 4:4:4, with alpha when transparent) for editors compositing over footage.
  const format = transparent ? "yuva444p10le" : "yuv444p10le";
  return [...input, "-vf", `${cover},${toYuv(format)}`, "-c:v", "prores_ks", "-profile:v", "4444", "-qscale:v", String(tuning.crf[level]), "-vendor", "apl0",
    "-pix_fmt", format, ...BT709_TAGS, ...frames, "-n", output];
}
/** Software encoders this FFmpeg build provides, per Velora codec. */
export const CODEC_ENCODERS: Record<VideoCodec, string> = { h264: "libx264", hevc: "libx265", vp9: "libvpx-vp9", av1: "libsvtav1", prores4444: "prores_ks", gif: "gif" };
export async function probeEncoders(timeoutMs = 10_000): Promise<Record<VideoCodec, boolean> | undefined> {
  const text = await new Promise<string | undefined>(resolve => {
    let out = "";
    let child;
    try { child = spawn("ffmpeg", ["-hide_banner", "-encoders"], { shell: false, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { resolve(undefined); return; }
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(undefined); }, timeoutMs);
    child.stdout?.on("data", chunk => { out += chunk.toString(); });
    child.once("error", () => { clearTimeout(timer); resolve(undefined); });
    child.once("close", code => { clearTimeout(timer); resolve(code === 0 ? out : undefined); });
  });
  if (text === undefined) return undefined;
  const names = new Set(text.split(/\r?\n/).map(line => line.trim().split(/\s+/)[1]).filter(Boolean));
  return Object.fromEntries(Object.entries(CODEC_ENCODERS).map(([codec, encoder]) => [codec, names.has(encoder)])) as Record<VideoCodec, boolean>;
}
// Ordered PNG frames spilled to disk so long renders hold one frame per worker in memory.
export type SpilledFrames = { count: number; read: (index: number) => Promise<Buffer> };
const spillName = (frame: number) => `${String(frame).padStart(7, "0")}.png`;
export async function spillFrame(dirAbs: string, frame: number, png: Buffer): Promise<void> {
  if (!Number.isInteger(frame) || frame < 0) throw new Error("Spilled frame index must be a nonnegative integer.");
  await mkdir(dirAbs, { recursive: true });
  await writeFile(path.join(dirAbs, spillName(frame)), png);
}
// Layer frames keyed by "<unit>:<frame>" (unit ids are scene, segment or overlay ids: safe file names).
const layerName = (key: string) => `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
export async function spillFile(dirAbs: string, key: string, png: Buffer): Promise<void> {
  await mkdir(dirAbs, { recursive: true });
  await writeFile(path.join(dirAbs, layerName(key)), png);
}
export async function readSpilledFile(dirAbs: string, key: string): Promise<Buffer> {
  return readFile(path.join(dirAbs, layerName(key)));
}
export function spilledFrames(dirAbs: string, frames: readonly number[]): SpilledFrames {
  return { count: frames.length, read: (index) => readFile(path.join(dirAbs, spillName(frames[index]))) };
}
// Encode PNG frames to MP4 with the exact live-capture pipeline, from memory or
// from a spilled sequence read one frame at a time; same bytes in, same bytes out.
export async function encodeFrameBuffers(source: Buffer[] | SpilledFrames, output: string, options: Omit<EncodeOptions, "frames"> & { cwd: string; signal?: AbortSignal }): Promise<{ ffmpegArgs: string[] }> {
  const frames: SpilledFrames = Array.isArray(source) ? { count: source.length, read: async (index) => source[index] } : source;
  if (!frames.count) throw fault("invalid-capture", "Nothing to encode: the timeline spans less than one frame.");
  const { cwd: _cwd, signal: _signal, ...encode } = options;
  const args = videoEncodeArgs({ ...encode, frames: frames.count }, output);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    let encoder;
    try {
      encoder = spawn("ffmpeg", args, { cwd: options.cwd, shell: false, stdio: ["pipe", "ignore", "pipe"] });
    } catch {
      reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH."));
      return;
    }
    if (options.signal?.aborted) {
      encoder.kill("SIGKILL");
      reject(fault("export-cancelled", "Video render cancelled; no output was published."));
      return;
    }
    const timeout = setTimeout(() => encoder?.kill("SIGKILL"), 15 * 60_000);
    let stderr = "";
    encoder.stderr?.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4096); });
    const finished = new Promise<void>((resolveFinished, rejectFinished) => {
      encoder!.once("error", () => { clearTimeout(timeout); rejectFinished(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")); });
      encoder!.once("close", (code) => { clearTimeout(timeout); code === 0 ? resolveFinished() : rejectFinished(fault("encoding-failed", `FFmpeg failed. ${stderr.slice(-1000)}`)); });
    });
    void finished.catch(() => {});
    encoder.stdin!.on("error", () => {});
    const abort = () => { encoder?.kill("SIGKILL"); done(() => reject(fault("export-cancelled", "Video render cancelled; no output was published."))); };
    options.signal?.addEventListener("abort", abort, { once: true });
    (async () => {
      try {
        for (let index = 0; index < frames.count; index++) {
          if (options.signal?.aborted) throw fault("export-cancelled", "Video render cancelled; no output was published.");
          const png = await frames.read(index);
          await new Promise<void>((resolveWrite, rejectWrite) => encoder!.stdin!.write(png, (error) => error ? rejectWrite(error) : resolveWrite()));
          await Promise.race([Promise.resolve(), finished.then(() => { throw fault("encoding-failed", "Encoder stopped before all scene frames were written."); })]);
        }
        encoder!.stdin!.end();
        await finished;
        done(resolve);
      } catch (error) {
        done(() => reject(error));
      } finally {
        options.signal?.removeEventListener("abort", abort);
      }
    })();
  });
  return { ffmpegArgs: args };
}
// Segment-worker default. Each worker is a whole Chromium running the live app (often twice, with route
// frames), all served by one dev server, so the default leaves a core free, budgets ~700 MB of free memory
// per worker and caps at 4; --parallel can go to 8 on big machines. Frames stay serial inside each worker.
export const WORKER_MEMORY_BYTES = 700 * 1024 * 1024;
export function defaultParallelism(): number {
  try {
    return Math.min(4, Math.max(1, (cpus().length || 2) - 1), Math.max(1, Math.floor(freemem() / WORKER_MEMORY_BYTES)));
  } catch {
    return 2;
  }
}
export type VideoProbe = {
  video: { codec: string; width: number; height: number; fps: number; frames: number | null; durationMs: number | null } | null;
  audio: { codec: string } | null;
  durationMs: number | null;
};
// Structural probe of a video file via ffprobe. Never throws: unparsable
// output yields nulls and callers fail closed with honest diagnostics.
export async function probeVideoFile(absolutePath: string, timeoutMs = 30_000): Promise<VideoProbe> {
  const stdout = await new Promise<string>((resolve) => {
    let settled = false;
    const done = (value: string) => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = spawn("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", absolutePath], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch { done(""); return; }
    let out = "";
    const timer = setTimeout(() => { child?.kill("SIGKILL"); done(out); }, timeoutMs);
    child.stdout?.on("data", (chunk) => { out = (out + chunk.toString()).slice(-65536); });
    child.once("error", () => { clearTimeout(timer); done(out); });
    child.once("exit", () => { clearTimeout(timer); done(out); });
  });
  const empty: VideoProbe = { video: null, audio: null, durationMs: null };
  try {
    const parsed = JSON.parse(stdout) as {
      streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string; duration?: string }[];
      format?: { duration?: string };
    };
    const streams = parsed.streams ?? [];
    const video = streams.find((s) => s.codec_type === "video");
    const audio = streams.find((s) => s.codec_type === "audio");
    const rate = video?.r_frame_rate?.split("/");
    const fps = rate && rate.length === 2 && Number(rate[1]) !== 0 ? Number(rate[0]) / Number(rate[1]) : NaN;
    const formatDuration = parsed.format?.duration !== undefined ? Number(parsed.format.duration) * 1000 : NaN;
    return {
      video: video && video.codec_name && video.width && video.height ? {
        codec: video.codec_name, width: video.width, height: video.height,
        fps: Number.isFinite(fps) ? fps : 0,
        frames: video.nb_frames !== undefined && Number.isFinite(Number(video.nb_frames)) ? Number(video.nb_frames) : null,
        durationMs: video.duration !== undefined && Number.isFinite(Number(video.duration)) ? Number(video.duration) * 1000 : null,
      } : null,
      audio: audio?.codec_name ? { codec: audio.codec_name } : null,
      durationMs: Number.isFinite(formatDuration) ? formatDuration : null,
    };
  } catch {
    return empty;
  }
}
// Decode evenly spaced sample frames (at most maxSamples) for visual checks.
// Returns PNG buffers in time order with source frame indices and times.
export async function decodeVideoSamples(absolutePath: string, tmpDir: string, maxSamples = 16): Promise<{ png: Buffer; atFrame: number; timeMs: number }[]> {
  const probe = await probeVideoFile(absolutePath);
  const total = probe.video?.frames ?? (probe.video && probe.durationMs !== null && probe.video.fps ? Math.round((probe.durationMs * probe.video.fps) / 1000) : null);
  await mkdir(tmpDir, { recursive: true });
  const outs: { png: Buffer; atFrame: number; timeMs: number }[] = [];
  if (total === null || total <= 0 || !probe.video?.fps) {
    const pattern = path.join(tmpDir, "sample-%05d.png");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", absolutePath, "-vf", "fps=1", "-frames:v", String(maxSamples), pattern], { shell: false, stdio: "ignore" });
      child.once("error", () => reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")));
      child.once("exit", (code) => code === 0 ? resolve() : reject(fault("encoding-failed", "Frame sampling failed.")));
    });
    const names = (await readdir(tmpDir)).filter((name) => name.endsWith(".png")).sort();
    // fps=1 sampling: sample k covers second k.
    for (const [k, name] of names.entries()) outs.push({ png: await readFile(path.join(tmpDir, name)), atFrame: -1, timeMs: k * 1000 });
    return outs;
  }
  const count = Math.min(maxSamples, total);
  const indices = Array.from({ length: count }, (_, k) => Math.min(total - 1, Math.round(((k + 0.5) * total) / count)));
  const fps = probe.video?.fps && probe.video.fps > 0 ? probe.video.fps : 30;
  // -fps_mode passthrough (not the removed -vsync) keeps selected frames 1:1.
  const select = indices.map((i) => `eq(n\\,${i})`).join("+");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", absolutePath, "-vf", `select='${select}'`, "-fps_mode", "passthrough", path.join(tmpDir, "sample-%05d.png")], { shell: false, stdio: "ignore" });
    child.once("error", () => reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")));
    child.once("exit", (code) => code === 0 ? resolve() : reject(fault("encoding-failed", "Frame sampling failed.")));
  });
  const names = (await readdir(tmpDir)).filter((name) => name.endsWith(".png")).sort();
  for (const [k, name] of names.entries()) {
    const atFrame = indices[Math.min(k, indices.length - 1)];
    outs.push({ png: await readFile(path.join(tmpDir, name)), atFrame, timeMs: (atFrame * 1000) / fps });
  }
  return outs;
}
// Average RGBA pixels into a cols x rows RGB grid (the same cells flash analysis uses for video).
export function gridOf(pixels: Buffer, width: number, height: number, cols: number, rows: number): Buffer {
  const out = Buffer.alloc(cols * rows * 3);
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    const x0 = Math.floor((gx * width) / cols), x1 = Math.floor(((gx + 1) * width) / cols), y0 = Math.floor((gy * height) / rows), y1 = Math.floor(((gy + 1) * height) / rows);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const o = (y * width + x) * 4; r += pixels[o]; g += pixels[o + 1]; b += pixels[o + 2]; n++; }
    const o = (gy * cols + gx) * 3;
    out[o] = Math.round(r / Math.max(1, n)); out[o + 1] = Math.round(g / Math.max(1, n)); out[o + 2] = Math.round(b / Math.max(1, n));
  }
  return out;
}
/** Every frame of a video averaged into a cols x rows RGB grid (area scaling), for flash analysis. */
export async function decodeLuminanceGrid(absolutePath: string, cols = 8, rows = 8, timeoutMs = 5 * 60_000): Promise<{ fps: number; frames: { timeMs: number; rgb: Buffer }[] }> {
  const probe = await probeVideoFile(absolutePath);
  const fps = probe.video?.fps && probe.video.fps > 0 ? probe.video.fps : 30;
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let child;
    try { child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", absolutePath, "-vf", `scale=${cols}:${rows}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"], { shell: false, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")); return; }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", chunk => chunks.push(chunk));
    child.once("error", () => { clearTimeout(timer); reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")); });
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(fault("encoding-failed", "Frame decoding for flash analysis failed.")); });
  });
  const size = cols * rows * 3;
  const frames = Array.from({ length: Math.floor(raw.length / size) }, (_, i) => ({ timeMs: (i * 1000) / fps, rgb: raw.subarray(i * size, (i + 1) * size) }));
  return { fps, frames };
}
// Resolve a project-relative output to an absolute path for process spawns.
// Traversal, absolute paths and symlinks stay denied by scopedPath.
export async function fileSize(absolutePath: string): Promise<number | undefined> {
  try { return (await lstat(absolutePath)).size; } catch { return undefined; }
}
export async function resolveOutput(root: string, target: string): Promise<string> {
  return scopedPath(root, target);
}
// Write text into a project-scoped temp directory, returning the absolute
// path for process spawns. Keeps derived files (converted captions) offstage.
export async function writeTempText(tmpDirAbs: string, name: string, text: string): Promise<string> {
  if (name.includes("/") || name.includes("\\") || name === "" || name === "." || name === "..")
    throw fault("denied-path", "Temporary file names stay flat.", name);
  const file = path.join(tmpDirAbs, name);
  await writeFile(file, text, "utf8");
  return file;
}
// Project-scoped temporary directory with explicit cleanup. Keeps render
// temporaries inside the project instead of the shared temp dir.
export async function makeTempDir(root: string, prefix: string): Promise<string> {
  return mkdtemp(path.join(root, prefix));
}
export async function cleanupTemp(absoluteDir: string): Promise<void> {
  await rm(absoluteDir, { recursive: true, force: true });
}
// Existing directory probe: absolute path when present and a directory,
// undefined otherwise. Used for optional fonts/assets directories.
export async function existingDir(root: string, target: string): Promise<string | undefined> {
  try {
    const candidate = await scopedPath(root, target);
    if ((await lstat(candidate)).isDirectory()) return candidate;
    return undefined;
  } catch {
    return undefined;
  }
}
// Prerequisite probes for `velora doctor`. Both are real checks that never
// throw: FFmpeg must execute, and the Playwright Chromium executable must
// exist on disk. Neither launches a browser nor renders anything.
export async function probeFfmpeg(): Promise<{ available: boolean; detail: string }> {
  const available = await probeExecutable("ffmpeg", ["-hide_banner", "-version"]);
  return available
    ? { available, detail: "ffmpeg executes on PATH." }
    : { available, detail: "Install FFmpeg and ensure ffmpeg is available on PATH." };
}
export async function probeChromium(): Promise<{ available: boolean; detail: string }> {
  try {
    const { chromium } = await import("playwright");
    const executablePath: string = chromium.executablePath();
    try {
      await lstat(executablePath);
      return { available: true, detail: executablePath };
    } catch {
      return { available: false, detail: "Playwright chromium executable missing at " + executablePath + ". Run npx playwright install chromium." };
    }
  } catch {
    return { available: false, detail: "Install Playwright and its browser: npm install playwright && npx playwright install chromium." };
  }
}

// Re-exported from project services (single implementation): audio probing
// belongs to shared services so project validation can use it too.
export { probeAudioFile };
export type { AudioProbe };
export type MuxTrack = { id: string; file: string; startMs: number; offsetMs: number; gain: number; fadeInMs: number; fadeOutMs: number; duckUnderTrackId?: string; audioMs: number };
export type MuxRequest = { video: string; tracks: MuxTrack[]; captionsFile?: string; fontsDir?: string; output: string };
// Escape a file path for the subtitles filter: forward slashes, escaped
// metacharacters, wrapped in single quotes. The quotes are required: without
// them a drive-letter colon splits the filter options (verified against real
// FFmpeg). Pure and unit-tested; a wrong escape silently burns nothing.
export function escapeSubtitlesPath(absolutePath: string): string {
  // Inside FFmpeg's single quotes a backslash is literal, so a quote would end the string and let the rest of the
  // path become filter-graph syntax. Such paths are refused rather than escaped.
  if (/['\r\n]/.test(absolutePath)) throw fault("denied-path", "Caption and font paths cannot contain quotes or line breaks for FFmpeg; rename the project folder and retry.", absolutePath);
  const escaped = absolutePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  return `'${escaped}'`;
}
// Build the single-pass mux filter: per-track delay/gain/fades, optional
// single-ducker sidechain compression, amix for ensembles, caption burn-in.
// Ducking beyond one declarer is rejected at validation, never silently dropped.
export function buildMuxFilter(tracks: MuxTrack[], captionsFile?: string, fontsDir?: string): { audioFilter: string | null; videoFilter: string | null } {
  const chainOf = (t: MuxTrack): string => {
    const chain = [`adelay=${Math.round(t.startMs)}|${Math.round(t.startMs)}`, `volume=${t.gain}`];
    if (t.fadeInMs > 0) chain.push(`afade=t=in:st=0:d=${(t.fadeInMs / 1000).toFixed(3)}`);
    if (t.fadeOutMs > 0) chain.push(`afade=t=out:st=${Math.max(0, (t.audioMs - t.fadeOutMs) / 1000).toFixed(3)}:d=${(t.fadeOutMs / 1000).toFixed(3)}`);
    return chain.join(",");
  };
  let audioFilter: string | null = null;
  if (tracks.length === 1 && !tracks[0].duckUnderTrackId) {
    audioFilter = `[1:a]${chainOf(tracks[0])}[aout]`;
  } else if (tracks.length > 0) {
    const parts = tracks.map((t, i) => `[${i + 1}:a]${chainOf(t)}[a${i}]`);
    const duckers = tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.duckUnderTrackId);
    const finals = tracks.map((_, i) => `a${i}`);
    if (duckers.length === 1) {
      const key = tracks.findIndex((t) => t.id === duckers[0].t.duckUnderTrackId);
      if (key >= 0 && key !== duckers[0].i) {
        parts.push(`[a${duckers[0].i}][a${key}]sidechaincompress=ratio=8:threshold=0.02:attack=20:release=400[a${duckers[0].i}d]`);
        finals[duckers[0].i] = `a${duckers[0].i}d`;
      }
    }
    parts.push(`${finals.map((f) => `[${f}]`).join("")}amix=inputs=${tracks.length}:duration=longest:dropout_transition=0[aout]`);
    audioFilter = parts.join(";");
  }
  const videoFilter = captionsFile
    ? `subtitles=${escapeSubtitlesPath(captionsFile)}${fontsDir ? `:fontsdir=${escapeSubtitlesPath(fontsDir)}` : ""}`
    : null;
  return { audioFilter, videoFilter };
}
// Measure A/V sync offset of a muxed file from per-stream start times via
// ffprobe (ships with every FFmpeg distribution). Returns null when the
// streams or their starts cannot be parsed; callers fail closed.
export async function probeAvDrift(absolutePath: string, timeoutMs = 30_000): Promise<{ driftMs: number | null; detail: string }> {
  const stdout = await new Promise<string>((resolve) => {
    let settled = false;
    const done = (value: string) => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = spawn("ffprobe", ["-v", "error", "-show_streams", "-of", "json", absolutePath], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch { done(""); return; }
    let out = "";
    const timer = setTimeout(() => { child?.kill("SIGKILL"); done(out); }, timeoutMs);
    child.stdout?.on("data", (chunk) => { out = (out + chunk.toString()).slice(-32768); });
    child.once("error", () => { clearTimeout(timer); done(out); });
    child.once("exit", () => { clearTimeout(timer); done(out); });
  });
  try {
    const streams = (JSON.parse(stdout) as { streams?: { codec_type?: string; start_time?: string }[] }).streams ?? [];
    const first = (type: string): number | null => {
      const found = streams.find((s) => s.codec_type === type);
      if (!found || found.start_time === undefined) return null;
      const value = Number(found.start_time);
      return Number.isFinite(value) ? value : null;
    };
    const video = first("video"), audio = first("audio");
    if (video === null || audio === null) return { driftMs: null, detail: "Could not read video and audio stream starts." };
    return { driftMs: Math.round(Math.abs(video - audio) * 1000), detail: `video ${video}s, audio ${audio}s` };
  } catch {
    return { driftMs: null, detail: "Could not parse stream information." };
  }
}
// Resolve a CLI-supplied media path to an absolute file. Project-relative
// only: traversal, absolute paths and symlinks stay denied by scopedPath.
export async function resolveMediaFile(root: string, target: string): Promise<string> {
  return scopedPath(root, target);
}
// Stage a temp output for the silent master when a post-pass follows. The
// caller encodes into scope and always runs cleanup, like encode temporaries.
export async function stageTempVideo(scope: { root: string; output: string }): Promise<{ scope: { root: string; output: string }; cleanup: () => Promise<void> }> {
  const temporary = await mkdtemp(path.join(scope.root, ".velora-mux-"));
  return {
    scope: { root: scope.root, output: path.relative(scope.root, path.join(temporary, "silent" + (path.extname(scope.output).toLowerCase() || ".mp4"))) },
    cleanup: async () => { await rm(temporary, { recursive: true, force: true }); },
  };
}
// Single-export audio/caption post-pass: mix one positioned track and/or burn
// captions, measure A/V drift, publish only in-spec results. VTT captions pass
// through the validated parser to a temp SRT because the burn filter reads SRT.
export async function mixPostAudioCaptions(
  scope: { root: string; output: string },
  silentOutput: string,
  input: { audio?: string; captions?: string },
): Promise<{ audio?: { file: string; codec: string; driftMs: number; peakDb: number | null }; captions?: { file: string; cues: number; burnIn: boolean } }> {
  const temporary = await mkdtemp(path.join(scope.root, ".velora-captions-"));
  try {
    const silentAbs = await scopedPath(scope.root, silentOutput);
    let captionsFile: string | undefined;
    let cueCount = 0;
    if (input.captions) {
      const captionsAbs = await scopedPath(scope.root, input.captions);
      const lower = captionsAbs.toLowerCase();
      if (lower.endsWith(".srt")) {
        const text = await readText(scope.root, input.captions, 256_000);
        if (text === undefined) throw fault("ERR_CAPTION_INVALID", `Caption file ${input.captions} was not found.`, input.captions);
        const parsed = parseCaptions(text, "srt");
        if ("issues" in parsed) throw fault("ERR_CAPTION_INVALID", `Caption file ${input.captions} is invalid: ${parsed.issues[0].message}`, input.captions);
        cueCount = parsed.cues.length;
        captionsFile = captionsAbs;
      } else if (lower.endsWith(".vtt")) {
        const text = await readText(scope.root, input.captions, 256_000);
        if (text === undefined) throw fault("ERR_CAPTION_INVALID", `Caption file ${input.captions} was not found.`, input.captions);
        const parsed = parseCaptions(text, "vtt");
        if ("issues" in parsed) throw fault("ERR_CAPTION_INVALID", `Caption file ${input.captions} is invalid: ${parsed.issues[0].message}`, input.captions);
        cueCount = parsed.cues.length;
        captionsFile = path.join(temporary, "captions.srt");
        await writeFile(captionsFile, formatSrt(parsed.cues), "utf8");
      } else throw fault("ERR_CAPTION_INVALID", `Caption file ${input.captions} must be .srt or .vtt.`, input.captions);
    }
    if (captionsFile) await requireSubtitlesFilter();
    const tracks: MuxTrack[] = [];
    let audioCodec = "";
    let audioPeak: number | null = null;
    if (input.audio) {
      const audioAbs = await scopedPath(scope.root, input.audio);
      const probe = await probeAudioFile(audioAbs);
      if (!probe.codec || !(SUPPORTED_AUDIO_CODECS as readonly string[]).includes(probe.codec))
        throw fault("ERR_AUDIO_CODEC", `Audio ${input.audio} uses an unsupported codec${probe.codec ? ` (${probe.codec})` : ""}. Use AAC, MP3, Opus, Vorbis, FLAC or WAV.`, input.audio);
      audioCodec = probe.codec;
      audioPeak = probe.peakDb;
      tracks.push({ id: "audio", file: audioAbs, startMs: 0, offsetMs: 0, gain: 1, fadeInMs: 0, fadeOutMs: 0, audioMs: probe.durationMs ?? 0 });
    }
    const finalAbs = await scopedPath(scope.root, scope.output);
    try { await lstat(finalAbs); throw fault("output-exists", `Output ${scope.output} already exists. Choose another filename.`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    let fontsDir: string | undefined;
    try {
      const candidate = await scopedPath(scope.root, "assets");
      if ((await lstat(candidate)).isDirectory()) fontsDir = candidate;
    } catch { fontsDir = undefined; }
    await muxAudioCaptions({ video: silentAbs, tracks, ...(captionsFile ? { captionsFile } : {}), ...(fontsDir ? { fontsDir } : {}), output: finalAbs });
    const data: { audio?: { file: string; codec: string; driftMs: number; peakDb: number | null }; captions?: { file: string; cues: number; burnIn: boolean } } = {};
    if (input.captions) data.captions = { file: input.captions, cues: cueCount, burnIn: true };
    if (input.audio) {
      const drift = await probeAvDrift(finalAbs);
      if (drift.driftMs === null || drift.driftMs > AUDIO_DRIFT_BUDGET_MS) {
        await rm(finalAbs, { force: true });
        throw fault("ERR_AUDIO_DRIFT", drift.driftMs === null
          ? `Could not measure A/V drift for ${scope.output}; nothing was published.`
          : `A/V drift is ${drift.driftMs}ms over the ${AUDIO_DRIFT_BUDGET_MS}ms budget; nothing was published.`, scope.output);
      }
      data.audio = { file: input.audio, codec: audioCodec, driftMs: drift.driftMs, peakDb: audioPeak };
    }
    return data;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function muxAudioCaptions(request: MuxRequest, timeoutMs = 10 * 60_000): Promise<{ ffmpegArgs: string[] }> {
  if (request.captionsFile) await requireSubtitlesFilter();
  const { audioFilter, videoFilter } = buildMuxFilter(request.tracks, request.captionsFile, request.fontsDir);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", request.video];
  request.tracks.forEach((t) => {
    if (t.offsetMs > 0) args.push("-ss", (t.offsetMs / 1000).toFixed(3));
    args.push("-i", t.file);
  });
  if (audioFilter) args.push("-filter_complex", audioFilter);
  args.push("-map", "0:v");
  if (request.tracks.length) {
    args.push("-map", "[aout]");
    // WebM carries Opus; MP4 and MOV carry AAC.
    args.push("-c:a", request.output.toLowerCase().endsWith(".webm") ? "libopus" : "aac", "-shortest");
  }
  // Burned-in captions re-encode H.264 with the same BT.709 conversion; otherwise the finished video is copied.
  if (videoFilter) args.push("-vf", `${videoFilter},scale=out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`.replace(/^,/, ""));
  args.push(...(videoFilter ? ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"] : ["-c:v", "copy"]),
    ...(/\.(mp4|mov)$/i.test(request.output) ? ["-movflags", "+faststart"] : []), request.output);
  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    let child;
    try {
      child = spawn("ffmpeg", args, { shell: false, stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH."));
      return;
    }
    const timer = setTimeout(() => { child?.kill("SIGKILL"); reject(fault("encoding-failed", "Audio mix timed out.")); }, timeoutMs);
    child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4096); });
    child.once("error", () => { clearTimeout(timer); reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(fault("encoding-failed", `Audio mix failed. ${stderr.slice(-1000)}`));
    });
  });
  return { ffmpegArgs: args };
}
// Storyboard contact sheet: box-filtered thumbnails of the extracted frames on a dark grid,
// in frame order, as one RGB PNG. Pure byte math, so the same frames give the same sheet.
export function contactSheet(pngs: readonly Buffer[], options: { columns?: number; thumbWidth?: number } = {}): Buffer {
  if (!pngs.length) throw new Error("A contact sheet needs at least one frame.");
  const frames = pngs.map(parsePng);
  const columns = Math.max(1, Math.min(options.columns ?? Math.ceil(Math.sqrt(frames.length)), frames.length));
  const rows = Math.ceil(frames.length / columns);
  const thumbWidth = Math.max(16, Math.min(options.thumbWidth ?? 480, frames[0].width));
  const thumbHeight = Math.max(1, Math.round((frames[0].height * thumbWidth) / frames[0].width));
  const gap = 8;
  const width = columns * thumbWidth + (columns + 1) * gap, height = rows * thumbHeight + (rows + 1) * gap;
  if (width > 8192 || height > 8192) throw new Error("Contact sheet exceeds 8192 px; lower --columns or extract fewer frames.");
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height, 0);
  for (let y = 0; y < height; y++) raw.fill(18, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  frames.forEach((frame, index) => {
    const left = gap + (index % columns) * (thumbWidth + gap), top = gap + Math.floor(index / columns) * (thumbHeight + gap);
    for (let ty = 0; ty < thumbHeight; ty++) {
      const y0 = Math.floor((ty * frame.height) / thumbHeight), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * frame.height) / thumbHeight));
      for (let tx = 0; tx < thumbWidth; tx++) {
        const x0 = Math.floor((tx * frame.width) / thumbWidth), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * frame.width) / thumbWidth));
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = y0; y < Math.min(y1, frame.height); y++)
          for (let x = x0; x < Math.min(x1, frame.width); x++) {
            const o = (y * frame.width + x) * 4;
            r += frame.pixels[o]; g += frame.pixels[o + 1]; b += frame.pixels[o + 2]; n++;
          }
        const o = (top + ty) * (stride + 1) + 1 + (left + tx) * 3;
        raw[o] = Math.round(r / n); raw[o + 1] = Math.round(g / n); raw[o + 2] = Math.round(b / n);
      }
    }
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

// One FFmpeg run with captured stderr (loudnorm reports its measurement there).
function runFfmpeg(args: string[], timeoutMs = 10 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let child;
    try { child = spawn("ffmpeg", args, { shell: false, stdio: ["ignore", "ignore", "pipe"] }); }
    catch { reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")); return; }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-65_536); });
    child.once("error", () => { clearTimeout(timer); reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")); });
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve(stderr) : reject(fault("encoding-failed", `FFmpeg failed. ${stderr.slice(-800)}`)); });
  });
}
/** Render one procedural SFX entry to a mono 48 kHz WAV (bit-exact for the same preset, seed and gain). */
export async function synthesizeSfx(entry: Pick<SfxEntry, "preset" | "gainDb" | "seed">, outputAbs: string): Promise<{ durationMs: number }> {
  await mkdir(path.dirname(outputAbs), { recursive: true });
  await runFfmpeg(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-filter_complex", sfxGraph(entry, "out"), "-map", "[out]", "-c:a", "pcm_s16le", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1", outputAbs]);
  return { durationMs: SFX_PRESETS[entry.preset].durationMs };
}
export type LoudnessMeasurement = { integrated: number; truePeak: number; range: number; threshold: number; offset: number };
function loudnormReport(stderr: string, prefix: "input" | "output"): LoudnessMeasurement {
  const json = stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1);
  let report: Record<string, string>;
  try { report = JSON.parse(json); } catch { throw fault("encoding-failed", "Loudness measurement produced no report."); }
  const value = (key: string) => Number(report[`${prefix}_${key}`]);
  return { integrated: value("i"), truePeak: value("tp"), range: value("lra"), threshold: value("thresh"), offset: Number(report.target_offset) };
}
/**
 * Two-pass EBU R128 normalization of a finished file's audio to the target (video stream copied).
 * Returns the first-pass measurement and the measured result.
 */
export async function normalizeLoudness(fileAbs: string, target: Loudness): Promise<{ measured: LoudnessMeasurement; result: LoudnessMeasurement; skipped?: true }> {
  const spec = `I=${target.integrated}:TP=${target.truePeak}:LRA=${target.range}`;
  const measured = loudnormReport(await runFfmpeg(["-hide_banner", "-nostdin", "-i", fileAbs, "-af", `loudnorm=${spec}:print_format=json`, "-f", "null", "-"]), "input");
  // Too short or silent to gate (EBU R128 measures 400 ms blocks): leave the mix untouched and say so.
  if (![measured.integrated, measured.truePeak, measured.range, measured.threshold, measured.offset].every(Number.isFinite)) return { measured, result: measured, skipped: true };
  const temporary = path.join(path.dirname(fileAbs), `.loudnorm-${path.basename(fileAbs)}`);
  try {
    const second = `loudnorm=${spec}:measured_I=${measured.integrated}:measured_TP=${measured.truePeak}:measured_LRA=${measured.range}:measured_thresh=${measured.threshold}:offset=${measured.offset}:linear=true:print_format=json`;
    const webm = /\.webm$/i.test(fileAbs);
    const stderr = await runFfmpeg(["-hide_banner", "-nostdin", "-y", "-i", fileAbs, "-map", "0:v?", "-map", "0:a", "-c:v", "copy", "-af", `${second},aresample=48000`, "-c:a", webm ? "libopus" : "aac", "-b:a", "192k",
      ...(/\.(mp4|mov)$/i.test(fileAbs) ? ["-movflags", "+faststart"] : []), temporary]);
    const result = loudnormReport(stderr, "output");
    await rm(fileAbs, { force: true });
    await rename(temporary, fileAbs);
    return { measured, result };
  } finally { await rm(temporary, { force: true }); }
}
/** Integrated loudness of a file (one measurement pass), for checks and tests. */
export async function measureLoudness(fileAbs: string, target: Loudness = DEFAULT_LOUDNESS): Promise<LoudnessMeasurement> {
  return loudnormReport(await runFfmpeg(["-hide_banner", "-nostdin", "-i", fileAbs, "-af", `loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.range}:print_format=json`, "-f", "null", "-"]), "input");
}
/** SHA-256 of a project file (deliverables manifest); read in one pass, files are launch-sized. */
export async function sha256File(root: string, target: string): Promise<string> {
  return sha256Hex(await readFile(await scopedPath(root, target)));
}
/** One still at an exact size: cover-scale and center-crop a rendered PNG, written as PNG or JPEG; never overwrites. */
export async function encodeStill(root: string, sourcePng: Buffer, output: string, size: { width: number; height: number }): Promise<void> {
  const scope = await prepareFileOutput(root, output);
  const target = await scopedPath(scope.root, scope.output);
  await mkdir(path.dirname(target), { recursive: true });
  const dir = await mkdtemp(path.join(path.dirname(target), ".velora-still-"));
  try {
    const source = path.join(dir, "source.png");
    await writeFile(source, sourcePng);
    const jpeg = /\.jpe?g$/i.test(output);
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-nostdin", "-i", source, "-vf", coverFilter(size.width, size.height),
      "-frames:v", "1", ...(jpeg ? ["-q:v", "3"] : []), "-n", target]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
/** Publish a finished attempt under its final project-relative name without ever overwriting (hard link, then unlink). */
export async function promoteFile(root: string, from: string, to: string): Promise<void> {
  const scope = await prepareFileOutput(root, to);
  const source = await scopedPath(scope.root, from);
  const target = await scopedPath(scope.root, scope.output);
  await mkdir(path.dirname(target), { recursive: true });
  try { await link(source, target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw fault("output-exists", `Output ${to} already exists. Choose another output directory.`);
    // Filesystems without hard links: rename stays atomic inside one directory tree.
    await rename(source, target);
    return;
  }
  await rm(source, { force: true });
}
/** Remove a project-scoped scratch directory created by deliver (its attempts). */
export async function removeScratchDir(root: string, target: string): Promise<void> {
  if (!/(^|\/)\.velora-attempts$/.test(target.replace(/\\/g, "/"))) throw fault("denied-path", "Only .velora-attempts scratch directories are removed.", target);
  await rm(await scopedPath(root, target), { recursive: true, force: true });
}
/** Create a project-scoped directory (and parents) for outputs that renderers expect to exist. */
export async function ensureDir(root: string, target: string): Promise<void> {
  await mkdir(await scopedPath(root, target), { recursive: true });
}
/** Read a rendered project file (frame PNGs can exceed the 2 MB text-read cap). */
export async function readRendered(root: string, target: string): Promise<Buffer | undefined> {
  try { return await readFile(await scopedPath(root, target)); } catch { return undefined; }
}
/** Remove a project directory only when it is empty (a failed deliver leaves no stray output folder). */
export async function removeEmptyDir(root: string, target: string): Promise<void> {
  try { await rmdir(await scopedPath(root, target)); } catch { /* not empty or already gone */ }
}
let filterProbe: Promise<Set<string> | undefined> | undefined;
/** Filters this FFmpeg build provides (probed once per process). */
export function ffmpegFilters(timeoutMs = 10_000): Promise<Set<string> | undefined> {
  filterProbe ??= new Promise(resolve => {
    let out = "";
    let child;
    try { child = spawn("ffmpeg", ["-hide_banner", "-filters"], { shell: false, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { resolve(undefined); return; }
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(undefined); }, timeoutMs);
    child.stdout?.on("data", chunk => { out += chunk.toString(); });
    child.once("error", () => { clearTimeout(timer); resolve(undefined); });
    child.once("close", code => { clearTimeout(timer); resolve(code === 0 ? new Set(out.split(/\r?\n/).map(line => line.trim().split(/\s+/)[1]).filter(Boolean)) : undefined); });
  });
  return filterProbe;
}
/** Caption burn-in needs FFmpeg's subtitles filter (libass); minimal builds (Homebrew's core ffmpeg) lack it. */
export async function requireSubtitlesFilter(): Promise<void> {
  const filters = await ffmpegFilters();
  if (filters && !filters.has("subtitles"))
    throw fault("ERR_FFMPEG_FILTER", "This FFmpeg build has no subtitles filter (libass), so captions cannot be burned in. Install a full build (Homebrew: brew install ffmpeg-full; Windows: the gyan.dev full build), or keep captions as a styled overlay (captions.style without burn).");
}
