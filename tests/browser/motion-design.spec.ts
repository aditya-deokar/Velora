import { expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startSceneBridge } from "../../src/project/edit";

const layers = [...Array.from({ length: 5 }, (_, index) => ({ id: `card-${index + 1}` })), { id: "portrait" }, { id: "graphics" }];
const track = (id: string, property: string, from: number, to: number, kind = "surface", startMs = 200, endMs = 1000) => ({
  target: { kind, id }, property, keyframes: [{ timeMs: startMs, value: from }, { timeMs: endMs, value: to }],
});
const recipe = (id: string, extra: unknown[] = []) => ({ id, version: 1, title: id, definition: {
  width: 1000, height: 700, scene: { nodes: layers, focus: { maxBlur: 0 } },
  motion: { durationMs: 4000, speed: 1, tracks: [track("card-1", "y", 40, 0),
    track("heading.selector.start", "value", 0, 100, "channel", 0, 4000),
    track("underline.end", "value", 0, 1, "channel", 0, 4000), ...extra] },
} });

let root: string | undefined, bridge: Awaited<ReturnType<typeof startSceneBridge>> | undefined;
const sceneFile = (id = "design") => path.join(root!, "src/velora/scenes", `${id}.scene.json`);
const readScene = async (id = "design") => JSON.parse(await readFile(sceneFile(id), "utf8"));
async function gotoEditor(page: Page, id = "design") {
  await page.goto(`/tests/preview/fixture.html?mode=motion-design&velora-scene=${id}&velora-edit=1#velora-bridge=${bridge!.server.port}.${bridge!.token}`);
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  await expect(page.locator('[data-item="portrait"]')).toBeVisible();
}
async function open(page: Page, extra: unknown[] = []) {
  root = await mkdtemp(path.join(tmpdir(), "velora-motion-design-"));
  await mkdir(path.dirname(sceneFile()), { recursive: true });
  await Promise.all([writeFile(sceneFile(), JSON.stringify(recipe("design", extra))), writeFile(sceneFile("design-other"), JSON.stringify(recipe("design-other")))]);
  bridge = await startSceneBridge(root, { origin: test.info().project.use.baseURL!, readOnly: false, version: "test" });
  await gotoEditor(page);
}
test.afterEach(async () => {
  await bridge?.server.stop();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
  bridge = undefined;
});

const select = (page: Page, id: string, extend = false) => page.locator(`[data-item="${id}"]`).click({ modifiers: extend ? ["Shift"] : [] });
async function command(page: Page, query: string) {
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill(query);
  await palette.getByRole("option").first().click();
}

test("groups, eases and retimes three layers with independent undo", async ({ page }) => {
  await open(page, [track("card-2", "y", 20, 0), track("card-3", "y", 10, 0)]);
  await select(page, "card-1"); await select(page, "card-2", true); await select(page, "card-3", true);
  await page.keyboard.press("Control+g");
  await page.getByRole("combobox", { name: "Clip ease", exact: true }).selectOption("cubic.out");
  const speed = page.getByRole("spinbutton", { name: "Clip speed" });
  await speed.fill("1.5"); await speed.press("Enter");
  await expect.poll(async () => (await readScene()).definition.motion.clips?.[0]).toMatchObject({ startMs: 200, ease: "cubic.out", speed: 1.5, tracks: expect.arrayContaining([expect.objectContaining({ target: { kind: "surface", id: "card-3" } })]) });
  await page.getByRole("button", { name: "Ungroup clip" }).click();
  await expect(page.getByRole("dialog", { name: "Ungroup clips" })).toContainText("Maximum sampled deviation");
  await page.getByRole("button", { name: "Bake and ungroup" }).click();
  await expect.poll(async () => (await readScene()).definition.motion.clips).toEqual([]);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  await expect.poll(async () => (await readScene()).definition.motion.clips?.[0]).toMatchObject({ ease: "cubic.out", speed: 1.5 });
  await undo.click();
  await expect.poll(async () => {
    const clip = (await readScene()).definition.motion.clips?.[0];
    return [clip?.ease, clip?.speed ?? 1];
  }).toEqual(["cubic.out", 1]);
});

test("staggering five cards updates eachMs when the timeline handle is dragged", async ({ page }) => {
  await open(page);
  for (let index = 1; index <= 5; index++) await select(page, `card-${index}`, index > 1);
  await command(page, "stagger.open");
  await page.getByRole("button", { name: "Create stagger" }).click();
  await expect.poll(async () => (await readScene()).definition.motion.clips?.[0]?.stagger.eachMs).toBe(80);
  const handle = page.locator('[data-stagger-handle="stagger"]');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  const lane = (await page.locator(".ve-lanes").boundingBox())!;
  const delta = (lane.width - 24) / 4000 * 4 * 45;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await readScene()).definition.motion.clips[0].stagger.eachMs)).toBeCloseTo(125, 0);
  expect((await readScene()).definition.motion.clips[0].members).toEqual(layers.slice(0, 5).map(layer => layer.id));
});

