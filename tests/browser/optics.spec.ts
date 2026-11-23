import { expect, test, type Locator, type Page } from "@playwright/test";
import { CaptureManifestSchema, FOCUS_BANDS, focusBand, type CaptureBridge } from "../../src/core";
import { openCapture, decodePngDataUrl, sha256Hex } from "../../src/export/services";
import { parsePng } from "../../src/export/compositor";

const width = 640, height = 420, fixture = "/tests/fixtures/depth.html";
test.use({ channel: "chromium", viewport: { width, height } });
const seek = (page: Page, time: number) => page.evaluate(async ms => {
  (window as unknown as { depthFixture: { seek(ms: number): void } }).depthFixture.seek(ms);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}, time);
const layer = (page: Page, index: number) => page.locator(`[data-velora-depth-focus="${index}"]`);
const blur = async (page: Page, index: number) => Number(await layer(page, index).getAttribute("data-velora-blur"));

test("framing hold preserves width while the telephoto reduces off-axis keystone", async ({ page }) => {
  const results = [];
  for (const lens of ["wide", "tele"]) {
    await page.goto(`${fixture}?compression=${lens}`);
    const corners = page.locator("[data-optics-corner]");
    await expect(corners).toHaveCount(4);
    results.push(await corners.evaluateAll(nodes => {
      const points = nodes.map(node => node.getBoundingClientRect());
      const angle = (a: number, b: number) => Math.atan2(points[b].y - points[a].y, points[b].x - points[a].x) * 180 / Math.PI;
      const angleError = Math.max(Math.abs(angle(0, 1) - angle(3, 2)), Math.abs(angle(0, 3) - angle(1, 2)));
      const width = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
      return { width, angleError };
    }));
  }
  const [wide, tele] = results;
  expect(wide.angleError).toBeGreaterThan(3);
  expect(tele.angleError).toBeLessThan(0.3);
  expect(Math.abs(tele.width / wide.width - 1)).toBeLessThan(0.01);
});

