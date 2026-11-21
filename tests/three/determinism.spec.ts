import { expect, test } from "@playwright/test";
import { canvasHash, getFrames, seek, waitForBridge, type ProbeWindow } from "./support";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

test("R3F advances once per authored seek, in absolute seconds, with channels applied first", async ({ page }) => {
  await page.goto("/tests/fixtures/three.html");
  await seek(page, 0);
  const initial = (await getFrames(page)).length;
  await seek(page, 1200);
  const first = await canvasHash(page);
  await seek(page, 300);
  expect(await canvasHash(page)).not.toBe(first);
  await seek(page, 1200);
  expect(await canvasHash(page)).toBe(first);
  const frames = (await getFrames(page)).slice(initial);
  expect(frames.map(({ t, seconds, seed, absolute }) => [t, seconds, seed, absolute])).toEqual([
    [1200, 1.2, 99, 1.2], [300, .3, 99, .3], [1200, 1.2, 99, 1.2],
  ]);
  expect(frames[0].x).toBeCloseTo(30);
  expect(frames[1].x).toBeCloseTo(7.5);
});

test("the product GLB settles and absolute mixer time survives backward capture seeks", async ({ page }) => {
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const began = new Promise<void>(resolve => { requested = resolve; });
  await page.route("**/product-orbit*.glb", async route => { requested(); await loading; await route.continue(); });
  await page.goto("/tests/fixtures/three.html?orbit", { waitUntil: "domcontentloaded" });
  await began;
  await waitForBridge(page);
  const pending = page.evaluate(() => {
    const host = window as ProbeWindow & { settled?: boolean };
    host.settled = false;
    return host.__VELORA_CAPTURE__!.seek(2100).then(() => { host.settled = true; });
  });
  try {
    expect(await page.evaluate(() => (window as Window & { settled?: boolean }).settled)).toBe(false);
  } finally { release(); }
  await pending;
  await expect(page.getByText("Forma · 01")).toBeVisible();
  const first = await canvasHash(page);
  await seek(page, 400);
  expect(await canvasHash(page)).not.toBe(first);
  await seek(page, 2100);
  expect(await canvasHash(page)).toBe(first);
  await page.goto("/tests/fixtures/three.html?orbit&velora-scene=product-orbit&velora-edit=1");
  await expect(page.getByTestId("editor-save-state")).toHaveText("○ Not saved (no bridge)");
  await seek(page, 2100);
  expect(await canvasHash(page)).toBe(first);
  test.info().annotations.push({ type: "product-orbit PNG SHA-256", description: first });
  console.log(`Product orbit capture SHA-256: ${first}`);
});

test("a failed loader reaches scene diagnostics and rejects capture", async ({ page }) => {
  await page.route("**/missing-product.glb", route => route.abort("failed"));
  await page.goto("/tests/fixtures/three.html?broken");
  await expect(page.locator("[data-velora-diagnostics]")).toContainText('ThreeSurface "world"');
  await expect(seek(page, 900)).rejects.toThrow(/ThreeSurface "world"/);
});
