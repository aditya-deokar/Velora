import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** SOURCE OF TRUTH: the edit bridge transport (loopback HTTP + event stream) and the project watcher.
 * WHAT: a token-guarded loopback HTTP server for the studio editor (hello, read scene, apply edits, and a
 * streaming text/event-stream of file changes), plus a debounced file watcher for recipe, composition
 * and preset files.
 * WHY: v2.1 Edit mode needs a write boundary that is safe by construction: loopback only, a per-session
 * bearer token compared in constant time, an exact Origin allowlist (no CORS for anyone else), a Host
 * check against DNS rebinding, bounded JSON bodies, read-only mode and an audit log without secrets.
 * WHERE: project/edit.ts owns the policy (which files, validation through core applyEdits, compare-and-
 * swap writes through services.atomicWrite) and passes handlers in; this module only moves bytes.
 */
export const BRIDGE_MAX_BODY_BYTES = 1_000_000;
export const BRIDGE_IDLE_MS = 30 * 60_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
export type BridgeReply = { status: number; body: unknown };
export type BridgeHandlers = {
  hello(): unknown;
  readScene(id: string): Promise<BridgeReply>;
  applySceneEdits(id: string, body: unknown): Promise<BridgeReply>;
  /** Project presets (07.6): list, read and create/update with compare-and-swap. */
  listPresets?(): Promise<BridgeReply>;
  readPreset?(id: string): Promise<BridgeReply>;
  writePreset?(id: string, body: unknown): Promise<BridgeReply>;
  sourceOutline?(input: { file?: string; scene?: string }): Promise<BridgeReply>;
  sourcePreview?(body: unknown): Promise<BridgeReply>;
  sourceApply?(body: unknown): Promise<BridgeReply>;
  sourceUndo?(body: unknown): Promise<BridgeReply>;
};
export type BridgeOptions = {
  host?: string;
  port?: number;
  token: string;
  /** Exact allowed browser origins (the verified dev origin, or the any-site studio origin). */
  origins: string[];
  readOnly: boolean;
  handlers: BridgeHandlers;
  /** JSON-lines audit sink; entries never contain the token. */
  log?: (entry: Record<string, unknown>) => void;
  idleMs?: number;
};
export type BridgeServer = {
  origin: string;
  port: number;
  broadcast(event: string, data: unknown): void;
  stop(): Promise<void>;
  closed: Promise<number | null>;
};
export class BridgeStartError extends Error {
  constructor(readonly code: "ERR_BRIDGE_HOST" | "ERR_BRIDGE_PORT", message: string) { super(message); }
}
/** A 256-bit session token (base64url). */
export function createBridgeToken(): string {
  return randomBytes(32).toString("base64url");
}
// Compare digests so neither length nor content leaks through timing.
function tokenMatches(expected: string, header: string | undefined): boolean {
  const match = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(header ?? "");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(expected), digest(match?.[1] ?? "")) && !!match;
}
export async function startEditBridge(options: BridgeOptions): Promise<BridgeServer> {
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) throw new BridgeStartError("ERR_BRIDGE_HOST", `The edit bridge binds loopback only (127.0.0.1, localhost or ::1), never ${host}.`);
  const origins = new Set(options.origins);
  const clients = new Set<ServerResponse>();
  let lastActivity = Date.now();
  let port = options.port ?? 0;
  const json = (response: ServerResponse, status: number, body: unknown, origin?: string) => {
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
      ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    });
    response.end(JSON.stringify(body));
  };
  const deny = (response: ServerResponse, status: number, message: string) => json(response, status, { error: message });
  const readBody = (request: IncomingMessage) => new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BRIDGE_MAX_BODY_BYTES) { reject(Object.assign(new Error("too large"), { status: 413 })); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    lastActivity = Date.now();
    // DNS-rebinding defense: the Host header must name this loopback port.
    const hostHeader = request.headers.host ?? "";
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(hostHeader)) return deny(response, 421, "Unexpected Host.");
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    if (!origin || !origins.has(origin)) return deny(response, 403, "Origin not allowed.");
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "600",
        "access-control-allow-private-network": "true",
      });
      return response.end();
    }
    if (!tokenMatches(options.token, request.headers.authorization)) return json(response, 401, { error: "Missing or invalid bridge token." }, origin);
    const url = new URL(request.url ?? "/", `http://${hostHeader}`);
    if (request.method === "GET" && url.pathname === "/v1/source/outline" && options.handlers.sourceOutline) {
      if ([...url.searchParams.keys()].some(key => key !== "file" && key !== "scene") || ["file", "scene"].some(key => url.searchParams.getAll(key).length > 1))
        return json(response, 400, { error: "Use one file and/or one scene parameter." }, origin);
      const reply = await options.handlers.sourceOutline({ file: url.searchParams.get("file") ?? undefined, scene: url.searchParams.get("scene") ?? undefined });
      return json(response, reply.status, reply.body, origin);
    }
    if (url.search) return json(response, 400, { error: "Query strings are not accepted." }, origin);
    if (request.method === "POST" && url.pathname.startsWith("/v1/source/")) {
      const action = url.pathname.slice("/v1/source/".length);
      if (action === "open") return json(response, 405, { error: "Use the Open in editor link or copy the source location." }, origin);
      const handler = action === "preview" ? options.handlers.sourcePreview : action === "apply" ? options.handlers.sourceApply : action === "undo" ? options.handlers.sourceUndo : undefined;
      if (!handler) return json(response, 404, { error: "Unknown source endpoint." }, origin);
      if (options.readOnly && action !== "preview") return json(response, 405, { error: "This bridge is read-only." }, origin);
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) return json(response, 415, { error: "Send application/json." }, origin);
      let body: unknown;
      try { body = JSON.parse(await readBody(request)); }
      catch (error) { const large = (error as { status?: number }).status === 413; return json(response, large ? 413 : 400, { error: large ? "Body exceeds 1 MB." : "Body is not JSON." }, origin); }
      const reply = await handler(body);
      return json(response, reply.status, reply.body, origin);
    }
    const scene = /^\/v1\/scenes\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/edits)?$/.exec(url.pathname);
    if (request.method === "GET" && url.pathname === "/v1/hello") return json(response, 200, options.handlers.hello(), origin);
    if (request.method === "GET" && url.pathname === "/v1/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "access-control-allow-origin": origin, vary: "Origin" });
      response.write(`event: ready\ndata: {}\n\n`);
      clients.add(response);
      request.on("close", () => { clients.delete(response); lastActivity = Date.now(); });
      return;
    }
    const preset = /^\/v1\/presets(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?$/.exec(url.pathname);
    if (preset && request.method === "GET" && options.handlers.listPresets && options.handlers.readPreset) {
      const reply = preset[1] ? await options.handlers.readPreset(preset[1]) : await options.handlers.listPresets();
      return json(response, reply.status, reply.body, origin);
    }
    if (preset && preset[1] && request.method === "POST" && options.handlers.writePreset) {
      if (options.readOnly) return json(response, 405, { error: "This bridge is read-only." }, origin);
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) return json(response, 415, { error: "Send application/json." }, origin);
      let body: unknown;
      try { body = JSON.parse(await readBody(request)); }
      catch (error) { return json(response, (error as { status?: number }).status === 413 ? 413 : 400, { error: (error as { status?: number }).status === 413 ? "Body exceeds 1 MB." : "Body is not JSON." }, origin); }
      const reply = await options.handlers.writePreset(preset[1], body);
      return json(response, reply.status, reply.body, origin);
    }
    if (scene && !scene[2] && request.method === "GET") { const reply = await options.handlers.readScene(scene[1]); return json(response, reply.status, reply.body, origin); }
    if (scene && scene[2] && request.method === "POST") {
      if (options.readOnly) return json(response, 405, { error: "This bridge is read-only." }, origin);
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) return json(response, 415, { error: "Send application/json." }, origin);
      let body: unknown;
      try { body = JSON.parse(await readBody(request)); }
      catch (error) {
        return json(response, (error as { status?: number }).status === 413 ? 413 : 400, { error: (error as { status?: number }).status === 413 ? "Body exceeds 1 MB." : "Body is not JSON." }, origin);
      }
      const reply = await options.handlers.applySceneEdits(scene[1], body);
      return json(response, reply.status, reply.body, origin);
    }
    return json(response, 404, { error: "Unknown endpoint." }, origin);
  };
  const server = createServer((request, response) => {
    handle(request, response).catch(error => {
      options.log?.({ event: "error", message: error instanceof Error ? error.message : String(error) });
      if (!response.headersSent) deny(response, 500, "Bridge error."); else response.end();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", error => reject((error as NodeJS.ErrnoException).code === "EADDRINUSE"
      ? new BridgeStartError("ERR_BRIDGE_PORT", `Port ${port} is in use; choose another with --port.`) : error));
    server.listen(port, host, () => resolve());
  });
  port = (server.address() as { port: number }).port;
  let resolveClosed!: (code: number | null) => void;
  const closed = new Promise<number | null>(resolve => { resolveClosed = resolve; });
  const heartbeat = setInterval(() => { for (const client of clients) client.write(": keep-alive\n\n"); }, 25_000);
  const idle = setInterval(() => {
    if (!clients.size && Date.now() - lastActivity > (options.idleMs ?? BRIDGE_IDLE_MS)) { options.log?.({ event: "idle-shutdown" }); void stop(); }
  }, Math.min(30_000, Math.max(50, (options.idleMs ?? BRIDGE_IDLE_MS) / 4)));
  heartbeat.unref(); idle.unref();
  const broadcast = (event: string, data: unknown) => {
    for (const client of clients) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= new Promise<void>(resolve => {
    clearInterval(heartbeat); clearInterval(idle);
    broadcast("bridge-closing", {});
    for (const client of clients) client.end();
    server.close(() => { resolveClosed(0); resolve(); });
    server.closeAllConnections?.();
  });
  const display = host === "::1" ? "[::1]" : host;
  options.log?.({ event: "listening", origin: `http://${display}:${port}`, readOnly: options.readOnly });
  return { origin: `http://${display}:${port}`, port, broadcast, stop, closed };
}

