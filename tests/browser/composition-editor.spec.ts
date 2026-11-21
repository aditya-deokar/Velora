import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { runCli } from "../../src/cli";
import { executeEditCommand } from "../../src/project/edit";
import { executeTemplateCommand } from "../../src/project/commands";
import { parsePng } from "../../src/export/compositor";
import { CompositionSchema, frameAt, isOverlapTransition, type Composition } from "../../src/core";
import { audit, loadAudit } from "./audit";

const repository = process.cwd();
const compositionFile = "launch.composition.json";
const put = (root: string, file: string, value: string | Buffer) => writeFile(path.join(root, file), value);
const read = async (root: string) => CompositionSchema.parse(JSON.parse(await readFile(path.join(root, compositionFile), "utf8")));
async function project(run: (root: string, url: string) => Promise<void>, setup: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(repository, ".test-dist", "composition-host-"));
  let dev: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    const projectId = randomUUID();
    await mkdir(path.join(root, ".velora"));
    await mkdir(path.join(root, "__velora"));
    await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
    await put(root, ".velora/project.json", JSON.stringify({ version: 1, projectId, entry: "main.tsx", packageManager: "npm", adapter: "site", site: "http://127.0.0.1:5555" }));
    await put(root, "__velora/index.html", `<!doctype html><meta name="velora-project" content="${projectId}"><div id="root"></div><script type="module" src="/main.tsx"></script>`);
    await put(root, "main.tsx", `import {createRoot} from 'react-dom/client';
      import {ProjectPreview} from '@adityadeokar/velora/preview';
      createRoot(document.querySelector('#root')!).render(<ProjectPreview projectId=${JSON.stringify(projectId)} enabled hot={import.meta.hot}
        sceneModules={import.meta.glob('/src/velora/scenes/*.{scene.json,tsx}')}
        compositionModules={import.meta.glob('/*.composition.json')}
        assetUrls={import.meta.glob('/**/*.{wav,srt}', {query: '?url', import: 'default', eager: true})}/>);`);
    await setup(root);
    dev = await createServer({ root, configFile: false, plugins: [react()], cacheDir: path.join(root, ".vite"),
      resolve: { alias: [
        { find: /^@adityadeokar\/velora$/, replacement: path.join(repository, "src/index.ts") },
        { find: "@adityadeokar/velora/preview", replacement: path.join(repository, "src/preview/index.tsx") },
        { find: "@adityadeokar/velora/kit", replacement: path.join(repository, "src/kit/index.ts") },
      ], dedupe: ["react", "react-dom"] }, server: { host: "127.0.0.1", port: 0, fs: { allow: [repository] } } });
    await dev.listen();
    const address = dev.httpServer!.address() as { port: number };
    await run(root, `http://127.0.0.1:${address.port}`);
  } finally {
    await dev?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
async function edit(page: Page, root: string, url: string, run: () => Promise<void>) {
  const bridge = await executeEditCommand("bridge", { composition: compositionFile, url, launch: false }, { root });
  if (!bridge.success) throw new Error(JSON.stringify(bridge.issues));
  try {
    await page.goto(String(bridge.data.url));
    await saved(page);
    expect(page.url()).not.toContain("velora-bridge");
    await run();
  } finally { await bridge.server!.stop(); }
}
const saved = (page: Page) => expect(page.getByTestId("composition-save-state")).toHaveText("● Saved");
async function drag(page: Page, target: Locator, dx: number, dy = 0) {
  await target.scrollIntoViewIfNeeded();
  const rect = (await target.boundingBox())!;
  const x = rect.x + rect.width / 2, y = rect.y + Math.min(9, rect.height / 2);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 5 }); await page.mouse.up();
}
async function seek(page: Page, ms: number) {
  const time = page.getByRole("slider", { name: "Composition time" });
  await time.evaluate((element: HTMLInputElement, ms) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, String(ms));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, ms);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
const center = (png: Buffer) => {
  const { width, height, pixels } = parsePng(png);
  const offset = 4 * (Math.floor(height / 2) * width + Math.floor(width / 2));
  return [...pixels.subarray(offset, offset + 3)];
};

