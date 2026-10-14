import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeFramesRender } from "../../src/export/commands";
import { RenderManifestSchema } from "../../src/core/export";

// No module mocks: gap frames never touch the browser. The dead-loopback URL
// is a tripwire — if the implementation ever opens a session for void frames,
// open-scene fails loudly instead of launching Chromium.
describe("offline gap extraction", () => {
  let root: string;
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it("renders void frames with no server", async () => {
    root = await mkdtemp(path.join(tmpdir(), "velora-offline-"));
    await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
    await writeFile(path.join(root, "src/velora/scenes/demo.scene.json"),
      JSON.stringify({ version: 1, id: "demo", title: "Demo", definition: { width: 64, height: 64, scene: { nodes: [] } } }));
    await writeFile(path.join(root, "src/velora/scenes/demo.tsx"), "export default function Demo() { return null; }");
    await writeFile(path.join(root, "gap.composition.json"), JSON.stringify({
      version: 1, id: "gap", title: "Gap", width: 64, height: 64, fps: 30, seed: 0,
      scenes: [
        { id: "s1", recipe: "demo", startMs: 0, durationMs: 30 },
        { id: "s2", recipe: "demo", startMs: 70, durationMs: 30 },
      ], assets: [],
    }));
    const result = await executeFramesRender(
      { composition: "gap.composition.json", out: "void", at: [40, 50] },
      { root, url: "http://127.0.0.1:1" },
    );
    expect(result).toMatchObject({ success: true, data: { out: "void", total: 2 } });
    expect((await readdir(path.join(root, "void"))).sort()).toEqual(["frame-00001.png", "frame-00002.png", "manifest.json"]);
    const manifest = JSON.parse(await readFile(path.join(root, "void/manifest.json"), "utf8"));
    expect(RenderManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.frames.map((f: { sceneId: string }) => f.sceneId)).toEqual(["black-void", "black-void"]);
  }, 60_000);
});
