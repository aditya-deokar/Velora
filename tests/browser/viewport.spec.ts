import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startSceneBridge } from "../../src/project/edit";
import { applyEdits } from "../../src/core/edit";
import { formatJsonDocument } from "../../src/core/json";

// v2.1 Phase 06: direct manipulation in the viewport lands in the recipe as EditOps.
const ORIGIN = "http://127.0.0.1:4173";
const recipe = (scene: Record<string, unknown> = {}, extra: unknown[] = []) => ({ version: 1, id: "editable", title: "Editable scene", definition: { width: 1400, height: 980,
  scene: { camera: { perspective: 1800 }, focus: { maxBlur: 0 }, nodes: [{ id: "dashboard" }, { id: "caption" }], ...scene },
  motion: { durationMs: 4000, speed: 1, tracks: [{ target: { kind: "surface", id: "caption" }, property: "opacity", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1 }] }, ...extra] } } });
let root: string, bridge: Awaited<ReturnType<typeof startSceneBridge>>;
const file = () => path.join(root, "src/velora/scenes/editable.scene.json");
const disk = async () => JSON.parse(await readFile(file(), "utf8"));
let sent: unknown[][] = [], initial = "";
/** Replays the op batches the editor sent through the same headless path as velora edit apply. */
function replay(): string {
  let text = initial;
  for (const ops of sent) { const result = applyEdits(JSON.parse(text), ops); if (!result.ok) throw new Error(JSON.stringify(result.issues)); text = formatJsonDocument(text, result.recipe); }
  return text;
}
async function open(page: Page, scene?: Record<string, unknown>, extra?: unknown[]) {
  sent = [];
  // Accepted writes only (a 409 is retried by the store after a rebase).
  page.on("response", response => { const request = response.request(); if (request.method() === "POST" && request.url().endsWith("/edits") && response.status() === 200) sent.push(request.postDataJSON().ops); });
  root = await mkdtemp(path.join(tmpdir(), "velora-viewport-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  initial = JSON.stringify(recipe(scene, extra), null, 2) + "\n";
  await writeFile(file(), initial);
  bridge = await startSceneBridge(root, { origin: ORIGIN, readOnly: false, version: "test" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/tests/preview/fixture.html?mode=editor&velora-scene=editable&velora-edit=1#velora-bridge=${bridge.server.port}.${bridge.token}`);
  await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
  await expect(page.locator("[data-velora-viewport-overlay]")).toBeVisible();
}
test.afterEach(async () => { await bridge?.server.stop(); if (root) await rm(root, { recursive: true, force: true }); });
async function until(check: () => Promise<boolean>, timeout = 7000) {
  const start = Date.now();
  while (!(await check())) { if (Date.now() - start > timeout) throw new Error("condition not met"); await new Promise(resolve => setTimeout(resolve, 50)); }
}
const leaf = (id: string) => `[data-velora-id="${id}"] > [data-velora-content]`;
async function box(page: Page, selector: string) { return (await page.locator(selector).first().boundingBox())!; }
async function scale(page: Page) { return (await box(page, "[data-velora-viewport-overlay]")).width / 1400; }
const track = (doc: { definition: { motion: { tracks: { target: { id?: string; kind: string }; property: string; keyframes: { value: unknown }[] }[] } } }, id: string, property: string) =>
  doc.definition.motion.tracks.find(entry => entry.target.id === id && entry.property === property);
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps }); await page.mouse.up();
}

test("click selects the layer in the frame and a 100 px drag writes the perspective-correct x", async ({ page }) => {
  await open(page);
  const b = await box(page, leaf("dashboard"));
  const start = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.click(start.x, start.y);
  await expect(page.locator('[data-outline="dashboard"]')).toBeVisible();
  await drag(page, start, { x: start.x + 100, y: start.y });
  await until(async () => !!track(await disk(), "dashboard", "x"));
  const value = track(await disk(), "dashboard", "x")!.keyframes[0].value as number;
  // z = 0 at perspective 1800 projects 1:1 in frame px; the editor frame is contained at `scale`.
  expect(Math.abs(value - 100 / (await scale(page)))).toBeLessThan(0.5);
  // Validation: the viewport's file bytes equal a headless replay of the same ops.
  await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
  expect(await readFile(file(), "utf8")).toBe(replay());
});

test("rotate ring with Shift writes 15° multiples and a pivot drag does not move the layer", async ({ page }) => {
  await open(page);
  const b = await box(page, leaf("dashboard"));
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.press("r");
  const ring = await box(page, '[data-handle="rotateZ"]');
  const center = { x: ring.x + ring.width / 2, y: ring.y + ring.height / 2 }, radius = ring.width / 2 - 2;
  await page.keyboard.down("Shift");
  await page.mouse.move(center.x + radius, center.y); await page.mouse.down();
  for (let k = 1; k <= 10; k++) { const a = (k / 10) * (Math.PI / 5); await page.mouse.move(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a)); }
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await until(async () => !!track(await disk(), "dashboard", "rotateZ"));
  const angle = track(await disk(), "dashboard", "rotateZ")!.keyframes[0].value as number;
  expect(angle).not.toBe(0);
  expect(angle % 15).toBe(0);
  // Pivot: drag the anchor point to a corner; the rotated layer stays where it is.
  await page.keyboard.press("p");
  const before = await box(page, leaf("dashboard"));
  const pivot = await box(page, '[data-handle="pivot"]');
  await drag(page, { x: pivot.x + pivot.width / 2, y: pivot.y + pivot.height / 2 }, { x: pivot.x + pivot.width / 2 - 150, y: pivot.y + pivot.height / 2 - 60 });
  await until(async () => !!track(await disk(), "dashboard", "originX"));
  await page.waitForTimeout(150);
  const after = await box(page, leaf("dashboard"));
  for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(after[key] - before[key])).toBeLessThan(1);
  await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
  expect(await readFile(file(), "utf8")).toBe(replay());
});

