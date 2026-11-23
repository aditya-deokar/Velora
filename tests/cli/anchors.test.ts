import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../../src/cli";
import { AnchorsResultSchema, CliEnvelopeSchema } from "../../src/core";
import { executeAnchorsCommand } from "../../src/project/commands";

it("validates the machine-readable inventory through the read-only command", async () => {
  const sample = { sceneId: "home-hero", timeMs: 400, anchors: [{
    target: { surface: "subject", anchor: "revenue-card" }, rect: { x: 100, y: 80, width: 60, height: 54 },
    projected: { x: 110, y: 96, width: 60, height: 54 }, elevation: 48, baseElevation: 0, depth: 3000, blur: 0, visible: true,
  }] };
  const read = vi.fn(async () => sample);
  const result = await executeAnchorsCommand({ scene: "home-hero", url: "http://127.0.0.1:5173", time: 400 }, { root: "/project" }, read);
  expect(read).toHaveBeenCalledWith("/project", "home-hero", "http://127.0.0.1:5173", 400);
  const envelope = CliEnvelopeSchema.parse(result);
  expect(envelope.success && AnchorsResultSchema.parse(envelope.data)).toEqual(sample);
  const invalid = await runCli(["anchors", "--scene", "home-hero", "--time", "-1", "--json"], { root: "/project" });
  expect(invalid.code).toBe(2);
  expect(CliEnvelopeSchema.parse(JSON.parse(invalid.stderr)).success).toBe(false);
});

it("authors all requested locks as one reversible edit and leaves the dry run on disk untouched", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "velora-lock-"));
  try {
    const relative = "src/velora/scenes";
    const directory = path.join(root, relative);
    const file = path.join(directory, "demo.scene.json");
    await mkdir(directory, { recursive: true });
    const original = JSON.stringify({ version: 1, id: "demo", title: "Demo", definition: { scene: { nodes: [{ id: "subject" }] }, motion: { durationMs: 400, tracks: [] } } }, null, 2) + "\n";
    await writeFile(file, original);
    const args = ["edit", "lock", "--scene", "demo", "--look-at", "subject:revenue-card", "--focus-follow", "subject:css(#revenue)", "--frame", "subject:revenue-card", "--fill", ".6", "--weight", ".9", "--json"];
    const dry = await runCli(args, { root });
    expect(dry.code, dry.stderr).toBe(0);
    expect(await readFile(file, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual(["demo.scene.json"]);
    const saved = await runCli([...args, "--write"], { root });
    expect(saved.code, saved.stderr).toBe(0);
    expect(JSON.parse(await readFile(file, "utf8")).definition.scene.constraints).toEqual([
      { kind: "lookAt", target: { surface: "subject", anchor: "revenue-card" }, weight: 0.9 },
      { kind: "focusFollow", target: { surface: "subject", selector: "#revenue" }, weight: 0.9 },
      { kind: "frame", target: { surface: "subject", anchor: "revenue-card" }, fill: 0.6, weight: 0.9 },
    ]);
    const restored = await runCli(["edit", "apply", "--scene", "demo", "--ops", "-", "--write", "--json"], { root, readStdin: async () => JSON.stringify(JSON.parse(saved.stdout).data.inverse) });
    expect(restored.code, restored.stderr).toBe(0);
    expect(await readFile(file, "utf8")).toBe(original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
