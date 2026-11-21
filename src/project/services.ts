import { createRequire } from "node:module";
import { constants, existsSync } from "node:fs";
import { lstat, realpath, open, opendir, mkdir, rename, link, unlink, copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { VELORA_PACKAGE } from "../core/branding";
import { fault } from "./errors";

/** SOURCE OF TRUTH: scoped project effects.
 * WHAT: bounded filesystem, npm, HTTP and browser transports.
 * WHY: commands own policy; adapters never acquire direct host access.
 * WHERE: commands.ts supplies explicit canonical roots and relative targets.
 */
export async function canonicalRoot(root: string): Promise<string> {
  if (typeof root !== "string" || !path.isAbsolute(root) || root.includes("\0"))
    throw fault("invalid-scope", "Provide an absolute local project directory.");
  const canonical = await realpath(root);
  if (!(await lstat(canonical)).isDirectory()) throw fault("invalid-scope", "Project root must be a directory.");
  return canonical;
}
export function relativeTarget(target: string): string {
  const parts = target.split("/");
  if (!target || path.isAbsolute(target) || target.includes("\\") || target.includes("\0")
    || parts.some(part => !part || part === "." || part === ".." || part === ".git"
      || part === ".agents" || part === ".codex" || part.startsWith(".env")))
    throw fault("denied-path", "Use a project-relative path outside protected files.", target);
  return target;
}
export async function scopedPath(root: string, target: string): Promise<string> {
  relativeTarget(target);
  let current = root;
  for (const part of target.split("/")) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw fault("denied-path", "Symlinked project targets are unsupported.", target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return current;
}
export async function readText(root: string, target: string, maxBytes = 2_000_000, { strictUtf8 = false } = {}): Promise<string | undefined> {
  const filename = await scopedPath(root, target);
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_000_000)
      throw fault("invalid-input", "Read limit must be between 1 and 2000000 bytes.", target);
    if (!stat.isFile() || stat.size > maxBytes) throw fault("invalid-file", `Expected a regular project file at most ${maxBytes} bytes.`, target);
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw fault("invalid-file", `Project file exceeded ${maxBytes} bytes while reading.`, target);
    const bytes = buffer.subarray(0, length);
    if (!strictUtf8) return bytes.toString("utf8");
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw fault("invalid-file", "Expected a UTF-8 text file.", target); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  } finally { await handle?.close(); }
}
// Bounded, nonrecursive transport only; commands choose directories, limits and eligible files.
export async function scanDirectory(root: string, target: string, maxEntries: number): Promise<string[]> {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1024)
    throw fault("invalid-input", "Directory limit must be between 1 and 1024 entries.", target);
  const filename = await scopedPath(root, target);
  let directory;
  try { directory = await opendir(filename); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries: string[] = [];
  for await (const entry of directory) {
    if (entries.length >= maxEntries) throw fault("invalid-file", `Directory exceeds ${maxEntries} entries; reduce its size and retry.`, target);
    entries.push(`${target}/${entry.name}`);
  }
  return entries.sort();
}
// Regular files directly in the project root whose names end with suffix (no symlinks, bounded).
export async function listRootFiles(root: string, suffix: string, maxFiles = 64): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of await opendir(root)) {
    if (!entry.isFile() || !entry.name.endsWith(suffix) || entry.name.startsWith(".")) continue;
    names.push(entry.name);
    if (names.length >= maxFiles) break;
  }
  return names.sort();
}
export async function isRegularFile(root: string, target: string): Promise<boolean> {
  const filename = await scopedPath(root, target);
  try { return (await lstat(filename)).isFile(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export async function atomicWrite(root: string, target: string, content: string, expected: string | undefined) {
  const filename = await scopedPath(root, target);
  if (await readText(root, target) !== expected) throw fault("conflict", "Project file changed during setup; retry after reviewing it.", target);
  await mkdir(path.dirname(filename), { recursive: true });
  await scopedPath(root, target);
  const temporary = target + "." + randomUUID() + ".tmp";
  const temporaryPath = await scopedPath(root, temporary);
  const handle = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    if (await readText(root, target) !== expected) throw fault("conflict", "Project file changed during setup.", target);
    const destination = await scopedPath(root, target);
    // Create-only writes must not replace a file that appears after the last read.
    if (expected === undefined) {
      try { await link(temporaryPath, destination); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw fault("conflict", "Project file appeared during setup; review it before retrying.", target);
        throw error;
      }
    } else await rename(temporaryPath, destination);
  } finally {
    await handle.close();
    await unlink(temporaryPath).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
export async function removeText(root: string, target: string, expected: string) {
  if (await readText(root, target) !== expected) throw fault("conflict", "Pending setup changed; review before retrying.", target);
  await unlink(await scopedPath(root, target));
}
export const currentProjectProcess = () => process.pid;
export function projectProcessIsRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
export const textByteLength = (text: string) => Buffer.byteLength(text, "utf8");
export function projectRelativePath(root: string, input: string): string {
  const target = path.isAbsolute(input) ? path.relative(root, input) : input;
  return relativeTarget(target.replaceAll("\\", "/").replace(/^\.\//, ""));
}
export const resolveProjectImport = (file: string, specifier: string) => path.posix.join(path.posix.dirname(file), specifier);
export async function gitFileStatus(root: string, target: string): Promise<"clean" | "dirty" | "unknown"> {
  await scopedPath(root, target);
  return new Promise(resolve => {
    const child = spawn("git", ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all", "--", target], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let dirty = false;
    const timer = setTimeout(() => { child.kill(); resolve("unknown"); }, 2500);
    child.stdout.on("data", () => { dirty = true; });
    child.once("error", () => { clearTimeout(timer); resolve("unknown"); });
    child.once("close", code => { clearTimeout(timer); resolve(code !== 0 ? "unknown" : dirty ? "dirty" : "clean"); });
  });
}
// Binary counterparts for asset files, which must round-trip byte-exactly.
// Read up to `count` leading bytes regardless of total file size, for
// content sniffing. Returns undefined only when the file disappears.
export async function peekBytes(root: string, target: string, count: number): Promise<Buffer | undefined> {
  const filename = await scopedPath(root, target);
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw fault("invalid-file", "Expected a regular project file.", target);
    const buffer = Buffer.alloc(Math.max(1, Math.min(count, 8192)));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return buffer.subarray(0, length);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  } finally { await handle?.close(); }
}
export async function statFile(root: string, target: string): Promise<{ bytes: number } | undefined> {
  const filename = await scopedPath(root, target);
  try {
    const stat = await lstat(filename);
    if (stat.isSymbolicLink()) throw fault("denied-path", "Symlinked project targets are unsupported.", target);
    if (!stat.isFile()) throw fault("invalid-file", "Expected a regular project file.", target);
    return { bytes: stat.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function readBytes(root: string, target: string, maxBytes = 2_000_000): Promise<Buffer | undefined> {
  const filename = await scopedPath(root, target);
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_000_000)
      throw fault("invalid-input", "Read limit must be between 1 and 2000000 bytes.", target);
    if (!stat.isFile() || stat.size > maxBytes) throw fault("invalid-file", `Expected a regular project file at most ${maxBytes} bytes.`, target);
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw fault("invalid-file", `Project file exceeded ${maxBytes} bytes while reading.`, target);
    return buffer.subarray(0, length);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  } finally { await handle?.close(); }
}
// Copy an outside absolute file into the project without overwriting anything.
// The source must be a regular non-symlink file; oversize sources fail before
// any write, and a post-copy size check guards against concurrent growth.
export async function copyFileInto(root: string, sourceAbsolute: string, target: string, maxBytes: number): Promise<{ bytes: number }> {
  const destination = await scopedPath(root, target);
  let sourceStat;
  try {
    sourceStat = await lstat(sourceAbsolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw fault("invalid-input", "Source file was not found. Pass an existing local file path.", sourceAbsolute);
    throw error;
  }
  if (sourceStat.isSymbolicLink()) throw fault("denied-path", "Symlinked sources are unsupported. Pass the real file.", sourceAbsolute);
  if (!sourceStat.isFile()) throw fault("invalid-input", "Source must be a regular file.", sourceAbsolute);
  if (sourceStat.size > maxBytes) throw fault("ERR_ASSET_TOO_LARGE", `Source exceeds ${maxBytes} bytes. Compress it and retry.`, sourceAbsolute);
  await mkdir(path.dirname(destination), { recursive: true });
  await scopedPath(root, target);
  try {
    await copyFile(sourceAbsolute, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw fault("conflict", "Project file appeared during setup; review it before retrying.", target);
    throw error;
  }
  const written = await lstat(destination);
  if (written.size > maxBytes) {
    await unlink(destination).catch(() => {});
    throw fault("ERR_ASSET_TOO_LARGE", `Source exceeds ${maxBytes} bytes. Compress it and retry.`, sourceAbsolute);
  }
  return { bytes: written.size };
}
export async function removeFile(root: string, target: string): Promise<void> {
  const filename = await scopedPath(root, target);
  try {
    const stat = await lstat(filename);
    if (stat.isSymbolicLink()) throw fault("denied-path", "Symlinked project targets are unsupported.", target);
    if (!stat.isFile()) throw fault("invalid-file", "Expected a regular project file.", target);
    await unlink(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw fault("conflict", "Project file changed during removal; review it before retrying.", target);
    throw error;
  }
}
export function newProjectId() { return randomUUID(); }
/** SHA-256 (hex) of a text as UTF-8: the compare-and-swap identity of a project file revision. */
export function textSha256(text: string): string { return createHash("sha256").update(text, "utf8").digest("hex"); }
export function runtimeVersion(): string { return process.version; }

// Real prerequisite probe: resolve true only when the executable starts and
// exits 0 within the budget. Missing binaries, timeouts and nonzero exits
// resolve false; doctor reports them instead of throwing.
export function probeExecutable(executable: string, args: string[], timeoutMs = 10_000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = spawn(executable, args, { shell: false, stdio: "ignore" });
    } catch { done(false); return; }
    const timer = setTimeout(() => { child?.kill(); done(false); }, timeoutMs);
    child.once("error", () => { clearTimeout(timer); done(false); });
    child.once("exit", (code) => { clearTimeout(timer); done(code === 0); });
  });
}

function run(root: string, executable: string, args: string[], timeout = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    // Only Windows .cmd shims (npm.cmd) need a shell; their arguments must not carry cmd metacharacters,
    // because the shell concatenates them (a --package path with & or | would run a second command).
    const shell = process.platform === "win32" && /\.cmd$/i.test(executable);
    if (shell && args.some(arg => /[&|<>^%!"\r\n]/.test(arg))) {
      reject(fault("denied-path", "Paths passed to npm on Windows cannot contain & | < > ^ % ! or quotes. Rename the file or folder and retry."));
      return;
    }
    const child = spawn(executable, args.map(arg => shell && /\s/.test(arg) ? `"${arg}"` : arg), { cwd: root, shell, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); reject(fault("process-failed", "Local process timed out; retry after checking the project.")); }, timeout);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(fault("process-failed", "Local process failed; check npm installation and retry."));
    });
  });
}
export async function installPackage(root: string, source: string) {
  await run(root, process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--", source]);
}
export async function fetchText(url: string, timeoutMs = 3000): Promise<string> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 2_000_000) {
    await response.body?.cancel();
    throw fault("missing-dev-server", "Dev server did not return a supported response.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw fault("missing-dev-server", "Dev server returned no content.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 2_000_000) throw fault("missing-dev-server", "Dev server response exceeded 2 MB.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function openBrowser(root: string, url: string) {
  if (process.platform === "darwin") await run(root, "open", [url], 10_000);
  else if (process.platform === "win32") await run(root, "rundll32", ["url.dll,FileProtocolHandler", url], 10_000);
  else await run(root, "xdg-open", [url], 10_000);
}

export async function localPackageSource(root: string, source: string): Promise<string> {
  const filename = path.isAbsolute(source) ? source : await scopedPath(root, source.replace(/^\.\//, ""));
  const stat = await lstat(filename).catch(error => {
    if (error.code === "ENOENT") throw fault("package-unavailable", "Local Velora tarball was not found. Correct --package to an existing .tgz file, or install velora locally and run npx velora init.", source);
    throw error;
  });
  if (!stat.isFile() || stat.isSymbolicLink()) throw fault("denied-path", "Package source must be a regular local tarball.");
  return realpath(filename);
}

export function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export type AudioProbe = { codec: string | null; durationMs: number | null; peakDb: number | null; detail: string };
// Single FFmpeg pass over an audio file: stream codec, container duration and
// peak volume (volumedetect). No transcoding, bounded output, never throws.
// Lives here (not export/services) so project validation can probe audio too.
/** Decode an audio file to mono 32-bit float PCM at `sampleRate` (FFmpeg), for rhythm analysis. */
export async function decodePcm(absolutePath: string, sampleRate: number, maxSeconds = 600, timeoutMs = 120_000): Promise<Float32Array> {
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let child;
    try { child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", absolutePath, "-t", String(maxSeconds), "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "pipe:1"], { shell: false, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")); return; }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", chunk => chunks.push(chunk));
    child.once("error", () => { clearTimeout(timer); reject(fault("missing-ffmpeg", "Install FFmpeg and ensure ffmpeg is available on PATH.")); });
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(fault("ERR_AUDIO_CODEC", "The audio file could not be decoded.")); });
  });
  const samples = new Float32Array(Math.floor(bytes.length / 4));
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
  return samples;
}
export async function probeAudioFile(absolutePath: string, timeoutMs = 30_000): Promise<AudioProbe> {
  const stderr = await new Promise<string>((resolve) => {
    let settled = false;
    const done = (value: string) => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = spawn("ffmpeg", ["-hide_banner", "-nostdin", "-i", absolutePath, "-af", "volumedetect", "-f", "null", "-"], { shell: false, stdio: ["ignore", "ignore", "pipe"] });
    } catch { done(""); return; }
    let out = "";
    const timer = setTimeout(() => { child?.kill("SIGKILL"); done(out); }, timeoutMs);
    child.stderr?.on("data", (chunk) => { out = (out + chunk.toString()).slice(-65536); });
    child.once("error", () => { clearTimeout(timer); done(out); });
    child.once("exit", () => { clearTimeout(timer); done(out); });
  });
  const codec = /Stream #\d+:\d+[^:]*: Audio: ([a-z0-9_]+)/.exec(stderr)?.[1] ?? null;
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  const durationMs = duration ? Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000) : null;
  const peak = /max_volume: (-?[\d.]+|n\/a|-inf) dB/.exec(stderr)?.[1];
  const peakDb = peak === undefined || peak === "n/a" || peak === "-inf" ? null : Number(peak);
  return { codec, durationMs, peakDb, detail: stderr.slice(-2000) };
}
/** Read-only dependency resolution; hoisted and pnpm-linked packages are not mutation targets. */
export async function readDependency(root:string,name:string,target="package.json"):Promise<string|undefined> {
  if (!["react","react-dom",VELORA_PACKAGE.name,...VELORA_PACKAGE.legacyNames].includes(name)) throw fault("invalid-input","Unknown runtime dependency.");
  relativeTarget(target);
  const candidates=createRequire(path.join(root,"package.json")).resolve.paths(name)??[];
  for(const modules of candidates) {
    let directory:string;
    try { directory=await realpath(path.join(modules,name)); }
    catch(error) { if((error as NodeJS.ErrnoException).code==="ENOENT")continue;throw error; }
    return readText(directory,target);
  }
  return undefined;
}

/** SOURCE OF TRUTH: skills source location and tree listing.
 * WHAT: locate the packaged skills tree and list it recursively with bounds.
 * WHY: install/ls/check share one discovery policy across dev checkouts and
 * packed npm artifacts without guessing agent-specific paths.
 * WHERE: commands.ts resolves --source/--dir policy; this module owns effects.
 */
export const SKILLS_ROOT_MARKER = "velora/SKILL.md";
export const MAX_SKILL_FILES = 512;
export const VELORA_SKILL_PREFIX = "velora";
// Walk up from this module to find <root>/skills/velora/SKILL.md. Works from
// src/project (dev/vitest) and dist/cli (packed CLI) at the same depth.
export function locatePackagedSkills(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, "skills", SKILLS_ROOT_MARKER))) return path.join(dir, "skills");
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
// Recursive bounded listing of relative file paths under dir. Symlinks are
// never followed; symlinked entries are skipped rather than resolved.
export async function scanTree(root: string, dir: string, maxFiles = MAX_SKILL_FILES): Promise<string[]> {
  const base = dir ? await scopedPath(root, dir) : await canonicalRoot(root);
  const out: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    let directory;
    try {
      directory = await opendir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for await (const entry of directory) {
      if (out.length >= maxFiles) throw fault("invalid-file", `Directory exceeds ${maxFiles} entries; reduce its size and retry.`, dir);
      const full = path.join(current, entry.name);
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      let stat;
      try {
        stat = await lstat(full);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) await walk(full, child);
      else if (stat.isFile()) out.push(dir ? `${dir}/${child}` : child);
    }
  }
  await walk(base, "");
  return out.sort();
}
// Absolute-path skills transports. Install targets live outside the project
// root (agent skill directories), so these helpers take absolute paths and
// never consult scopedPath. Symlinks are never followed; symlinked entries
// are skipped. All reads are bounded like their scoped counterparts.
export async function readAbsoluteText(absolutePath: string, maxBytes = 2_000_000): Promise<string | undefined> {
  if (typeof absolutePath !== "string" || !path.isAbsolute(absolutePath) || absolutePath.includes("\0"))
    throw fault("invalid-scope", "Provide an absolute local file path.");
  let handle;
  try {
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw fault("invalid-file", `Expected a regular file at most ${maxBytes} bytes.`, absolutePath);
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw fault("invalid-file", `File exceeded ${maxBytes} bytes while reading.`, absolutePath);
    return buffer.subarray(0, length).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  } finally { await handle?.close(); }
}
export async function listAbsoluteTree(absoluteDir: string, maxFiles = MAX_SKILL_FILES): Promise<string[]> {
  if (typeof absoluteDir !== "string" || !path.isAbsolute(absoluteDir) || absoluteDir.includes("\0"))
    throw fault("invalid-scope", "Provide an absolute local directory.");
  const out: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    let directory;
    try {
      directory = await opendir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for await (const entry of directory) {
      if (out.length >= maxFiles) throw fault("invalid-file", `Directory exceeds ${maxFiles} entries; reduce its size and retry.`, absoluteDir);
      const full = path.join(current, entry.name);
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      let stat;
      try {
        stat = await lstat(full);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) await walk(full, child);
      else if (stat.isFile()) out.push(child);
    }
  }
  await walk(absoluteDir, "");
  return out.sort();
}
export async function ensureAbsoluteDir(absoluteDir: string): Promise<string> {
  if (typeof absoluteDir !== "string" || !path.isAbsolute(absoluteDir) || absoluteDir.includes("\0"))
    throw fault("invalid-scope", "Provide an absolute local directory.");
  const base = path.basename(absoluteDir);
  if (base === "AGENTS.md" || base === "CLAUDE.md")
    throw fault("denied-path", "Refusing to install into an agent config file. Pass a skills directory instead.", absoluteDir);
  await mkdir(absoluteDir, { recursive: true });
  return absoluteDir;
}
// Atomic absolute write with expected-bytes semantics for idempotent
// installs. expected undefined means create-only; a differing existing file
// is a conflict (caller maps to ERR_SKILL_CONFLICT), never a silent overwrite.
export async function writeAbsoluteText(absolutePath: string, content: string, expected: string | undefined): Promise<void> {
  if (typeof absolutePath !== "string" || !path.isAbsolute(absolutePath) || absolutePath.includes("\0"))
    throw fault("invalid-scope", "Provide an absolute local file path.");
  const current = await readAbsoluteText(absolutePath);
  if (current !== expected)
    throw fault("conflict", "Project file changed during setup; retry after reviewing it.", absolutePath);
  if (current === content) return;
  if (expected !== undefined && current !== expected)
    throw fault("conflict", "File changed during setup.", absolutePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const after = await readAbsoluteText(absolutePath);
  if (after !== expected)
    throw fault("conflict", "File changed during setup.", absolutePath);
  if (expected === undefined && after !== undefined)
    throw fault("conflict", "File appeared during setup; review it before retrying.", absolutePath);
  const temporary = `${absolutePath}.${randomUUID()}.tmp`;
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    if (expected === undefined) {
      try { await link(temporary, absolutePath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw fault("conflict", "File appeared during setup; review it before retrying.", absolutePath);
        throw error;
      }
    } else {
      await rename(temporary, absolutePath);
    }
  } finally {
    try { await handle.close(); } catch { /* already closed */ }
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}
// Resolve a skills --dir/--source value to an absolute directory without
// requiring commands to import Node path. Absolute values pass through (with
// AGENTS.md/CLAUDE.md refusal); project-relative values resolve against root.
// Returns undefined when input is undefined (ls/check without --dir).
export function isAbsolutePathLike(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}
export async function resolveSkillsDir(root: string, dir: string | undefined): Promise<string | undefined> {
  if (dir === undefined) return undefined;
  if (typeof dir !== "string" || !dir || dir.includes("\0"))
    throw fault("invalid-scope", "Provide a local skills directory.");
  if (isAbsolutePathLike(dir)) {
    const base = dir.split(/[\\/]/).pop() ?? dir;
    if (base === "AGENTS.md" || base === "CLAUDE.md")
      throw fault("denied-path", "Refusing to install into an agent config file. Pass a skills directory instead.", dir);
    return path.normalize(dir);
  }
  if (dir.includes("\\") || dir.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\0")))
    throw fault("denied-path", "Use a project-relative skills directory without traversal.", dir);
  const base = dir.split("/").pop() ?? dir;
  if (base === "AGENTS.md" || base === "CLAUDE.md")
    throw fault("denied-path", "Refusing to install into an agent config file. Pass a skills directory instead.", dir);
  return path.join(await canonicalRoot(root), ...dir.split("/"));
}
export async function resolveSkillsSource(root: string, source: string | undefined): Promise<string | undefined> {
  if (source !== undefined) return resolveSkillsDir(root, source);
  return locatePackagedSkills();
}
export function isVeloraSkillFile(rel: string): boolean {
  return rel === "velora" || rel.startsWith("velora/") || rel.startsWith("velora-");
}
export function skillNameFromRel(rel: string): string | undefined {
  if (rel === "velora/SKILL.md") return "velora";
  const match = /^(velora-[a-z0-9-]+)\/SKILL\.md$/.exec(rel);
  return match ? match[1] : undefined;
}
// ---- Any-site mode: managed studio workspace (outside the user's project) ----
/** Per-user cache root: VELORA_CACHE_DIR, else the platform cache directory. */
export function userCacheDir(): string {
  if (process.env.VELORA_CACHE_DIR) return path.resolve(process.env.VELORA_CACHE_DIR);
  const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  if (process.platform === "win32") return process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  if (process.platform === "darwin") return path.join(home, "Library", "Caches");
  return process.env.XDG_CACHE_HOME ?? path.join(home, ".cache");
}
/** The running Velora package root (has dist/library/preview.js); the studio aliases imports to it. */
export function locatePackageRoot(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, "dist", "library", "preview.js")) && existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
async function directoryBytes(dir: string, budget = 200_000): Promise<number> {
  let total = 0, seen = 0;
  const walk = async (current: string): Promise<void> => {
    let handle;
    try { handle = await opendir(current); } catch { return; }
    for await (const entry of handle) {
      if (++seen > budget) return;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) total += (await lstat(child)).size;
    }
  };
  await walk(dir);
  return total;
}
/** Write the managed workspace's files (CLI-owned; rewritten when they differ) and install its pinned dependencies once. */
export async function provisionStudioWorkspace(version: string, files: Record<string, string>): Promise<{ dir: string; installed: boolean; bytes: number }> {
  const dir = path.join(userCacheDir(), "velora", `studio-${version.replace(/[^0-9A-Za-z.-]/g, "_")}`);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    const current = await readFile(file, "utf8").catch(() => undefined);
    if (current !== content) await writeFile(file, content, "utf8");
  }
  let installed = false;
  if (!existsSync(path.join(dir, "node_modules", "vite", "package.json")) || !existsSync(path.join(dir, "node_modules", "react-dom", "package.json"))) {
    await run(dir, process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], 10 * 60_000);
    installed = true;
  }
  return { dir, installed, bytes: await directoryBytes(path.join(dir, "node_modules")) };
}
/** Per-project run config read by the workspace's vite.config.mjs (VELORA_STUDIO_CONFIG). */
export async function writeStudioRunConfig(workspace: string, projectId: string, text: string): Promise<string> {
  const file = path.join(workspace, "runs", `${projectId.replace(/[^0-9a-f-]/gi, "")}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
  return file;
}
export type SiteProbe = { reachable: boolean; status?: number; location?: string; frameHeaders: string[] };
/** One request to the target site without following redirects (the proxy must stay on loopback). */
export async function probeSite(url: string, timeoutMs = 5000): Promise<SiteProbe> {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    const frameHeaders: string[] = [];
    if (response.headers.get("x-frame-options")) frameHeaders.push(`X-Frame-Options: ${response.headers.get("x-frame-options")}`);
    if (/frame-ancestors/i.test(response.headers.get("content-security-policy") ?? "")) frameHeaders.push("Content-Security-Policy: frame-ancestors");
    return { reachable: true, status: response.status, ...(response.headers.get("location") ? { location: response.headers.get("location")! } : {}), frameHeaders };
  } catch {
    return { reachable: false, frameHeaders: [] };
  }
}
export type StudioServer = { origin: string; closed: Promise<number | null>; stop: () => Promise<void>; log: () => string };
/** Start the workspace's Vite on loopback and resolve once its studio base answers (or reject with its log). */
export async function startStudioServer(workspace: string, configFile: string, port: number, timeoutMs = 90_000): Promise<StudioServer> {
  const vite = path.join(workspace, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [vite, "--config", path.join(workspace, "vite.config.mjs")], {
    cwd: workspace, shell: false, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VELORA_STUDIO_CONFIG: configFile },
  });
  let output = "";
  child.stdout?.on("data", chunk => { output = (output + chunk.toString()).slice(-20_000); });
  child.stderr?.on("data", chunk => { output = (output + chunk.toString()).slice(-20_000); });
  const closed = new Promise<number | null>(resolve => child.once("exit", code => resolve(code)));
  const origin = `http://127.0.0.1:${port}`;
  const stop = async () => { if (child.exitCode === null) { child.kill(); await Promise.race([closed, pause(5000)]); } };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw fault("ERR_STUDIO_FAILED", `The studio server exited: ${output.slice(-1200)}`);
    try {
      const response = await fetch(`${origin}/__velora/`, { signal: AbortSignal.timeout(3000) });
      await response.body?.cancel();
      if (response.ok) return { origin, closed, stop, log: () => output };
    } catch { /* not listening yet */ }
    await pause(300);
  }
  await stop();
  throw fault("ERR_STUDIO_FAILED", `The studio server did not answer within ${timeoutMs / 1000}s: ${output.slice(-1200)}`);
}
