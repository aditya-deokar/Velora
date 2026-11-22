import { expect, test, type Page } from "@playwright/test";
import { openCapture, decodePngDataUrl, sha256Hex } from "../../src/export/services";
import { parsePng } from "../../src/export/compositor";
import { applyPoint, CameraSchema, cameraMatrix, CaptureManifestSchema, lensFor, projectWorld } from "../../src/core";

const fixture = "/tests/fixtures/depth.html";
const width = 640, height = 420;
test.use({ channel: "chromium", viewport: { width, height } });
type FixtureWindow = Window & { depthFixture: { seek(ms: number): void; active(value: boolean): void; capture(value: boolean): void } };
const seek = (page: Page, time: number) => page.evaluate(ms => (window as unknown as FixtureWindow).depthFixture.seek(ms), time);

test("volumetric model creates parallax, proxies and deterministic capture without changing the host", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await page.goto(fixture + "?flat&focus");
  const host = page.locator("#host-dashboard"), card = page.locator("#card");
  const original = await host.innerHTML();
  await page.evaluate(() => (window as unknown as FixtureWindow).depthFixture.active(true));
  await expect(card).toHaveAttribute("style", /translateZ\(24px\)/);
  expect(await card.evaluate(node => (node as HTMLElement).style.getPropertyPriority("transform"))).toBe("important");
  await expect(page.locator("[data-velora-depth-proxies] > div:has(> div)")).toHaveCount(4);
  await expect(page.locator('[data-velora-depth-issue="depth-flattened"]')).toContainText("overflow");
  await expect(page.locator('[data-velora-depth-focus]')).toHaveCount(5);
  expect(await page.locator("#blocker").evaluate(node => getComputedStyle(node).overflow)).toBe("hidden");
  for (const time of [0, 1000]) {
    await seek(page, time);
    const projected = projectWorld(CameraSchema.parse({ perspective: 1450, rotateY: time / 25 - 20 }), { width, height }, [333 - width / 2, 159.5 - height / 2, 24], "stage")!;
    const actual = await page.locator("#card-center").evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top }; });
    expect(Math.hypot(actual.x - projected.x, actual.y - projected.y)).toBeLessThan(0.5);
  }
  const clip = (await page.locator("#depth-viewport").boundingBox())!;
  const expected = parsePng(await page.screenshot({ clip, animations: "disabled" }));
  const capture = await openCapture({ url: new URL(fixture + "?focus", baseURL).href, width, height });
  try {
    const manifest = CaptureManifestSchema.parse(await capture.manifest(1000));
    expect(manifest.depth?.[0].layers).toContainEqual({ match: { anchor: "revenue" }, tier: "card", z: 24 });
    const frame = await capture.snapshot(1000, manifest);
    expect(await capture.snapshot(1000, manifest)).toBe(frame);
    const actual = parsePng(decodePngDataUrl(frame));
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    expect(sha256Hex(actual.pixels)).toBe(sha256Hex(expected.pixels));
  } finally { await capture.close(); }
  await page.evaluate(() => (window as unknown as FixtureWindow).depthFixture.active(false));
  await expect(host).toHaveJSProperty("innerHTML", original);
});

test("iframe projection matches the raised centers at 50 mm and 200 mm and reverts its document", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => Object.assign(window, { __VELORA_CAPTURING__: true }));
  for (const mm of [50, 200]) {
    const perspective = lensFor(mm, height).perspective;
    await page.goto(`${fixture}?iframe&perspective=${perspective}&pitch=18`);
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#card")).toHaveAttribute("style", /translate\(/);
    expect(await frame.locator("#card").evaluate(node => getComputedStyle(node).backgroundImage)).toContain("radial-gradient");
    const baseline = await frame.locator("#route-dashboard").evaluate(host => (host.ownerDocument.defaultView as unknown as { originalDepthStructure: string }).originalDepthStructure);
    for (const time of [0, 500, 1000]) {
      await seek(page, time);
      const camera = CameraSchema.parse({ perspective, rotateX: 18, rotateY: time / 25 - 20 });
      const raw = await frame.locator("#card-center").evaluate(node => { const r = node.getBoundingClientRect(); return [r.left, r.top]; });
      const expected = projectWorld(camera, { width, height }, [333 - width / 2, 159.5 - height / 2, 24], "stage")!;
      const mapped = projectWorld(camera, { width, height }, applyPoint(cameraMatrix(camera), [raw[0] - width / 2, raw[1] - height / 2, 0]), "view")!;
      expect(Math.hypot(mapped.x - expected.x, mapped.y - expected.y)).toBeLessThan(mm === 50 ? 1 : 0.25);
    }
    await page.evaluate(() => (window as unknown as FixtureWindow).depthFixture.capture(false));
    await expect(frame.locator("#route-dashboard")).toHaveJSProperty("innerHTML", baseline);
    await expect(frame.locator("#velora-route-frame")).toHaveCount(0);
  }
});
