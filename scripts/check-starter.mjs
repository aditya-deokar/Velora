// Starter smoke (Phase 08.3): velora create -> npm install (packed local tarball) -> npm run velora:setup
// (init, skills, blueprint) -> dev server -> velora doctor -> blueprint frames -> velora check.
// Requires: npm run build, FFmpeg, Playwright Chromium, npm registry access for React and Vite.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { NPM, NPM_SHELL } from "./npm-cmd.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(root, "dist", "cli", "velora.js");
const npm = (cwd, args) => {
  const result = spawnSync(NPM, args, { cwd, encoding: "utf8", ...NPM_SHELL });
  assert.equal(result.status, 0, `npm ${args.join(" ")} failed:\n${(result.stdout ?? "") + (result.stderr ?? "")}`.slice(-3000));
  return result.stdout;
};
const velora = (cwd, args) => {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `velora ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`.slice(-3000));
  console.log(`PASS velora ${args.slice(0, 3).join(" ")}`);
  return JSON.parse(result.stdout.trim().split("\n").pop());
};
const freePort = () => new Promise((resolve) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

const base = await mkdtemp(path.join(tmpdir(), "velora-starter-"));
let dev;
try {
  velora(base, ["create", "my-launch", "--name", "Fieldnote", "--json"]);
  const app = path.join(base, "my-launch");
  const packDir = path.join(base, ".pack");
  await mkdir(packDir);
  const packed = JSON.parse(npm(root, ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir]));
  // One install: the tarball replaces the starter's registry spec, so this also works before a release is published.
  npm(app, ["install", "--no-audit", "--no-fund", "--save-dev", path.join(packDir, packed[0].filename)]);
  console.log("PASS npm install (React, Vite, local Velora tarball)");
  npm(app, ["run", "velora:setup"]);
  console.log("PASS npm run velora:setup (init, skills, blueprint)");
  const composition = JSON.parse(await readFile(path.join(app, "launch.composition.json"), "utf8"));
  assert.ok(composition.scenes.length >= 4, "the blueprint scaffolded its scenes");
  const port = await freePort();
  dev = spawn(process.execPath, [path.join(app, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: app, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 500)); }
  const doctor = velora(app, ["doctor", "--url", url, "--json"]);
  assert.ok(doctor.data.checks.every((check) => check.pass), JSON.stringify(doctor.data.checks));
  velora(app, ["validate", "--composition", "launch.composition.json", "--json"]);
  const at = composition.scenes.slice(0, 3).map((scene) => scene.startMs + Math.round(scene.durationMs / 2)).join(",");
  velora(app, ["frames", "--composition", "launch.composition.json", "--out", "board", "--at", at, "--contact-sheet", "--url", url, "--json"]);
  const check = velora(app, ["check", "--frames", "board", "--json"]);
  assert.ok(check.data.checks.every((item) => item.pass), JSON.stringify(check.data.checks));
  console.log("check-starter: create, install, setup, doctor, blueprint frames and checks all passed.");
} finally {
  dev?.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(base, { recursive: true, force: true }).catch(() => {});
}
