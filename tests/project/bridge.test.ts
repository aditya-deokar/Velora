import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { startSceneBridge, editorUrl } from "../../src/project/edit";
import { startEditBridge } from "../../src/project/services/bridge";

// v2.1 Phase 03.4: the loopback edit bridge (protocol v1) and its security model.
const ORIGIN = "http://127.0.0.1:5173";
const recipe = '{\n  "version": 1,\n  "id": "demo",\n  "title": "Demo",\n  "definition": {\n    "scene": { "nodes": [] },\n    "motion": { "durationMs": 1000, "speed": 1, "tracks": [] }\n  }\n}\n';
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
function call(port: number, method: string, pathname: string, options: { token?: string; origin?: string | null; host?: string; body?: string; type?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: options.host ?? `127.0.0.1:${port}` };
    if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) { headers["content-type"] = options.type ?? "application/json"; headers["content-length"] = String(Buffer.byteLength(options.body)); }
    const req = request({ host: "127.0.0.1", port, method, path: pathname, headers }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}
let root: string, bridge: Awaited<ReturnType<typeof startSceneBridge>>, logs: Record<string, unknown>[];
const scene = () => path.join(root, "src/velora/scenes/demo.scene.json");
async function start(readOnly = false) {
  logs = [];
  bridge = await startSceneBridge(root, { origin: ORIGIN, readOnly, version: "test", log: entry => logs.push(entry) });
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-bridge-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  await writeFile(scene(), recipe);
});
afterEach(async () => { await bridge?.server.stop(); await rm(root, { recursive: true, force: true }); });
const keyOp = { op: "key.set", track: { target: { kind: "camera" }, property: "z" }, atMs: 500, value: 120 };

