import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { editorHandoff, editBatchCommand } from "../../src/editor/handoff";
import { runCli } from "../../src/cli";

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

it("fills the agent prompt with the target, intent, timing, selection, history and revision", () => {
  const prompt = editorHandoff({ target: { composition: "launch cut.composition.json" }, intent: "Leave more room for the headline", timeMs: 1200.5,
    selection: ["segment intro"], range: { startMs: 1000, endMs: 1600 }, history: ["Move earlier", "Set crossfade"], sha: "b".repeat(64) });
  for (const value of ["launch cut.composition.json", "Leave more room for the headline", "1200.5 ms", "segment intro", "1000 ms to 1600 ms",
    "Move earlier | Set crossfade", "b".repeat(64), "velora compose edit", "--expect-sha"]) expect(prompt).toContain(value);
  expect(prompt).not.toContain("<selection>");
});

it("runs the copied command through the native shell and applies its original operations through CLI stdin", async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-handoff-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  const scene = path.join(root, "src/velora/scenes/demo.scene.json");
  await writeFile(scene, JSON.stringify({ version: 1, id: "demo", title: "Demo", definition: { scene: { nodes: [{ id: "hero" }] } } }));
  const composition = "editor's cut.composition.json";
  await writeFile(path.join(root, composition), JSON.stringify({ version: 1, id: "cut", title: "Cut", width: 128, height: 96,
    scenes: [{ id: "first", recipe: "demo", startMs: 0, durationMs: 1000 }] }));
  const capture = path.join(root, "capture.cjs");
  await writeFile(capture, "const fs = require('node:fs'); process.stdout.write(JSON.stringify({args: process.argv.slice(2), stdin: fs.readFileSync(0, 'utf8')}));");
  const run = async (command: ReturnType<typeof editBatchCommand>) => {
    const windows = process.platform === "win32";
    const env = { ...process.env, VELORA_HANDOFF_NODE: process.execPath, VELORA_HANDOFF_CAPTURE: capture };
    const script = windows ? `function npx { $input | & $env:VELORA_HANDOFF_NODE $env:VELORA_HANDOFF_CAPTURE @args }\n${command.powershell}`
      : `npx() { "$VELORA_HANDOFF_NODE" "$VELORA_HANDOFF_CAPTURE" "$@"; }\n${command.posix}`;
    const shell = windows ? "powershell.exe" : "/bin/sh";
    const args = windows ? ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")] : ["-c", script];
    const forwarded = JSON.parse(execFileSync(shell, args, { env, cwd: root, encoding: "utf8" })) as { args: string[]; stdin: string };
    expect(forwarded.args.shift()).toBe("velora");
    const result = await runCli([...forwarded.args, "--json"], { root: root!, readStdin: async () => forwarded.stdin });
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).data.written).toBe(true);
  };
  await run(editBatchCommand({ scene: "demo" }, [{ op: "editor.set", labels: { hero: "Editor's café" } }]));
  expect(JSON.parse(await readFile(scene, "utf8")).editor.labels.hero).toBe("Editor's café");
  await run(editBatchCommand({ composition }, [{ op: "marker.add", atMs: 800, label: "Café’s ‘cue’" }]));
  expect(JSON.parse(await readFile(path.join(root, composition), "utf8")).markers[0].label).toBe("Café’s ‘cue’");
}, 15_000);