test("dolly-zoom keeps the selected subject's projected width within 1%", async ({ page }) => {
  // A plane at z = 0 projects 1:1 under any lens; put the subject at depth so the dolly must compensate.
  await open(page, undefined, [{ target: { kind: "surface", id: "dashboard" }, property: "z", keyframes: [{ timeMs: 0, value: -600 }] }]);
  const b = await box(page, leaf("dashboard"));
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.press("c");
  const before = await box(page, leaf("dashboard"));
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.keyboard.down("Alt"); await page.keyboard.down("Shift");
  for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
  await page.keyboard.up("Shift"); await page.keyboard.up("Alt");
  await until(async () => (await disk()).definition.scene.camera.perspective !== 1800);
  await page.waitForTimeout(200);
  const camera = (await disk()).definition.scene.camera;
  expect(camera.perspective).toBeGreaterThan(1800);
  expect(camera.z).toBeGreaterThan(0); // a longer lens pulls the camera back
  const after = await box(page, leaf("dashboard"));
  expect(Math.abs(after.width / before.width - 1)).toBeLessThan(0.01);
});

test("director view refuses export and dragging the camera gizmo edits the real camera", async ({ page }) => {
  await open(page);
  await page.locator("[data-velora-viewport-overlay]").focus().catch(() => undefined);
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("director-badge")).toBeVisible();
  await expect(page.locator('[data-velora-capture="scene"]')).toHaveAttribute("data-velora-view", "director");
  const refusal = await page.evaluate(() => {
    const bridge = (window as unknown as { __VELORA_CAPTURE__: { seek(ms: number): unknown } }).__VELORA_CAPTURE__;
    try { bridge.seek(0); return "exported"; } catch (error) { return (error as Error).message; }
  });
  expect(refusal).toBe("Return to camera view before exporting.");
  await page.keyboard.press("c");
  const eye = await box(page, "[data-camera-gizmo] circle");
  await drag(page, { x: eye.x + eye.width / 2, y: eye.y + eye.height / 2 }, { x: eye.x + eye.width / 2 + 60, y: eye.y + eye.height / 2 });
  await until(async () => { const camera = (await disk()).definition.scene.camera; return camera.x !== undefined || camera.z !== undefined; });
  const camera = (await disk()).definition.scene.camera;
  expect(Math.abs(camera.x ?? 0) + Math.abs(camera.z ?? 0)).toBeGreaterThan(1);
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("director-badge")).toHaveCount(0);
  await expect(page.locator('[data-velora-capture="scene"]')).not.toHaveAttribute("data-velora-view", "director");
});

test("focus click makes the clicked layer sharp at the playhead", async ({ page }) => {
  await open(page, { focus: { maxBlur: 10, distance: 700, fStop: 1.4 } });
  await until(async () => Number(await page.locator('[data-velora-id="dashboard"]').getAttribute("data-velora-blur")) > 0.5);
  await page.keyboard.press("f");
  const b = await box(page, leaf("dashboard"));
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await until(async () => (await disk()).definition.scene.focus.distance !== 700);
  expect((await disk()).definition.scene.focus.distance).toBeCloseTo(1800, 0);
  await until(async () => Number(await page.locator('[data-velora-id="dashboard"]').getAttribute("data-velora-blur")) < 0.5);
});