describe("edit bridge protocol", () => {
  it("answers hello, read, edit and conflict round trips", async () => {
    await start();
    const { port } = bridge.server, token = bridge.token;
    expect(JSON.parse((await call(port, "GET", "/v1/hello", { token })).body)).toMatchObject({ protocol: 1, readOnly: false, capabilities: ["scenes", "edits", "events"] });
    const read = await call(port, "GET", "/v1/scenes/demo", { token });
    expect(read.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(JSON.parse(read.body)).toMatchObject({ text: recipe, sha256: sha(recipe) });
    const edit = await call(port, "POST", "/v1/scenes/demo/edits", { token, body: JSON.stringify({ baseSha: sha(recipe), ops: [keyOp], label: "drag" }) });
    expect(edit.status, edit.body).toBe(200);
    const written = await readFile(scene(), "utf8");
    expect(JSON.parse(edit.body).sha).toBe(sha(written));
    expect(logs.find(entry => entry.event === "write")).toMatchObject({ path: "src/velora/scenes/demo.scene.json", before: sha(recipe), after: sha(written), labels: ["Set camera z keyframe at 0.50 s to 120"] });
    expect(JSON.stringify(logs)).not.toContain(bridge.token);
    // A stale base gets 409 with the current text; undo through the inverse restores the bytes.
    const stale = await call(port, "POST", "/v1/scenes/demo/edits", { token, body: JSON.stringify({ baseSha: sha(recipe), ops: [keyOp] }) });
    expect(stale.status).toBe(409);
    expect(JSON.parse(stale.body)).toMatchObject({ sha: sha(written), text: written });
    const undo = await call(port, "POST", "/v1/scenes/demo/edits", { token, body: JSON.stringify({ baseSha: sha(written), ops: JSON.parse(edit.body).inverse }) });
    expect(undo.status).toBe(200);
    expect(await readFile(scene(), "utf8")).toBe(recipe);
    const invalid = await call(port, "POST", "/v1/scenes/demo/edits", { token, body: JSON.stringify({ baseSha: sha(recipe), ops: [{ op: "key.set", track: keyOp.track, atMs: 5000, value: 1 }] }) });
    expect(invalid.status).toBe(422);
    expect((await call(port, "GET", "/v1/scenes/missing", { token })).status).toBe(404);
  });
  it("streams file-changed events for external writes (including atomic renames)", async () => {
    await start();
    const events: string[] = [];
    const { port } = bridge.server;
    await new Promise<void>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/v1/events", headers: { host: `127.0.0.1:${port}`, origin: ORIGIN, authorization: `Bearer ${bridge.token}` } }, res => {
        res.setEncoding("utf8");
        res.on("data", chunk => {
          events.push(chunk);
          if (String(chunk).includes("ready")) void writeFile(scene(), recipe.replace('"Demo"', '"Changed"'));
          if (events.join("").includes("file-changed")) { req.destroy(); resolve(); }
        });
      });
      req.on("error", error => { if (!events.join("").includes("file-changed")) reject(error); });
      req.end();
      setTimeout(() => reject(new Error("no file-changed event")), 5000);
    });
    const changed = recipe.replace('"Demo"', '"Changed"');
    expect(events.join("")).toContain(`"path":"src/velora/scenes/demo.scene.json","sha":"${sha(changed)}"`);
  });
});
describe("edit bridge security", () => {
  it("requires the bearer token (missing or wrong)", async () => {
    await start();
    expect((await call(bridge.server.port, "GET", "/v1/hello")).status).toBe(401);
    expect((await call(bridge.server.port, "GET", "/v1/hello", { token: "x".repeat(43) })).status).toBe(401);
    expect((await call(bridge.server.port, "GET", `/v1/hello?token=${bridge.token}`, { token: bridge.token })).status).toBe(400);
  });
  it("rejects foreign or missing origins without CORS headers and answers preflight only for the allowed one", async () => {
    await start();
    for (const origin of ["http://evil.example", "http://127.0.0.1:9999", null]) {
      const reply = await call(bridge.server.port, "GET", "/v1/hello", { token: bridge.token, origin });
      expect(reply.status).toBe(403);
      expect(reply.headers["access-control-allow-origin"]).toBeUndefined();
    }
    const preflight = await call(bridge.server.port, "OPTIONS", "/v1/scenes/demo/edits");
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(preflight.headers["access-control-allow-headers"]).toContain("authorization");
    expect((await call(bridge.server.port, "OPTIONS", "/v1/hello", { origin: "http://evil.example" })).headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("rejects a foreign Host (DNS rebinding)", async () => {
    await start();
    expect((await call(bridge.server.port, "GET", "/v1/hello", { token: bridge.token, host: "evil.example" })).status).toBe(421);
    expect((await call(bridge.server.port, "GET", "/v1/hello", { token: bridge.token, host: `localhost:${bridge.server.port}` })).status).toBe(200);
  });
  it("bounds bodies, op counts and content types", async () => {
    await start();
    const big = JSON.stringify({ baseSha: sha(recipe), ops: [], pad: "x".repeat(1_100_000) });
    expect((await call(bridge.server.port, "POST", "/v1/scenes/demo/edits", { token: bridge.token, body: big }).catch(() => ({ status: 413 }))).status).toBe(413);
    const many = JSON.stringify({ baseSha: sha(recipe), ops: Array.from({ length: 2001 }, () => keyOp) });
    expect((await call(bridge.server.port, "POST", "/v1/scenes/demo/edits", { token: bridge.token, body: many })).status).toBe(413);
    expect((await call(bridge.server.port, "POST", "/v1/scenes/demo/edits", { token: bridge.token, body: "{}", type: "text/plain" })).status).toBe(415);
    expect(await readFile(scene(), "utf8")).toBe(recipe);
  });
  it("refuses traversal, symlinked scene files and writes in read-only mode", async () => {
    await start();
    for (const pathname of ["/v1/scenes/..%2F..%2Fpackage.json", "/v1/scenes/../package.json", "/v1/scenes/Demo"])
      expect((await call(bridge.server.port, "GET", pathname, { token: bridge.token })).status).toBe(404);
    const outside = path.join(root, "outside.json");
    await writeFile(outside, recipe.replace('"demo"', '"linked"'));
    let linked = true;
    await symlink(outside, path.join(root, "src/velora/scenes/linked.scene.json")).catch(() => { linked = false; });
    if (linked) expect((await call(bridge.server.port, "GET", "/v1/scenes/linked", { token: bridge.token })).status).toBe(403);
    await bridge.server.stop();
    await start(true);
    const write = await call(bridge.server.port, "POST", "/v1/scenes/demo/edits", { token: bridge.token, body: JSON.stringify({ baseSha: sha(recipe), ops: [keyOp] }) });
    expect(write.status).toBe(405);
    expect(JSON.parse((await call(bridge.server.port, "GET", "/v1/hello", { token: bridge.token })).body).readOnly).toBe(true);
  });
  it("refuses non-loopback binds and builds editor URLs with the token only in the fragment", async () => {
    for (const host of ["0.0.0.0", "::", "192.168.1.5"])
      await expect(startEditBridge({ host, token: "t".repeat(43), origins: [ORIGIN], readOnly: false, handlers: { hello: () => ({}), readScene: async () => ({ status: 404, body: {} }), applySceneEdits: async () => ({ status: 404, body: {} }) } })).rejects.toMatchObject({ code: "ERR_BRIDGE_HOST" });
    const url = editorUrl("http://127.0.0.1:5173/?velora-preview=1", "demo", 4567, "secret-token");
    expect(url).toBe("http://127.0.0.1:5173/?velora-preview=1&velora-scene=demo&velora-edit=1#velora-bridge=4567.secret-token");
    expect(new URL(url).search).not.toContain("secret-token");
  });
  it("shuts down after the idle timeout with no connected editor", async () => {
    const server = await startEditBridge({ token: "t".repeat(43), origins: [ORIGIN], readOnly: false, idleMs: 200, handlers: { hello: () => ({}), readScene: async () => ({ status: 404, body: {} }), applySceneEdits: async () => ({ status: 404, body: {} }) } });
    await expect(Promise.race([server.closed, new Promise(resolve => setTimeout(() => resolve("timeout"), 3000))])).resolves.toBe(0);
  });
});
