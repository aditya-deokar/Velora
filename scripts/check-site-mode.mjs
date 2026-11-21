// Any-site mode gate (Phase 09) plus a real-browser `velora deliver` run.
// A non-React static fixture site is filmed through `velora studio`: route scenes from templates, a three-shot
// composition with a crossfade, a rendered MP4 that passes `velora check --video`, and deliverables (og-image,
// readme-gif, website-hero) from the same studio. The project never gets React, Vite or a package.json.
// Requires: npm run build, FFmpeg, Playwright Chromium, npm registry access for the first workspace install
// (cached afterwards in VELORA_CACHE_DIR or the user cache).
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(root, "dist", "cli", "velora.js");
const freePort = () => new Promise((resolve) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const children = [];
function start(args, cwd, ready) {
  const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  children.push(child);
  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${args.join(" ")}:\n${output.slice(-2000)}`)), 10 * 60_000);
    const onData = (chunk) => { output += chunk; if (ready(output)) { clearTimeout(timer); resolve(output); } };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`${args.join(" ")} exited ${code}:\n${output.slice(-2000)}`)); });
  });
}
function velora(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.once("exit", (code) => resolve({ code, stdout, stderr, json: (() => { try { return JSON.parse(stdout.trim().split("\n").pop()); } catch { return undefined; } })() }));
  });
}
const ok = (result, label) => { assert.equal(result.code, 0, `${label} failed:\n${result.stdout.slice(-1500)}\n${result.stderr.slice(-1500)}`); console.log(`PASS ${label}`); return result.json; };

const project = await mkdtemp(path.join(tmpdir(), "velora-site-project-"));
let browser;
try {
  const sitePort = await freePort(), studioPort = await freePort();
  await start([path.join(root, "tests/fixtures/sites/static-multipage/server.mjs"), String(sitePort)], root, (out) => out.includes(`ready ${sitePort}`));
  const site = `http://127.0.0.1:${sitePort}`, studio = `http://127.0.0.1:${studioPort}`;
  ok(await velora(["studio", "init", "--site", site, "--json"], project), "studio init");
  for (const [template, id, route, duration] of [["hero-push", "home", "/", "2000"], ["scroll-through", "tour", "/", "4000"], ["tilt-up-reveal", "pricing", "/pricing", "2000"]])
    ok(await velora(["new", "scene", "--template", template, "--id", id, "--route", route, "--duration", duration, "--json"], project), `new scene ${id} (${template} ${route})`);
  ok(await velora(["new", "scene", "--template", "hero-push", "--id", "depth-demo", "--route", "/pricing", "--json"], project), "new proxied depth scene");
  ok(await velora(["edit", "depth", "--scene", "depth-demo", "--surface", "subject", "--mode", "auto", "--write", "--json"], project), "enable depth on a proxied route");
  await writeFile(path.join(project, "tour.composition.json"), JSON.stringify({
    version: 1, id: "tour", title: "Orbit site tour", width: 960, height: 540, fps: 30,
    scenes: [
      { id: "s1", recipe: "home", startMs: 0, durationMs: 2000 },
      { id: "s2", recipe: "tour", startMs: 1600, durationMs: 4000, transition: { type: "crossfade", durationMs: 400 } },
      { id: "s3", recipe: "pricing", startMs: 5600, durationMs: 2000 },
    ], assets: [],
  }, null, 2));
  ok(await velora(["validate", "--composition", "tour.composition.json", "--json"], project), "validate composition");
  const studioLine = await start([cli, "studio", "--site", site, "--port", String(studioPort), "--json"], project, (out) => out.includes('"command":"studio"'));
  const started = JSON.parse(studioLine.trim().split("\n").find((line) => line.includes('"command":"studio"')));
  assert.equal(started.success, true, studioLine);
  assert.deepEqual(started.data.checks.map((check) => check.pass), [true, true, true]);
  console.log(`PASS studio running at ${started.data.studio} (workspace ${started.data.installed ? "installed" : "cached"})`);
  const proxied = await (await fetch(`${studio}/pricing`)).text();
  assert.ok(proxied.includes("Pricing"), "proxy serves the site's /pricing");
  assert.equal((await fetch(`${studio}/assets/site.css`)).headers.get("content-type"), "text/css");
  console.log("PASS proxy serves routes and absolute assets");
  const resolved = ok(await velora(["depth", "resolve", "--scene", "depth-demo", "--url", studio, "--write", "--json"], project), "resolve depth through the proxy");
  const frozen = resolved.data.ops.find(op => op.op === "depth.resolve" && op.surface === "subject").resolved;
  assert.ok(frozen.layers.some(layer => layer.tier === "card"), "the proxied pricing cards receive depth");
  const depthShot = ok(await velora(["shot", "--scene", "depth-demo", "--time", "0", "--out", "depth.png", "--url", studio, "--json"], project), "capture the proxied depth scene");
  assert.deepEqual(depthShot.data.depth, [{ surface: "subject", hash: frozen.hash }]);
  const bridgeOutput = await start([cli, "edit", "--scene", "home", "--url", studio, "--no-open", "--json"], project,
    out => out.split("\n").some(line => line.includes('"command":"edit"') && line.includes('"url"')));
  const bridge = JSON.parse(bridgeOutput.trim().split("\n").find(line => line.includes('"command":"edit"')));
  assert.equal(bridge.success, true, bridgeOutput);
  browser = await chromium.launch();
  const page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
  await page.goto(bridge.data.url);
  await expect(page.getByRole("button", { name: "Ask agent", exact: true })).toBeVisible({ timeout: 30_000 });
  assert.ok(!page.url().includes("velora-bridge"));
  await page.getByRole("button", { name: "Ask agent", exact: true }).click();
  await page.getByLabel("What should the agent change?").fill("Ease the camera move on the home page.");
  await page.getByRole("button", { name: "Copy agent prompt" }).click();
  await expect(page.getByRole("dialog", { name: "Ask agent" }).getByRole("status")).toHaveText("Prompt copied.");
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /scene "home"/);
  await browser.close();
  browser = undefined;
  console.log("PASS any-site Studio edit bridge and clipboard handoff");
  ok(await velora(["shot", "--scene", "tour", "--time", "2000", "--out", "tour.png", "--url", studio, "--json"], project), "shot through the studio");
  const render = ok(await velora(["render", "--composition", "tour.composition.json", "--out", "tour.mp4", "--url", studio, "--no-stream", "--json"], project), "render three route shots");
  assert.equal(render.data.frames, 228);
  const check = ok(await velora(["check", "--video", "tour.mp4", "--manifest", "tour.manifest.json", "--json"], project), "check --video");
  assert.ok(check.data.checks.every((c) => c.pass), JSON.stringify(check.data.checks));
  const delivered = ok(await velora(["deliver", "--composition", "tour.composition.json", "--targets", "og-image,readme-gif,website-hero", "--quality", "draft", "--url", studio, "--no-stream", "--json"], project), "deliver og-image, readme-gif, website-hero");
  const files = (await readdir(path.join(project, delivered.data.out))).sort();
  for (const name of ["og-image.png", "readme-gif.gif", "hero.webm", "hero.mp4", "hero.poster.jpg", "embed.html", "HeroVideo.tsx", "deliverables.json"]) assert.ok(files.includes(name), `deliverables include ${name}: ${files.join(", ")}`);
  const manifest = JSON.parse(await readFile(path.join(project, delivered.data.manifest), "utf8"));
  assert.ok(manifest.targets.every((target) => target.files.every((file) => file.bytes > 0)));
  assert.ok(!(await readdir(project)).includes("node_modules") && !(await readdir(project)).includes("package.json"), "the site project stays free of React, Vite and npm files");
  console.log("check-site-mode: any-site studio, route render, video check and deliverables all passed.");
} finally {
  await browser?.close();
  for (const child of children) if (child.exitCode === null) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(project, { recursive: true, force: true }).catch(() => {});
}
