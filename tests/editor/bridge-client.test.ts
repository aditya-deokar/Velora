import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startSceneBridge } from "../../src/project/edit";
import { createBridgeClient, parseBridgeFragment } from "../../src/editor/bridge";
import { createEditorStore } from "../../src/editor/store";

// The editor's bridge client against the real in-process bridge (Phase 03).
const ORIGIN = "http://127.0.0.1:5173";
const recipe = '{\n  "version": 1,\n  "id": "demo",\n  "title": "Demo",\n  "definition": {\n    "scene": { "nodes": [] },\n    "motion": { "durationMs": 1000, "speed": 1, "tracks": [] }\n  }\n}\n';
let root: string, bridge: Awaited<ReturnType<typeof startSceneBridge>>;
// Node's fetch does not add Origin; a browser does. Add it as the studio page would.
const browserFetch: typeof fetch = (input, init = {}) => fetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), origin: ORIGIN } });
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-client-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  await writeFile(path.join(root, "src/velora/scenes/demo.scene.json"), recipe);
  bridge = await startSceneBridge(root, { origin: ORIGIN, readOnly: false, version: "test" });
});
afterEach(async () => { await bridge.server.stop(); await rm(root, { recursive: true, force: true }); });
const op = (atMs: number, value: number) => ({ op: "key.set" as const, track: { target: { kind: "camera" as const }, property: "z" }, atMs, value });
describe("bridge client", () => {
  it("parses only well-formed fragments", () => {
    expect(parseBridgeFragment("#velora-bridge=4567.abcdefghijklmnopqrstu")).toEqual({ port: 4567, token: "abcdefghijklmnopqrstu" });
    for (const bad of ["", "#velora-bridge=0.abcdefghijklmnopqrstu", "#velora-bridge=4567.short", "#other=1"]) expect(parseBridgeFragment(bad)).toBeUndefined();
  });
  it("reads, writes through a serialized queue and handles 409 and 422", async () => {
    const client = createBridgeClient({ port: bridge.server.port, token: bridge.token }, browserFetch);
    expect((await client.hello()).capabilities).toContain("edits");
    const read = await client.readScene("demo");
    const writes: string[] = [];
    const writer = client.writer("demo");
    const store = createEditorStore({ sceneId: "demo", base: read.doc, sha: read.sha, readOnly: false, writer: async (...args) => { writes.push(args[2]); return writer(...args); }, schedule: () => undefined });
    store.commit([op(100, 1)]); store.commit([op(200, 2)]); store.commit([op(300, 3)]);
    await new Promise<void>(resolve => { const off = store.subscribe(() => { if (store.getState().save === "saved") { off(); resolve(); } }); });
    expect(writes).toHaveLength(3);
    expect(JSON.parse(await readFile(path.join(root, "src/velora/scenes/demo.scene.json"), "utf8")).definition.motion.tracks[0].keyframes).toHaveLength(3);
    // A stale base gets the current text back (409); invalid ops are refused (422).
    expect((await writer(read.sha, [op(400, 4)], "stale")).status).toBe("conflict");
    expect((await writer(store.getState().sha!, [op(9999, 1)], "invalid")).status).toBe("invalid");
  });
});
describe("bridge presets (v2.1 Phase 07.6)", () => {
  it("lists, creates with CAS, reads and updates presets; refuses invalid ones", async () => {
    const client = createBridgeClient({ port: bridge.server.port, token: bridge.token }, browserFetch);
    expect((await client.hello()).capabilities).toContain("presets");
    expect(await client.listPresets()).toEqual([]);
    const preset = { version: 1, id: "lift", title: "Lift", kind: "motion", body: { values: "relative", tracks: [{ target: { kind: "surface", id: "$target" }, property: "y", keyframes: [{ timeMs: 0, value: 20 }, { timeMs: 500, value: 0 }] }] } };
    const created = await client.writePreset(preset, null);
    expect(created.status).toBe("ok");
    expect((await client.writePreset(preset, null)).status).toBe("conflict");
    const read = await client.readPreset("lift");
    expect(read.sha).toBe(created.status === "ok" ? created.sha : "");
    expect((await client.writePreset({ ...preset, title: "Lift 2" }, read.sha)).status).toBe("ok");
    expect((await client.listPresets())[0]).toMatchObject({ id: "lift", title: "Lift 2", kind: "motion" });
    const invalid = await client.writePreset({ ...preset, id: "bad", body: { values: "relative", tracks: [{ target: { kind: "surface", id: "card" }, property: "y", keyframes: [{ timeMs: 0, value: 0 }] }] } }, null);
    expect(invalid.status).toBe("invalid");
  });
});
