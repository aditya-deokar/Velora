import { lstat, mkdir, mkdtemp, link, rm, readdir, open, writeFile, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { cpus } from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { inflateSync, deflateSync } from "node:zlib";
import type { Browser, Page } from "playwright";
import type { CaptureBridge, CaptureManifest, ExportVideo } from "../core/export";
import { AUDIO_DRIFT_BUDGET_MS, SUPPORTED_AUDIO_CODECS } from "../core/audio";
import { formatSrt, parseCaptions } from "../core/captions";
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
export async function openCapture(input: Pick<ExportVideo,"url"|"width"|"height">, signal?: AbortSignal) {
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
    page = await browser.newPage({ viewport: { width: input.width, height: input.height }, deviceScaleFactor: 1 });
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
    try { await page.waitForFunction(() => typeof (window as unknown as { __VELORA_CAPTURE__?: CaptureBridge }).__VELORA_CAPTURE__?.seek === "function", undefined, { timeout: 5000 }); }
    catch { throw fault("missing-capture", "This page has no ready Velora capture bridge. Open a scene with capture enabled and retry."); }
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
        return { version: bridge.version, durationMs: bridge.durationMs, selector: bridge.selector };
      }),
      async snapshot(timeMs:number, manifest:CaptureManifest){
        check();
        await page.waitForLoadState("networkidle",{timeout:10_000});
        await page.evaluate(()=>document.fonts.ready.then(()=>{}));
        const locator=page.locator(manifest.selector);
        if(await locator.count()!==1)throw fault("invalid-capture","Capture must identify exactly one scene viewport.");
        await page.evaluate(elapsed=>(window as unknown as {__VELORA_CAPTURE__:CaptureBridge}).__VELORA_CAPTURE__.seek(elapsed),timeMs);
        const rect=await locator.boundingBox();
        if(!rect||rect.width<1||rect.height<1||rect.width>3840||rect.height>3840)throw fault("invalid-capture","Scene viewport must be visible and bounded.");
        const png=await page.screenshot({clip:rect,type:"png",animations:"disabled",timeout:10_000});check();
        return "data:image/png;base64,"+png.toString("base64");
      },
      async encode(scope: { root: string; output: string }, options: ExportVideo, manifest: CaptureManifest, frames: number) {
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
          const video = path.join(temporary, "video.mp4");
          encoder = spawn("ffmpeg", videoEncodeArgs({ fps: options.fps, width: options.width, height: options.height, frames }, video), { cwd: scope.root, shell: false, stdio: ["pipe", "ignore", "pipe"] });
          const timeout = setTimeout(() => encoder?.kill("SIGKILL"), 15 * 60_000);
          let stderr = "";
          encoder.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
          const finished = new Promise<void>((resolve, reject) => {
            encoder!.once("error", () => { clearTimeout(timeout); reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")); });
            encoder!.once("close", code => { clearTimeout(timeout); code === 0 ? resolve() : reject(fault("encoding-failed", `FFmpeg failed. ${stderr.slice(-1000)}`)); });
          });
          void finished.catch(() => {});
          encoder.stdin!.on("error", () => {});
          for (let i = 0; i < frames; i++) {
            check();
            await page.evaluate(elapsed => (window as unknown as { __VELORA_CAPTURE__: CaptureBridge }).__VELORA_CAPTURE__.seek(elapsed), i * 1000 / options.fps);
            const png = await page.screenshot({clip:rect, type: "png", animations: "disabled", timeout: 10_000 });
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
// (recipe + binding bytes, frame time, fps, dimensions, seed, code version);
// entries are verified by recomputed SHA on read, never trusted by mtime.
export function frameCacheKey(parts: { recipeSha: string; bindingSha: string; timeMs: number; fps: number; width: number; height: number; seed: number; version: string }): string {
  return sha256Hex([parts.recipeSha, parts.bindingSha, String(parts.timeMs), String(parts.fps), String(parts.width), String(parts.height), String(parts.seed), parts.version].join("|"));
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
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, tail]);
}
export function voidPng(width: number, height: number): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 3840 || height > 3840)
    throw new Error("Void frame dimensions must be integers within 1..3840.");
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) raw[y * (stride + 1)] = 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
// RGB/RGBA/grayscale, the exact shapes Chromium screenshots produce.
// Anything else fails closed with an honest diagnostic instead of guessing.
export function parsePng(png: Buffer): { width: number; height: number; pixels: Buffer } {
  // Minimal decoder for the visual-check suite: 8-bit non-interlaced
  // RGB/RGBA/grayscale, the exact shapes Chromium screenshots produce.
  // Anything else fails closed with an honest diagnostic instead of guessing.
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (png.length < 33 || !png.subarray(0, 8).equals(signature)) throw new Error("Not a PNG file.");
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = -1, interlace = 1;
  const idat: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!width || !height) throw new Error("PNG is missing its IHDR.");
  if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 6].includes(colorType)) throw new Error("Only 8-bit non-interlaced grayscale/RGB/RGBA PNGs are supported.");
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error("PNG scanline size does not match its IHDR.");
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  let position = 0;
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[position++];
    const line = Buffer.from(raw.subarray(position, position + stride));
    position += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      line[x] = (line[x] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0)) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) { pixels[o] = line[x * 4]; pixels[o + 1] = line[x * 4 + 1]; pixels[o + 2] = line[x * 4 + 2]; pixels[o + 3] = line[x * 4 + 3]; }
      else if (colorType === 2) { pixels[o] = line[x * 3]; pixels[o + 1] = line[x * 3 + 1]; pixels[o + 2] = line[x * 3 + 2]; pixels[o + 3] = 255; }
      else { pixels[o] = pixels[o + 1] = pixels[o + 2] = line[x]; pixels[o + 3] = 255; }
    }
    previous = line;
  }
  return { width, height, pixels };
}
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
export function coverFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
}
export function videoEncodeArgs(options: { fps: number; width: number; height: number; frames: number }, output: string): string[] {
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "image2pipe", "-framerate", String(options.fps),
    "-vcodec", "png", "-i", "pipe:0", "-an", "-vf", coverFilter(options.width, options.height),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-frames:v", String(options.frames), "-n", output];
}
// Encode in-memory PNG buffers to MP4 with the exact live-capture pipeline.
// Used by composition video rendering; same bytes in, same bytes out.
export async function encodeFrameBuffers(pngs: Buffer[], output: string, options: { fps: number; width: number; height: number; cwd: string; signal?: AbortSignal }): Promise<{ ffmpegArgs: string[] }> {
  if (!pngs.length) throw fault("invalid-capture", "Nothing to encode: the timeline spans less than one frame.");
  const args = videoEncodeArgs({ fps: options.fps, width: options.width, height: options.height, frames: pngs.length }, output);
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
        for (const png of pngs) {
          if (options.signal?.aborted) throw fault("export-cancelled", "Video render cancelled; no output was published.");
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
// Segment-worker default: CPU count capped at 4, at least 1. Frames stay
// serial-deterministic inside each worker; only segments run concurrently.
export function defaultParallelism(): number {
  try {
    return Math.min(4, Math.max(1, cpus().length || 1));
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
// Resolve a project-relative output to an absolute path for process spawns.
// Traversal, absolute paths and symlinks stay denied by scopedPath.
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
  const escaped = absolutePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
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
    scope: { root: scope.root, output: path.relative(scope.root, path.join(temporary, "silent.mp4")) },
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
  const { audioFilter, videoFilter } = buildMuxFilter(request.tracks, request.captionsFile, request.fontsDir);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", request.video];
  request.tracks.forEach((t) => {
    if (t.offsetMs > 0) args.push("-ss", (t.offsetMs / 1000).toFixed(3));
    args.push("-i", t.file);
  });
  if (audioFilter) args.push("-filter_complex", audioFilter);
  if (videoFilter) args.push("-vf", videoFilter);
  args.push("-map", "0:v");
  if (request.tracks.length) {
    args.push("-map", "[aout]");
    args.push("-c:a", "aac", "-shortest");
  }
  args.push("-c:v", videoFilter ? "libx264" : "copy", "-pix_fmt", "yuv420p", "-movflags", "+faststart", request.output);
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
