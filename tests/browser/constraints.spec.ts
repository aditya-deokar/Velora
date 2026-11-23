import { test, expect } from "@playwright/test";

// v2.1 Phase 02: a camera orbits a portrait Surface (orbit rig + lookAt + focusFollow). In every
// captured frame the subject stays at frame center and its focus blur stays below 0.5 px.
test("orbit rig with follow focus keeps the subject centered and sharp", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 400 });
  for (const t of [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000]) {
    await page.goto(`/tests/fixtures/constraints.html?t=${t}`);
    await expect(page.locator("[data-velora-scene]")).toHaveAttribute("data-velora-valid", "true");
    const blur = Number(await page.locator('[data-velora-id="subject"]').getAttribute("data-velora-blur"));
    expect(blur, `blur at ${t}ms`).toBeLessThan(0.5);
    const shot = await page.screenshot();
    const center = await page.evaluate(async data => {
      const img = new Image(); img.src = data; await img.decode();
      const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
      const context = canvas.getContext("2d")!; context.drawImage(img, 0, 0);
      const p = context.getImageData(0, 0, img.width, img.height).data;
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (p[i + 1] > 150 && p[i] < 80 && p[i + 2] < 80) { sx += x; sy += y; n++; }
      }
      return { x: sx / n, y: sy / n, n };
    }, "data:image/png;base64," + shot.toString("base64"));
    expect(center.n).toBeGreaterThan(10);
    // The center marker spans pixels 397..402, so its centroid sits at 399.5 when the anchor is exact.
    expect(Math.abs(center.x - 399.5), `x at ${t}ms`).toBeLessThan(1);
    expect(Math.abs(center.y - 199.5), `y at ${t}ms`).toBeLessThan(1);
  }
});
