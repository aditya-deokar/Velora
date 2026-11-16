import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { runCli } from "../../src/cli";

// v2.1 Phase 03.3: velora edit (dry run by default, --write once, compare-and-swap, exact undo).
const recipe = `{
  "version": 1,
  "id": "demo",
  "title": "Demo",
  "definition": {
    "scene": { "nodes": [{ "id": "card" }] },
    "motion": {
      "durationMs": 2000,
      "speed": 1,
      "tracks": [
        {
          "target": { "kind": "camera" },
          "property": "z",
          "keyframes": [
            { "timeMs": 0, "value": 0 },
            { "timeMs": 2000, "value": 300 }
          ]
        }
      ]
    }
  }
}
`;
let root: string;
const file = () => path.join(root, "src/velora/scenes/demo.scene.json");
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const run = (args: string[], stdin?: string) => runCli(["edit", ...args, "--project", root], { root, ...(stdin !== undefined ? { readStdin: async () => stdin } : {}) });
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-edit-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  await writeFile(file(), recipe);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("velora edit", () => {
  it("dry-runs by default and writes once with --write", async () => {
    const dry = await run(["key", "--scene", "demo", "--track", "camera.z", "--at", "1200", "--value", "400", "--ease", "cubic.out", "--json"]);
    expect(dry.code, dry.stderr).toBe(0);
    const envelope = JSON.parse(dry.stdout);
    expect(envelope).toMatchObject({ success: true, command: "edit", data: { written: false, sha: sha(recipe), labels: ["Set camera z keyframe at 1.20 s to 400"] } });
    expect(envelope.data.diff).toContain('+            { "timeMs": 1200, "value": 400, "easing": "cubic.out" },');
    expect(await readFile(file(), "utf8")).toBe(recipe);
    const wrote = await run(["key", "--scene", "demo", "--track", "camera.z", "--at", "1200", "--value", "400", "--ease", "cubic.out", "--write", "--json"]);
    const written = JSON.parse(wrote.stdout);
    const text = await readFile(file(), "utf8");
    expect(written.data.written).toBe(true);
    expect(sha(text)).toBe(written.data.nextSha);
    // Exactly one line was added; everything else is byte-identical.
    expect(text.split("\n").length).toBe(recipe.split("\n").length + 1);
    // Undo through the printed inverse restores the file byte for byte.
    await writeFile(path.join(root, "undo.json"), JSON.stringify(written.data.inverse));
    const undo = await run(["apply", "--scene", "demo", "--ops", "undo.json", "--write", "--json"]);
    expect(undo.code, undo.stderr).toBe(0);
    expect(await readFile(file(), "utf8")).toBe(recipe);
  });
  it("fails fast with ERR_EDIT_CONFLICT when --expect-sha is stale", async () => {
    const result = await run(["ease", "--scene", "demo", "--track", "camera.z", "--at", "0", "--ease", "expo.out", "--expect-sha", "0".repeat(64), "--write", "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).issues[0].code).toBe("ERR_EDIT_CONFLICT");
    expect(await readFile(file(), "utf8")).toBe(recipe);
    const ok = await run(["ease", "--scene", "demo", "--track", "camera.z", "--at", "0", "--ease", '{"cubicBezier":[0.33,0,0.67,1]}', "--expect-sha", sha(recipe), "--write", "--json"]);
    expect(ok.code, ok.stderr).toBe(0);
    expect(JSON.parse(await readFile(file(), "utf8")).definition.motion.tracks[0].keyframes[0].easing).toEqual({ cubicBezier: [0.33, 0, 0.67, 1] });
  });
  it("applies batches from a file or stdin and names the failing op", async () => {
    const ops = [{ op: "key.set", track: { target: { kind: "surface", id: "card" }, property: "opacity" }, atMs: 0, value: 0 }, { op: "key.set", track: { target: { kind: "surface", id: "card" }, property: "opacity" }, atMs: 900, value: 1 }];
    const piped = await run(["apply", "--scene", "demo", "--ops", "-", "--json"], JSON.stringify(ops));
    expect(piped.code, piped.stderr).toBe(0);
    expect(JSON.parse(piped.stdout).data.labels).toHaveLength(2);
    const bad = await run(["apply", "--scene", "demo", "--ops", "-", "--json"], JSON.stringify([{ op: "key.move", track: { target: { kind: "camera" }, property: "z" }, fromMs: 5, toMs: 6 }]));
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stderr).issues[0]).toMatchObject({ code: "ERR_EDIT_TARGET", path: "ops.0" });
  });
  it("lists tracks with evaluated values and reports shorthand and usage errors", async () => {
    const ls = await run(["ls", "--scene", "demo", "--at", "1000", "--json"]);
    expect(JSON.parse(ls.stdout).data).toMatchObject({ durationMs: 2000, nodes: ["card"], tracks: [{ track: { target: { kind: "camera" }, property: "z" } }], values: { camera: { z: 150 } } });
    const human = await run(["ls", "--scene", "demo"]);
    expect(human.stdout).toContain("camera.z\t0ms=0  2000ms=300");
    const shorthand = await run(["key", "--scene", "demo", "--track", "camera", "--at", "0", "--value", "1", "--json"]);
    expect(shorthand.code).toBe(1);
    expect(JSON.parse(shorthand.stderr).issues[0].code).toBe("ERR_EDIT_TARGET");
    expect((await run(["key", "--scene", "demo", "--bogus", "--json"])).code).toBe(2);
    expect((await run(["frobnicate", "--json"])).code).toBe(2);
    const missing = await run(["ls", "--scene", "nope", "--json"]);
    expect(JSON.parse(missing.stderr).issues[0].code).toBe("ERR_SCENE_NOT_FOUND");
    const help = await runCli(["edit", "--help"], { root });
    expect(help.stdout).toContain("velora edit apply --scene ID --ops FILE|-");
  });
});

describe("velora edit paste", () => {
  it("applies a studio keyframe clipboard at a time, onto another surface", async () => {
    const clipboard = { type: "application/x-velora-keyframes+json", version: 1, tracks: [{ target: { kind: "surface", id: "headline" }, property: "opacity", keyframes: [{ offsetMs: 0, value: 0 }, { offsetMs: 400, value: 1, easing: "linear" }] }] };
    await writeFile(path.join(root, "copied.json"), JSON.stringify(clipboard));
    const result = await run(["paste", "--scene", "demo", "--from", "copied.json", "--at", "600", "--onto", "card", "--write", "--json"]);
    expect(result.code, result.stderr).toBe(0);
    const track = JSON.parse(await readFile(file(), "utf8")).definition.motion.tracks.find((entry: { property: string }) => entry.property === "opacity");
    expect(track).toEqual({ target: { kind: "surface", id: "card" }, property: "opacity", keyframes: [{ timeMs: 600, value: 0 }, { timeMs: 1000, value: 1, easing: "linear" }] });
    const bad = await run(["paste", "--scene", "demo", "--from", "copied.json", "--at", "0", "--onto", "card", "--json"].map(arg => arg === "copied.json" ? "missing.json" : arg));
    expect(JSON.parse(bad.stderr).issues[0].code).toBe("ERR_EDIT_TARGET");
  });
});