test("a saved relative preset applies to a layer in another scene", async ({ page }) => {
  await open(page);
  await select(page, "card-1");
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByRole("button", { name: "Save selection as preset" }).click();
  await page.getByLabel("Preset title").fill("Card settle");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply preset Card settle" })).toBeVisible();
  await gotoEditor(page, "design-other");
  await select(page, "card-5");
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByRole("button", { name: "Apply preset Card settle" }).click();
  await expect.poll(async () => (await readScene("design-other")).definition.motion.clips?.[0]).toMatchObject({ source: { preset: "card-settle" }, tracks: [{ target: { kind: "surface", id: "card-5" }, keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 800, value: -40 }] }] });
});

test("editing behavior parameters regenerates the selected clip in one undo step", async ({ page }) => {
  await open(page);
  await select(page, "card-5");
  await page.getByRole("button", { name: "Behaviors", exact: true }).click();
  await page.getByRole("button", { name: "Apply behavior", exact: true }).click();
  await expect.poll(async () => (await readScene()).definition.motion.clips?.[0]?.source?.params?.intensity).toBe("subtle");
  await page.getByRole("button", { name: "Edit behavior parameters" }).click();
  await page.getByRole("dialog", { name: "Edit behavior" }).getByRole("combobox", { name: "Intensity" }).selectOption("dramatic");
  await page.getByRole("button", { name: "Update behavior" }).click();
  await expect.poll(async () => (await readScene()).definition.motion.clips?.map((clip: { source: { params: { intensity: string } } }) => clip.source.params.intensity)).toEqual(["dramatic"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await readScene()).definition.motion.clips?.[0]?.source?.params?.intensity).toBe("subtle");
});

async function seek(page: Page, timeMs: number) {
  await page.waitForFunction(() => "__VELORA_CAPTURE__" in window);
  await page.evaluate(time => (window as unknown as { __VELORA_CAPTURE__: { seek(ms: number): void | Promise<void> } }).__VELORA_CAPTURE__.seek(time), timeMs);
}
async function nativeFrame(page: Page) {
  await page.addStyleTag({ content: '[data-velora-capture="scene"]{position:fixed!important;inset:0 auto auto 0!important;width:1000px!important;height:700px!important;z-index:99999!important}[data-velora-capture="scene"]>div:first-child{left:0!important;top:0!important;transform:none!important}[data-velora-preview-chrome]{visibility:hidden!important}' });
  return page.locator("[data-velora-scene]").screenshot({ animations: "disabled" });
}

test("orbit shows an inline framing verdict and the saved shot renders the same capture frame", async ({ page, context }) => {
  await open(page);
  await select(page, "portrait");
  await page.getByRole("button", { name: "Camera moves", exact: true }).click();
  await page.getByRole("dialog", { name: "Camera moves" }).getByRole("combobox", { name: "Move", exact: true }).selectOption("orbit");
  await expect(page.getByTestId("camera-verdict")).toContainText("In frame");
  await page.getByRole("button", { name: /Apply camera move/ }).click();
  await expect(page.getByTestId("camera-verdict")).toContainText("Applied.");
  await expect.poll(async () => (await readScene()).definition.motion.clips?.[0]?.source?.shot).toBe("orbit");
  await page.getByRole("dialog", { name: "Camera moves" }).getByRole("button", { name: "Close" }).click();
  const capture = await context.newPage();
  const definition = encodeURIComponent(JSON.stringify((await readScene()).definition));
  await capture.goto(`/tests/preview/fixture.html?mode=motion-capture&definition=${definition}`);
  for (const at of [0, 900, 1700]) {
    await Promise.all([seek(page, at), seek(capture, at)]);
    expect((await nativeFrame(page)).equals(await nativeFrame(capture))).toBe(true);
  }
});

test("text reveal and path draw have exact visible pixel endpoints", async ({ page }) => {
  await page.goto("/tests/preview/fixture.html?mode=motion-capture");
  const pixels = async (at: number) => {
    await seek(page, at);
    const image = await nativeFrame(page);
    return page.evaluate(async base64 => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(50, 100, 310, 90).data;
      let white = 0, yellow = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) white++;
        if (data[i] > 240 && data[i + 1] > 170 && data[i + 2] < 50) yellow++;
      }
      return { white, yellow };
    }, image.toString("base64"));
  };
  expect(await pixels(0)).toEqual({ white: 0, yellow: 0 });
  const end = await pixels(4000);
  expect(end.white).toBeGreaterThan(100);
  expect(end.yellow).toBeGreaterThan(1000);
});
