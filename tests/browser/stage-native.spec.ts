import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { executeEditCommand } from "../../src/project/edit";
import { sceneFile, withStageProject } from "./stage-fixture";

test.use({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });

test("records the native viewport with one undo or copies an exact command", async ({ page }) => {
  test.setTimeout(90_000);
  await withStageProject(async ({ root, url }) => {
    const scene = path.join(root, sceneFile);
    const original = await readFile(scene, "utf8");
    const href = `${url}/__velora/?velora-preview=1&velora-scene=home-hero`;
    await page.goto(href);
    await expect(page.getByText("Your laptop: 1512 × 982 @2×")).toBeVisible();
    await page.getByRole("button", { name: "Use as stage" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npx velora edit stage --scene home-hero --preset user-native --size 1512x982@2 --write");
    await page.goto(href + "&velora-capture=1");
    await expect(page.locator("[data-velora-app-stage]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use as stage" })).toHaveCount(0);
    const bridge = await executeEditCommand("bridge", { scene: "home-hero", url, launch: false }, { root });
    if (!bridge.success) throw new Error(JSON.stringify(bridge.issues));
    try {
      await page.goto(String(bridge.data.url));
      await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
      await page.getByRole("button", { name: "Use as stage" }).click();
      await expect.poll(async () => JSON.parse(await readFile(scene, "utf8")).definition.stage).toMatchObject({
        preset: "user-native", width: 1512, height: 982, dpr: 2,
        detected: { innerWidth: 1512, innerHeight: 982, devicePixelRatio: 2, basis: "window" },
      });
      await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect.poll(() => readFile(scene, "utf8")).toBe(original);
    } finally { await bridge.server!.stop(); }
  });
});