async function variance(page: Page, locator: string | Locator) {
  const rect = await (typeof locator === "string" ? page.locator(locator) : locator).boundingBox();
  const clip = { x: Math.round(rect!.x + rect!.width / 2 - 24), y: Math.round(rect!.y + rect!.height / 2 - 4), width: 48, height: 8 };
  const data = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(async source => {
    const img = new Image();
    img.src = `data:image/png;base64,${source}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    const rgba = context.getImageData(0, 0, img.width, img.height).data;
    const values = Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4]);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  }, data);
}

test("the 200 mm rack exchanges sharpness and breathes identically in preview and capture", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto(`${fixture}?rack`);
  await expect(layer(page, 1)).toBeAttached();
  await expect(page.locator("[data-velora-focus-veil]").first()).toBeAttached();
  await seek(page, 0);
  expect(await blur(page, 1)).toBeLessThan(0.5);
  expect(await blur(page, 0)).toBeGreaterThan(1.8);
  await expect(page.locator("#optics-chart")).toHaveCSS("filter", /^blur\(/);
  const startWidth = (await page.locator("#optics-chart").boundingBox())!.width;
  const startChart = await variance(page, "#optics-chart"), startModal = await variance(page, "#optics-modal");
  await seek(page, 1000);
  expect(await blur(page, 0)).toBeLessThan(0.5);
  expect(await blur(page, 1)).toBeGreaterThan(1.8);
  await expect(page.locator("#optics-chart")).toHaveCSS("filter", "none");
  const endWidth = (await page.locator("#optics-chart").boundingBox())!.width;
  expect(endWidth / startWidth).toBeCloseTo(0.982, 3);
  await expect.poll(() => variance(page, "#optics-chart")).toBeGreaterThan(startChart * 1.35);
  await expect.poll(() => variance(page, "#optics-modal")).toBeLessThan(startModal / 1.35);
  // Compare painted frames after the depth controller has settled on both pages.
  await page.waitForFunction(() => typeof (window as Window & { __VELORA_CAPTURE__?: CaptureBridge }).__VELORA_CAPTURE__?.seek === "function");
  await page.evaluate(async () => {
    const bridge = (window as unknown as { __VELORA_CAPTURE__: CaptureBridge }).__VELORA_CAPTURE__;
    await bridge.seek(1000);
  });
  const clip = (await page.locator("#depth-viewport").boundingBox())!;
  const previewPng = await page.screenshot({ clip, animations: "disabled" });
  const expected = parsePng(previewPng);
  const session = await openCapture({ url: new URL(`${fixture}?rack`, baseURL).href, width, height });
  try {
    const manifest = CaptureManifestSchema.parse(await session.manifest(1000));
    expect(manifest.depth?.[0].focus?.[0].blur).toBeLessThan(0.5);
    const frame = await session.snapshot(1000, manifest);
    const capturePng = decodePngDataUrl(frame);
    const actual = parsePng(capturePng);
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    const repeatPng = decodePngDataUrl(await session.snapshot(1000, manifest));
    expect(repeatPng.equals(capturePng), "repeated capture returns the same PNG bytes").toBe(true);
    if (!actual.pixels.equals(expected.pixels)) {
      await testInfo.attach("preview", { body: previewPng, contentType: "image/png" });
      await testInfo.attach("capture", { body: capturePng, contentType: "image/png" });
      let count = 0, maxDelta = 0;
      let left = width, top = height, right = 0, bottom = 0;
      for (let offset = 0; offset < actual.pixels.length; offset += 4) {
        const delta = Math.max(...[0, 1, 2, 3].map(channel => Math.abs(actual.pixels[offset + channel] - expected.pixels[offset + channel])));
        if (!delta) continue;
        const pixel = offset / 4;
        const x = pixel % width, y = Math.floor(pixel / width);
        count++;
        maxDelta = Math.max(maxDelta, delta);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
      expect(sha256Hex(actual.pixels), `${count} differing pixels in (${left}, ${top})–(${right}, ${bottom}), maximum channel delta ${maxDelta}`).toBe(sha256Hex(expected.pixels));
    }
  } finally { await session.close(); }
});

test("the iframe raster mask assigns the sharp and blurred regions to their expected bands", async ({ page }) => {
  await page.goto(`${fixture}?rack&iframe`);
  await expect(page.locator("iframe")).toHaveAttribute("style", /filter:\s*url/);
  await expect(layer(page, 0)).toBeAttached();
  const frame = page.frameLocator("iframe"), variances: number[][] = [];
  for (const time of [0, 1000]) {
    await seek(page, time);
    const values = await page.locator("[data-velora-focus-filters] feImage").evaluate(async image => {
      const decoded = new Image();
      decoded.src = image.getAttribute("href")!;
      await decoded.decode();
      const canvas = document.createElement("canvas");
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(decoded, 0, 0);
      return [205, 444].map(x => Math.round(context.getImageData(x, 200, 1, 1).data[0] / 255 * 6));
    });
    const expected = await Promise.all([blur(page, 0), blur(page, 1)]);
    const zoom = time ? 0.982 : 1;
    expect(values).toEqual(expected.map(value => focusBand(value / (0.78 * zoom), 14)));
    expect(Math.max(...values)).toBeLessThanOrEqual(FOCUS_BANDS);
    variances.push([await variance(page, frame.locator("#optics-chart")), await variance(page, frame.locator("#optics-modal"))]);
  }
  expect(variances[1][0]).toBeGreaterThan(variances[0][0] * 1.35);
  expect(variances[1][1]).toBeLessThan(variances[0][1] / 1.35);
});

test("an unsupported backdrop filter uses the terminal-layer fallback", async ({ page }) => {
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (property: string, value?: string) => property !== "backdrop-filter" && (value === undefined ? supports(property) : supports(property, value));
  });
  await page.goto(`${fixture}?rack`);
  await expect(page.locator('[data-velora-depth-issue="dof-approximate"]')).toBeVisible();
  await expect(page.locator("[data-velora-focus-veil]")).toHaveCount(0);
  await expect(page.locator("#optics-chart")).toHaveAttribute("style", /filter:\s*blur/);
});
