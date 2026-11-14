import { test, expect, type Page } from "@playwright/test";
import { mixColors } from "../../src/core/color";

// Rendered pixels for motion v3 (v2.1 Phase 01): pivot, skew, an animated CSS variable on a host
// component, a grade fade, and DOMMatrix parity of matrixFor with the browser's CSS transform.
type Box = { left: number; right: number; top: number; bottom: number } | null;
async function pixels(page: Page, probe: { x: number; y: number }) {
  const shot = await page.screenshot();
  return page.evaluate(async ({ data, probe }) => {
    const img = new Image();
    img.src = data;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    const p = context.getImageData(0, 0, img.width, img.height).data;
    let box: Box = null;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (p[i] + p[i + 1] + p[i + 2] > 60) box = box ? { left: Math.min(box.left, x), right: Math.max(box.right, x), top: Math.min(box.top, y), bottom: Math.max(box.bottom, y) } : { left: x, right: x, top: y, bottom: y };
      }
    const i = (probe.y * img.width + probe.x) * 4;
    return { box, color: [p[i], p[i + 1], p[i + 2]] };
  }, { data: "data:image/png;base64," + shot.toString("base64"), probe });
}
async function frame(page: Page, kase: string, t: number) {
  await page.goto(`/tests/fixtures/motion-v3.html?case=${kase}&t=${t}`);
  await expect(page.locator("[data-velora-scene]")).toHaveAttribute("data-velora-valid", "true");
}
test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 800, height: 400 }); });

test("a corner pivot rotates the box about its top-left corner", async ({ page }) => {
  await frame(page, "pivot", 1000);
  const { box } = await pixels(page, { x: 250, y: 250 });
  // 200x100 at (300,150) turned 90° about (300,150) covers x 200..300, y 150..350.
  expect(Math.abs(box!.left - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.right - 299)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.top - 150)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.bottom - 349)).toBeLessThanOrEqual(1);
});
test("skewX shears the box in its plane", async ({ page }) => {
  await frame(page, "skew", 0);
  const before = (await pixels(page, { x: 400, y: 200 })).box!;
  await frame(page, "skew", 1000);
  const after = (await pixels(page, { x: 400, y: 200 })).box!;
  expect(before.right - before.left + 1).toBe(200);
  expect(Math.abs(after.right - after.left + 1 - (200 + 100 * Math.tan(Math.PI / 6)))).toBeLessThanOrEqual(2);
  expect(after.bottom - after.top).toBe(before.bottom - before.top);
});
test("an animated --accent drives a host component's background through var(--accent)", async ({ page }) => {
  await frame(page, "accent", 1000);
  expect((await pixels(page, { x: 400, y: 200 })).color).toEqual([255, 0, 0]);
  await frame(page, "accent", 500);
  const expected = mixColors("#000000", "#ff0000", 0.5).match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const actual = (await pixels(page, { x: 400, y: 200 })).color;
  actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(1));
});
test("a grade fade desaturates only the content leaf", async ({ page }) => {
  await frame(page, "grade", 0);
  expect((await pixels(page, { x: 400, y: 200 })).color).toEqual([0, 200, 0]);
  await frame(page, "grade", 1000);
  const [r, g, b] = (await pixels(page, { x: 400, y: 200 })).color;
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2);
  expect(g).toBeLessThan(200);
});
test("matrixFor equals the browser's computed CSS matrix for random transforms (incl. scale3d and skew)", async ({ page }) => {
  await frame(page, "pivot", 0);
  const worst = await page.evaluate(() => {
    const { matrixFor, transformToCss, TransformSchema } = (window as unknown as { velora: { matrixFor: (t: unknown) => number[]; transformToCss: (t: unknown) => string; TransformSchema: { parse: (t: unknown) => unknown } } }).velora;
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const element = document.createElement("div");
    document.body.appendChild(element);
    const worst = { parsed: 0, computed: 0 };
    for (let n = 0; n < 200; n++) {
      const t = { x: random() * 400 - 200, y: random() * 400 - 200, z: random() * 400 - 200, rotateX: random() * 120 - 60, rotateY: random() * 120 - 60, rotateZ: random() * 360 - 180,
        // Uniform scale stays 1: CSS scale(s) is 2D, while matrixFor (pre-v2.1) also scales z. That known
        // divergence is recorded in plan/v2.1/artifacts/phase-01-exit.md and left unchanged (goldens).
        ...(n % 2 ? { scaleX: 0.5 + random(), scaleY: 0.5 + random(), scaleZ: 0.5 + random() } : {}), ...(n % 3 ? { skewX: random() * 120 - 60, skewY: random() * 120 - 60 } : {}) };
      element.style.transform = transformToCss(t);
      // The browser's own double-precision transform-list math, and the computed style it serializes.
      const parsed = new DOMMatrix(transformToCss(t)).toFloat64Array();
      const computed = new DOMMatrix(getComputedStyle(element).transform).toFloat64Array();
      const m = matrixFor(TransformSchema.parse(t));
      // DOMMatrix is column-major; matrixFor is row-major.
      for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
        const scale = Math.max(1, Math.abs(m[row * 4 + col]));
        worst.parsed = Math.max(worst.parsed, Math.abs(parsed[col * 4 + row] - m[row * 4 + col]) / scale);
        worst.computed = Math.max(worst.computed, Math.abs(computed[col * 4 + row] - m[row * 4 + col]) / scale);
      }
    }
    return worst;
  });
  expect(worst.parsed).toBeLessThan(1e-6);
  // getComputedStyle serializes about six significant digits.
  expect(worst.computed).toBeLessThan(1e-5);
});
