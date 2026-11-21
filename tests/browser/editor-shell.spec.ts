import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startSceneBridge } from "../../src/project/edit";
import { applyEdits } from "../../src/core/edit";
import { formatJsonDocument } from "../../src/core/json";

// v2.1 Phase 04 journey: Edit mode on a live scene, saving through a real loopback bridge.
const ORIGIN = "http://127.0.0.1:4173";
const recipe = { version: 1, id: "editable", title: "Editable scene", definition: { width: 1400, height: 980, scene: { camera: { perspective: 1800 }, focus: { maxBlur: 0 }, nodes: [{ id: "dashboard" }, { id: "caption" }] },
  motion: { durationMs: 4000, speed: 1, tracks: [{ target: { kind: "surface", id: "caption" }, property: "opacity", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1 }] }] } } };
const original = JSON.stringify(recipe, null, 2) + "\n";
let root: string, bridge: Awaited<ReturnType<typeof startSceneBridge>>;
const file = () => path.join(root, "src/velora/scenes/editable.scene.json");
test.beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-editor-"));
  await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
  await writeFile(file(), original);
  bridge = await startSceneBridge(root, { origin: ORIGIN, readOnly: false, version: "test" });
});
test.afterEach(async () => { await bridge.server.stop(); await rm(root, { recursive: true, force: true }); });
async function open(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/tests/preview/fixture.html?mode=editor&velora-scene=editable&velora-edit=1#velora-bridge=${bridge.server.port}.${bridge.token}`);
  await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
}
async function until(check: () => Promise<boolean>, timeout = 7000) {
  const start = Date.now();
  while (!(await check())) { if (Date.now() - start > timeout) throw new Error("condition not met"); await new Promise(resolve => setTimeout(resolve, 50)); }
}
test("stopwatch, key at playhead, undo to the original bytes, external edits", async ({ page }) => {
  const started = Date.now();
  await open(page);
  expect(page.url()).not.toContain("velora-bridge");
  await page.locator('[data-item="dashboard"]').click();
  await page.getByRole("button", { name: "Animate x" }).click();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByTestId("editor-timecode")).toContainText("00:00:02:00");
  await page.getByLabel("x value", { exact: true }).fill("120");
  await page.getByLabel("x value", { exact: true }).press("Enter");
  await until(async () => (await readFile(file(), "utf8")).includes('"timeMs": 2000'));
  const timeToFirstKeyframe = Date.now() - started;
  await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
  // The file equals the ops the editor made, written with the formatting-preserving writer.
  const x = { target: { kind: "surface", id: "dashboard" }, property: "x" };
  const first = applyEdits(JSON.parse(original), [{ op: "track.add", track: x, keyframes: [{ timeMs: 0, value: 0 }] }]);
  const second = applyEdits(first.ok ? first.recipe : {}, [{ op: "key.set", track: x, atMs: 2000, value: 120 }]);
  const step1 = formatJsonDocument(original, first.ok ? first.recipe : {});
  expect(await readFile(file(), "utf8")).toBe(formatJsonDocument(step1, second.ok ? second.recipe : {}));
  test.info().annotations.push({ type: "time-to-first-keyframe-ms", description: String(timeToFirstKeyframe) });
  // Undo both edits: the file returns to the original bytes.
  // Leave the text field (clicking empty viewport space would deselect the layer since Phase 06).
  await page.locator('[data-item="dashboard"]').click();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await until(async () => (await readFile(file(), "utf8")) === original);
  await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
  // An external edit (agent or IDE) is adopted; the next editor edit lands on top of it.
  await writeFile(file(), original.replace('"Editable scene"', '"Retitled by an agent"'));
  await page.waitForTimeout(600);
  await page.getByLabel("y value", { exact: true }).fill("10");
  await page.getByLabel("y value", { exact: true }).press("Enter");
  await until(async () => { const text = await readFile(file(), "utf8"); return text.includes("Retitled by an agent") && text.includes('"property": "y"'); });
});
test("the copied export command strips Edit mode and the bridge fragment", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.locator("summary", { hasText: "Export" }).click();
  const command = await page.locator(".velora-export-panel code").textContent();
  expect(command).toContain("velora-scene=editable");
  expect(command).not.toContain("velora-edit");
  expect(command).not.toContain("#");
  expect(command).not.toContain(bridge.token);
});
test("read-only Edit mode keeps edits in memory and offers the command", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/tests/preview/fixture.html?mode=editor&velora-scene=editable&velora-edit=1`);
  await expect(page.getByTestId("editor-save-state")).toHaveText("○ Not saved (no bridge)");
  await page.locator('[data-item="dashboard"]').click();
  await page.getByLabel("x value", { exact: true }).fill("50");
  await page.getByLabel("x value", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Copy as command" })).toBeEnabled();
  expect(await readFile(file(), "utf8")).toBe(original);
});
