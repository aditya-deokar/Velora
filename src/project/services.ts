import { createRequire } from "node:module";
import { constants, existsSync } from "node:fs";
import { lstat, realpath, open, opendir, mkdir, rename, link, unlink, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
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
export async function readText(root: string, target: string, maxBytes = 2_000_000): Promise<string | undefined> {
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
    return buffer.subarray(0, length).toString("utf8");
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
    const child = spawn(executable, args, { cwd: root, shell: false, stdio: "ignore" });
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
  if (!["react","react-dom","@webprodigies/velora","velora"].includes(name)) throw fault("invalid-input","Unknown runtime dependency.");
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