/** Watch recipe, composition and preset files; debounced per file (100 ms), reporting the new SHA-256
 * (null when the file is gone). Atomic rename-writes (one or more events, any order) settle to one report. */
export function watchProjectFiles(root: string, onChange: (change: { path: string; sha: string | null }) => void, debounceMs = 100): { close(): void } {
  const targets: { dir: string; match: RegExp }[] = [
    { dir: "src/velora/scenes", match: /^[a-z0-9]+(?:-[a-z0-9]+)*\.scene\.json$/ },
    { dir: "src/velora/presets", match: /^[a-z0-9]+(?:-[a-z0-9]+)*\.preset\.json$/ },
    { dir: ".", match: /^[a-z0-9][a-z0-9._-]*\.composition\.json$/ },
  ];
  const timers = new Map<string, NodeJS.Timeout>();
  const known = new Map<string, string | null>();
  const watchers: FSWatcher[] = [];
  const report = (relative: string) => {
    clearTimeout(timers.get(relative));
    timers.set(relative, setTimeout(async () => {
      timers.delete(relative);
      let sha: string | null = null;
      try { sha = createHash("sha256").update(await readFile(path.join(root, relative))).digest("hex"); } catch { sha = null; }
      if (known.get(relative) === sha) return;
      known.set(relative, sha);
      onChange({ path: relative, sha });
    }, debounceMs));
  };
  for (const target of targets) {
    try {
      watchers.push(watch(path.join(root, target.dir), { persistent: false }, (_event, filename) => {
        const name = typeof filename === "string" ? filename : filename ? String(filename) : "";
        // Temporary files from atomic writes (<name>.<uuid>.tmp) settle onto the real name.
        const base = name.replace(/\.[0-9a-f-]{36}\.tmp$/, "");
        if (target.match.test(base)) report(target.dir === "." ? base : `${target.dir}/${base}`);
      }));
    } catch { /* a missing directory has nothing to watch */ }
  }
  return { close() { for (const watcher of watchers) watcher.close(); for (const timer of timers.values()) clearTimeout(timer); } };
}
