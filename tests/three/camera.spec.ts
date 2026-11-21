import { expect, test } from "@playwright/test";
import { getFrames, seek } from "./support";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

test("the DOM and WebGL project a shared 3D point to within one pixel", async ({ page }) => {
  await page.goto("/tests/fixtures/three.html");
  for (const time of [0, 1000, 2000]) {
    await seek(page, time);
    const frame = (await getFrames(page)).at(-1)!;
    expect(await page.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBe(640);
    const canvas = (await page.locator("canvas").boundingBox())!;
    const marker = (await page.locator("[data-marker]").boundingBox())!;
    expect(Math.abs(canvas.x + frame.markerX * canvas.width - (marker.x + marker.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(canvas.y + frame.markerY * canvas.height - (marker.y + marker.height / 2))).toBeLessThanOrEqual(1);
  }
});

test("look-at resolves a registered anchor at the requested frame", async ({ page }) => {
  await page.goto("/tests/fixtures/three.html?anchor");
  await expect.poll(async () => (await getFrames(page)).length).toBeGreaterThan(0);
  await seek(page, 1200);
  const effective = await page.locator("[data-velora-stage]").evaluate(stage => getComputedStyle(stage).transform);
  await seek(page, 300);
  expect(await page.locator("[data-velora-stage]").evaluate(stage => getComputedStyle(stage).transform)).not.toBe(effective);
  await seek(page, 1200);
  expect(await page.locator("[data-velora-stage]").evaluate(stage => getComputedStyle(stage).transform)).toBe(effective);
  await expect(page.locator("[data-velora-diagnostics]")).toHaveCount(0);
});