test("ripple, crossfade, slip, scene breadcrumb and beat-snap undo persist through the real bridge", async ({ page }) => {
  test.setTimeout(120_000);
  const source = { version: 1, id: "launch", title: "Cut test", width: 128, height: 96, fps: 30,
    scenes: ["a", "b", "c"].map((id, index) => ({ id, recipe: id, startMs: 1000 * index, durationMs: 1000 })),
    markers: [{ atMs: 870, kind: "downbeat" }, { atMs: 1460, kind: "beat" }] };
  await project(async (root, url) => edit(page, root, url, async () => {
    const shot = page.locator('[data-cut-clip="a"]');
    await loadAudit(page);
    for (const [name, selector] of [["composition toolbar", ".vc-header"], ["composition inspector", ".vc-inspector"],
      ["composition timeline", ".vc-timeline"]]) await audit(page, selector, name);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
    await shot.getByRole("button", { name: /^Shot a,/ }).click();
    await page.getByRole("button", { name: "Ask agent", exact: true }).click();
    await audit(page, '[aria-label="Ask agent"]', "composition handoff");
    await page.getByLabel("What should the agent change?").fill("Trim the opening cut.");
    await page.getByRole("button", { name: "Copy agent prompt" }).click();
    await expect(page.getByRole("dialog", { name: "Ask agent" }).getByRole("status")).toHaveText("Prompt copied.");
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    for (const text of [compositionFile, "segment a", "0 ms to 1000 ms", "Trim the opening cut.", "--expect-sha"])
      expect(prompt).toContain(text);
    await page.keyboard.press("Escape");
    const width = (await shot.boundingBox())!.width;
    await page.keyboard.press("b");
    await drag(page, page.getByRole("button", { name: "Trim a out", exact: true }), -width / 10);
    await expect.poll(async () => (await read(root)).scenes.map(clip => clip.startMs)).toEqual([0, 900, 1900]);
    await saved(page);
    await page.getByRole("button", { name: "crossfade", exact: true }).dragTo(page.getByRole("button", { name: "Transition into b" }));
    await expect.poll(async () => (await read(root)).scenes[1].transition?.type).toBe("crossfade");
    const cut = (await read(root)).scenes[1];
    // Author a frame-aligned window using the keyboard property field.
    const duration = page.getByRole("spinbutton", { name: "Transition duration (ms)" });
    await duration.fill("400"); await duration.press("Enter");
    await expect.poll(async () => (await read(root)).scenes[1].startMs).toBe(500);
    await saved(page);
    expect(cut.transition?.durationMs).toBeGreaterThan(0);
    for (const [ms, exact] of [[500, true], [700, false], [900, true]] as const) {
      await seek(page, ms);
      const picture = center(await page.locator("[data-velora-player-frame]").screenshot());
      const out = `frame-${ms}.png`;
      const rendered = await runCli(["render", "--composition", compositionFile, "--frame", String(frameAt(ms, 30)), "--out", out, "--url", url, "--no-cache", "--json"], { root });
      expect(rendered.code, rendered.stderr).toBe(0);
      const pixels = center(await readFile(path.join(root, out)));
      if (exact) expect(picture).toEqual(pixels);
      else {
        expect(picture[0]).toBeGreaterThan(90); expect(picture[2]).toBeGreaterThan(90);
        // A 50% CSS blend is 127–128 in sRGB. A 50% linear-light blend encodes as 188.
        expect(Math.max(...pixels.map((value, index) => Math.abs(value - picture[index])))).toBeLessThanOrEqual(61);
      }
    }
    const beforeSlip = (await read(root)).scenes[1];
    await page.keyboard.press("y");
    const target = page.getByRole("button", { name: /^Shot b,/ });
    await drag(page, target, (await target.boundingBox())!.width / 8);
    await expect.poll(async () => (await read(root)).scenes[1].inMs ?? 0).toBeGreaterThan(0);
    const slipped = (await read(root)).scenes[1];
    expect({ ...slipped, inMs: undefined }).toEqual({ ...beforeSlip, inMs: undefined });
    await seek(page, 1000);
    await target.dblclick();
    await expect(page.getByRole("link", { name: "Back to composition" })).toBeVisible();
    expect(Number(new URL(page.url()).searchParams.get("velora-local-time"))).toBeCloseTo(1000 - slipped.startMs + slipped.inMs!, 5);
    await page.getByRole("link", { name: "Back to composition" }).click();
    await saved(page);
    await expect(page.getByRole("slider", { name: "Composition time" })).toHaveValue("1000");
    const original = await readFile(path.join(root, compositionFile), "utf8");
    await page.getByRole("button", { name: "Snap all cuts to beats" }).click();
    await expect(page.getByRole("dialog", { name: "Snap cuts preview" })).toContainText("→");
    await page.getByRole("button", { name: "Apply beat snap" }).click();
    await expect.poll(() => readFile(path.join(root, compositionFile), "utf8")).not.toBe(original);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => readFile(path.join(root, compositionFile), "utf8")).toBe(original);
  }), async root => {
    await put(root, compositionFile, JSON.stringify(source, null, 2) + "\n");
    for (const [id, color] of [["a", "#ff0000"], ["b", "#0000ff"], ["c", "#00ff00"]]) {
      await put(root, `src/velora/scenes/${id}.scene.json`, JSON.stringify({ version: 1, id, title: `Picture ${id}`, definition: {
        width: 128, height: 96, scene: { nodes: [{ id: "plate" }] }, motion: { durationMs: 2000, speed: 1, tracks: [] } } }));
      await put(root, `src/velora/scenes/${id}.tsx`, `import {Surface} from '@adityadeokar/velora';
        export default function Plate(){return <Surface id="plate" style={{position:'absolute',inset:0,width:128,height:96}} content={<div style={{width:128,height:96,background:'${color}'}}/>}/>;}`);
    }
  });
});

