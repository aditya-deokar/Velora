import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startSceneBridge } from "../../src/project/edit";

// v2.1 Phase 05: dope sheet and graph editor gestures land in the recipe as exact EditOps.
const ORIGIN = "http://127.0.0.1:4173";
const recipe = { version: 1, id: "editable", title: "Editable scene", definition: { width: 1400, height: 980, scene: { camera: { perspective: 1800 }, focus: { maxBlur: 0 }, nodes: [{ id: "dashboard" }, { id: "caption" }] },
  motion: { durationMs: 4000, speed: 1, tracks: [{ target: { kind: "surface", id: "caption" }, property: "opacity", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1 }] }] } } };
const original = JSON.stringify(recipe, null, 2) + "\n";
let root: string, bridge: Awaited<ReturnType<typeof startSceneBridge>>;
const file = () => path.join(root, "src/velora/scenes/editable.scene.json");
const disk = async () => JSON.parse(await readFile(file(), "utf8"));
const CELL = (atMs: number) => `[data-cell="|surface|caption|opacity@${atMs}"]`;
test.beforeEach(async ({ page }) => {
  root = await mkdtemp(path.join(tmpdir(), "velora-timeline-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  await writeFile(file(), original);
  bridge = await startSceneBridge(root, { origin: ORIGIN, readOnly: false, version: "test" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/tests/preview/fixture.html?mode=editor&velora-scene=editable&velora-edit=1#velora-bridge=${bridge.server.port}.${bridge.token}`);
  await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
});
test.afterEach(async () => { await bridge.server.stop(); await rm(root, { recursive: true, force: true }); });
async function until(check: () => Promise<boolean>, timeout = 7000) {
  const start = Date.now();
  while (!(await check())) { if (Date.now() - start > timeout) throw new Error("condition not met"); await new Promise(resolve => setTimeout(resolve, 50)); }
}
async function center(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
const frames = (ms: number) => Math.abs(ms * 60 / 1000 - Math.round(ms * 60 / 1000)) < 1e-9;
test("dragging a keyframe snaps it onto the frame grid and writes the exact time", async ({ page }) => {
  const from = await center(page, CELL(1000));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y, { steps: 6 });
  await page.mouse.up();
  await until(async () => (await disk()).definition.motion.tracks[0].keyframes[1].timeMs !== 1000);
  const time = (await disk()).definition.motion.tracks[0].keyframes[1].timeMs;
  expect(time).toBeGreaterThan(1000);
  expect(frames(time)).toBe(true);
});
test("Alt-drag retimes the selection around its opposite edge", async ({ page }) => {
  const first = await center(page, CELL(0)), last = await center(page, CELL(1000));
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift"); await page.mouse.click(last.x, last.y); await page.keyboard.up("Shift");
  await page.keyboard.down("Alt");
  await page.mouse.move(last.x, last.y); await page.mouse.down();
  await page.mouse.move(last.x + (last.x - first.x), last.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await until(async () => (await disk()).definition.motion.tracks[0].keyframes[1].timeMs > 1500);
  const keys = (await disk()).definition.motion.tracks[0].keyframes.map((key: { timeMs: number }) => key.timeMs);
  expect(keys[0]).toBe(0);
  expect(Math.abs(keys[1] - 2000)).toBeLessThan(80);
  expect(frames(keys[1])).toBe(true);
});
test("F9 eases the selection and a graph handle drag writes a cubicBezier", async ({ page }) => {
  await page.locator(CELL(0)).click();
  await page.keyboard.press("F9");
  await until(async () => JSON.stringify((await disk()).definition.motion.tracks[0].keyframes[0].easing) === JSON.stringify({ cubicBezier: [0.333, 0, 0.667, 1] }));
  await page.keyboard.press("g");
  const handle = page.getByRole("slider", { name: /Out handle of opacity/ });
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 60, { steps: 5 });
  await page.mouse.up();
  await until(async () => { const easing = (await disk()).definition.motion.tracks[0].keyframes[0].easing; return easing.cubicBezier && easing.cubicBezier[1] > 0.05; });
  const [x1, y1, x2, y2] = (await disk()).definition.motion.tracks[0].keyframes[0].easing.cubicBezier;
  expect(x1).toBeGreaterThan(0.333); expect(x1).toBeLessThanOrEqual(1);
  expect(y1).toBeGreaterThan(0); expect([x2, y2]).toEqual([0.667, 1]);
});
test("grouping into a clip and dragging its bar writes clip.update", async ({ page }) => {
  await page.locator(".ve-label", { hasText: "opacity" }).click();
  await page.keyboard.press("Control+g");
  await until(async () => (await disk()).definition.motion.clips?.length === 1);
  const bar = await center(page, '[data-clip="group-1"] rect >> nth=0');
  await page.mouse.move(bar.x + 20, bar.y); await page.mouse.down();
  await page.mouse.move(bar.x + 120, bar.y, { steps: 6 }); await page.mouse.up();
  await until(async () => ((await disk()).definition.motion.clips[0].startMs ?? 0) > 0);
  const clip = (await disk()).definition.motion.clips[0];
  expect(frames(clip.startMs)).toBe(true);
  expect(clip.tracks[0].property).toBe("opacity");
});
test("a keyframe can be edited with the keyboard only", async ({ page }) => {
  await page.locator(CELL(1000)).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(CELL(0))).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /Edit opacity keyframe/ });
  await dialog.getByLabel("Value").fill("0.5");
  await dialog.getByLabel("Value").press("Enter");
  await until(async () => (await disk()).definition.motion.tracks[0].keyframes[1].value === 0.5);
  await page.locator(CELL(1000)).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await until(async () => Math.abs((await disk()).definition.motion.tracks[0].keyframes[1].timeMs - 1000 - 1000 / 60) < 1e-6);
});
