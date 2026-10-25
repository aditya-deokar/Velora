import { test, expect, type Page } from "@playwright/test";

// Rendered pixels for motion v2: an animated perspective (dolly zoom) and a true clip mask.
async function extent(page: Page, channel: 0 | 1 | 2) {
  const shot = await page.screenshot();
  return page.evaluate(async ({ data, channel }) => {
    const img = new Image();
    img.src = data;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    const pixels = context.getImageData(0, 0, img.width, img.height).data;
    let left = Infinity, right = -Infinity;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        const others = [0, 1, 2].filter(c => c !== channel).map(c => pixels[i + c]);
        if (pixels[i + channel] > 200 && Math.max(...others) < 60) { left = Math.min(left, x); right = Math.max(right, x); }
      }
    return right < left ? 0 : right - left + 1;
  }, { data: "data:image/png;base64," + shot.toString("base64"), channel });
}
async function frame(page: Page, shot: string, t: number) {
  await page.goto(`/tests/fixtures/motion.html?shot=${shot}&t=${t}`);
  await expect(page.locator("[data-velora-scene]")).toHaveAttribute("data-velora-valid", "true");
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 800, height: 400 }); });

test("an animated perspective holds the subject while the background stretches away", async ({ page }) => {
  await frame(page, "dolly", 0);
  const subjectStart = await extent(page, 0), backgroundStart = await extent(page, 2);
  await frame(page, "dolly", 1000);
  const subjectEnd = await extent(page, 0), backgroundEnd = await extent(page, 2);
  expect(Math.abs(subjectEnd - subjectStart)).toBeLessThanOrEqual(2);
  expect(subjectStart).toBeGreaterThan(90);
  // 600 px plane at z -600: scale 3600/4200 ≈ 0.857 at the start, 1200/1800 ≈ 0.667 at the end.
  expect(backgroundStart).toBeGreaterThan(490);
  expect(backgroundEnd).toBeLessThan(backgroundStart - 80);
});

test("a clipRight track reveals the leaf through a true mask", async ({ page }) => {
  await frame(page, "wipe", 0);
  expect(await extent(page, 1)).toBe(0);
  await frame(page, "wipe", 500);
  expect(Math.abs(await extent(page, 1) - 200)).toBeLessThanOrEqual(2);
  await frame(page, "wipe", 1000);
  expect(Math.abs(await extent(page, 1) - 400)).toBeLessThanOrEqual(2);
});