function musicBed() {
  const samples = 8000 * 35, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++) bytes.writeInt16LE(Math.round(Math.sin(sample * Math.PI / 10) * 4000), 44 + sample * 2);
  return bytes;
}
test("recuts the 30 second launch blueprint and edits its music bed on the timeline", async ({ page }) => {
  test.setTimeout(90_000);
  await project(async (root, url) => edit(page, root, url, async () => {
    await expect(page.locator("[data-waveform]")).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Captions · karaoke" })).toBeVisible();
    await page.getByRole("button", { name: /^Shot shot-2,/ }).click();
    await page.getByRole("button", { name: "Move later" }).click();
    await expect.poll(async () => (await read(root)).scenes.find(clip => clip.id === "shot-2")!.startMs).toBeGreaterThan(5000);
    const tweaks = [["shot-3", "crossfade"], ["shot-5", "dip-to-white"]];
    for (const [id, type] of tweaks) {
      const handle = page.getByRole("button", { name: `Transition into ${id}` });
      await handle.click(); await page.getByRole("button", { name: "Remove transition" }).click();
      await page.getByRole("button", { name: type, exact: true }).dragTo(handle);
      await expect.poll(async () => (await read(root)).scenes.find(clip => clip.id === id)?.transition?.type).toBe(type);
    }
    await page.getByRole("button", { name: /^Audio music,/ }).click();
    for (const [name, value] of [["Gain", "0.65"], ["Fade in (ms)", "800"], ["Fade out (ms)", "1200"]]) {
      const field = page.getByRole("spinbutton", { name, exact: true });
      await field.fill(value); await field.press("Enter");
    }
    await expect.poll(async () => (await read(root)).audio[0]).toMatchObject({ gain: 0.65, fadeInMs: 800, fadeOutMs: 1200 });
    const before = await read(root);
    const markers = before.scenes.filter(clip => clip.startMs > 0).map(clip => ({ kind: "downbeat", atMs: clip.startMs +
      (clip.transition && isOverlapTransition(clip.transition.type) ? clip.transition.durationMs : 0) - 40 }));
    await writeFile(path.join(root, compositionFile), JSON.stringify({ ...before, markers: [...before.markers, ...markers] }, null, 2));
    await expect(page.getByRole("button", { name: /^downbeat / }).first()).toBeVisible();
    await page.getByRole("button", { name: "Snap all cuts to beats" }).click();
    await page.getByRole("button", { name: "Apply beat snap" }).click();
    await expect.poll(async () => (await read(root)).scenes).not.toEqual(before.scenes);
    const validated = await runCli(["validate", "--composition", compositionFile, "--json"], { root });
    expect(validated.code, validated.stderr).toBe(0);
  }), async root => {
    const created = await executeTemplateCommand("new-video", { id: "launch", blueprint: "launch-film-30s" }, { root });
    expect(created).toMatchObject({ success: true, data: { durationMs: 30000 } });
    const composition: Composition = await read(root);
    await mkdir(path.join(root, "assets"));
    await put(root, "assets/music.wav", musicBed());
    await put(root, compositionFile, JSON.stringify({ ...composition, assets: [{ id: "music", path: "assets/music.wav", type: "audio" }],
      audio: [{ id: "music", assetId: "music", kind: "music", startMs: 0 }] }, null, 2) + "\n");
  });
});
