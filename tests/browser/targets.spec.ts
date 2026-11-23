import { expect, test, type Page } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCli } from "../../src/cli";
import { CaptureManifestSchema, AnchorsResultSchema, buildOrbitRig, type CaptureBridge } from "../../src/core";
import { openCapture } from "../../src/export/services";
import { sceneFile, withStageProject } from "./stage-fixture";

const fixture = "/tests/fixtures/targets.html";
test.use({ channel: "chromium", deviceScaleFactor: 2 });
const bridge = (page: Page, time: number) => page.evaluate(async ms => {
  const bridge = (window as unknown as { __VELORA_CAPTURE__: CaptureBridge }).__VELORA_CAPTURE__;
  await bridge.seek(ms);
  return bridge.anchors!;
}, time);

test("200 mm orbit stays centered and sharp in each captured sample after live reflow", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 800, height: 400 });
  await page.goto(fixture);
  await expect(page.locator("[data-probe]")).toBeAttached();
  const session = await openCapture({ url: new URL(fixture, baseURL).href, width: 800, height: 400, scale: 2 });
  try {
    for (const time of [0, 125, 250, 375, 500, 625, 750, 875, 1000]) {
      const [preview] = await bridge(page, time);
      const manifest = CaptureManifestSchema.parse(await session.manifest(time));
      expect(manifest.anchors?.[0]).toEqual(preview);
      expect(preview.blur).toBeLessThan(0.5);
      expect(preview.point).toEqual([expect.closeTo(400, 4), expect.closeTo(200, 4)]);
      const probe = await page.locator("[data-probe]").boundingBox();
      expect(Math.abs(probe!.x + probe!.width / 2 - 400)).toBeLessThan(0.5);
      expect(Math.abs(probe!.y + probe!.height / 2 - 200)).toBeLessThan(0.5);
      const shot = await session.snapshot(time, manifest);
      const center = await page.evaluate(async source => {
        const img = new Image(); img.src = source; await img.decode();
        const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
        const context = canvas.getContext("2d")!; context.drawImage(img, 0, 0);
        const scale = img.width / 800;
        const size = 12 * scale;
        const pixels = context.getImageData(394 * scale, 194 * scale, size, size).data;
        let x = 0, y = 0, total = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const green = Math.max(0, pixels[i + 1] - Math.max(pixels[i], pixels[i + 2]));
          x += green * (394 + (0.5 + i / 4 % size) / scale);
          y += green * (194 + (0.5 + Math.floor(i / (4 * size))) / scale);
          total += green;
        }
        return { x: x / total, y: y / total, total };
      }, shot);
      expect(center.total).toBeGreaterThan(0);
      expect(Math.abs(center.x - 400), `export x at ${time}ms ${JSON.stringify({ center, probe, point: preview.point })}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(center.y - 200), `export y at ${time}ms ${JSON.stringify({ center, probe, point: preview.point })}`).toBeLessThanOrEqual(0.5);
    }
    const [before] = await bridge(page, 500);
    await page.locator("[data-layout]").evaluate((el: HTMLElement) => { el.style.top = "50px"; });
    const [after] = await bridge(page, 500);
    expect(after.rect.y - before.rect.y).toBeCloseTo(27);
    expect(after.point).toEqual([expect.closeTo(400, 4), expect.closeTo(200, 4)]);
    await page.locator("button").evaluate(el => el.parentElement!.append(el.cloneNode(true)));
    await expect(bridge(page, 500)).rejects.toThrow("ERR_TARGET_MISSING");
    await page.locator("button").last().evaluate(el => el.remove());
    await expect(bridge(page, 500)).resolves.toHaveLength(1);
  } finally { await session.close(); }
});

const route = `<!doctype html><meta charset="utf-8"><style>
body { margin: 0; min-height: 2300px; background: #edf4ff; }
main { padding: 170px 0 0 190px; }
#card { width: 220px; height: 100px; background: #fff; }
#fixed { position: fixed; right: 30px; top: 40px; width: 70px; height: 26px; }
#sticky { position: sticky; top: 10px; width: 150px; height: 30px; background: #ccd; }
</style><div style="height:80px"></div><aside id="sticky" data-velora-anchor="sticky">Summary</aside>
<main><h1>Revenue today</h1><article id="card" data-velora-anchor="revenue-card">Revenue</article></main>
<button id="fixed" data-velora-anchor="fixed">Export</button>`;

test("CLI inventories a live RouteFrame, writes locks, follows scroll and refuses a missing anchor on export", async ({ page }) => {
  test.setTimeout(240_000);
  await withStageProject(async ({ root, url }) => {
    const recipe = path.join(root, sceneFile);
    const folder = path.dirname(recipe);
    const binding = path.join(folder, (await readdir(folder)).find(file => /^home-hero\.[jt]sx$/.test(file))!);
    const run = async (...args: string[]) => {
      const result = await runCli([...args, "--json"], { root });
      expect(result.code, result.stderr).toBe(0);
      return JSON.parse(result.stdout).data;
    };
    const document = JSON.parse(await readFile(recipe, "utf8"));
    const perspective = document.definition.height * 200 / 24;
    const rig = buildOrbitRig({ radius: perspective * 0.9, fromDeg: -14, toDeg: 14, perspective, durationMs: 400 });
    document.definition.scene.camera = { perspective };
    document.definition.depth = { subject: { mode: "rules", rules: [{ match: { selector: "#card" }, tier: "card" }] } };
    document.definition.motion = { durationMs: 400, speed: 1, clips: [rig.clip], tracks: [{ target: { kind: "channel", id: "scroll-test" }, property: "value", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 400, value: 180 }] }] };
    await writeFile(recipe, JSON.stringify(document, null, 2));
    const originalBinding = await readFile(binding, "utf8");
    expect(originalBinding).toContain("<RouteFrame ");
    await writeFile(binding, originalBinding.replace("<RouteFrame ", '<RouteFrame scrollChannel="scroll-test" '));
    const before = await readFile(recipe, "utf8");
    const args = ["anchors", "--scene", "home-hero", "--url", url];
    const base = AnchorsResultSchema.parse(await run(...args));
    expect(base.anchors).toHaveLength(3);
    expect(base.anchors.every(anchor => anchor.projected === undefined)).toBe(true);
    expect(await readFile(recipe, "utf8")).toBe(before);
    const card = base.anchors.find(({ target }) => "anchor" in target && target.anchor === "revenue-card")!;
    expect(card).toMatchObject({ tier: "card", elevation: 24, baseElevation: 0 });
    const revenue = card.target;
    const target = `${revenue.surface}:revenue-card`;
    await run("edit", "lock", "--scene", "home-hero", "--look-at", target, "--focus-follow", target, "--write");
    const preview = `${url}/__velora/?velora-preview=1&velora-scene=home-hero`;
    await page.goto(preview);
    await expect(page.locator("iframe")).toBeAttached();
    const start = AnchorsResultSchema.parse(await run(...args, "--time", "0")).anchors;
    const end = AnchorsResultSchema.parse(await run(...args, "--time", "400")).anchors;
    const named = (entries: typeof end, name: string) => entries.find(({ target }) => "anchor" in target && target.anchor === name)!;
    const live = named(end, "revenue-card");
    expect(live.point).toEqual([expect.closeTo(document.definition.width / 2, 4), expect.closeTo(document.definition.height / 2, 4)]);
    expect(live.blur).toBeLessThan(0.5);
    expect(live.rect.y).toBeLessThan(named(start, "revenue-card").rect.y - 100);
    expect(named(end, "fixed").rect.y).toBeCloseTo(named(start, "fixed").rect.y);
    expect(named(end, "sticky").rect.y).toBeLessThan(named(start, "sticky").rect.y);
    expect(named(await bridge(page, 400), "revenue-card")).toEqual(live);
    await expect(page.frameLocator("iframe").locator("#sticky")).toBeAttached();
    expect(await page.frameLocator("iframe").locator("#sticky").evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(10);
    await page.goto(preview + "&velora-edit=1");
    await expect(page.locator('[data-target-reticle="subject:revenue-card"]')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator("[data-target-reticle] [data-focus-plane]")).toHaveCount(1);
    await page.getByRole("treeitem", { name: "Focus", exact: true }).click();
    await expect(page.getByLabel("Live target")).toContainText("subject:revenue-card");
    await expect(page.locator("[data-target-geometry]").first()).toContainText("px blur");
    await writeFile(path.join(root, "app/index.html"), route.replace('data-velora-anchor="revenue-card"', ""));
    const result = await runCli(["export", "--url", preview, "--output", "refused.mp4", "--quality", "draft", "--json"], { root });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).issues).toContainEqual(expect.objectContaining({ code: "ERR_TARGET_MISSING", hint: expect.stringContaining("velora anchors") }));
    await expect(readFile(path.join(root, "refused.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    const recovered = AnchorsResultSchema.parse(await run(...args)).anchors;
    expect(recovered).toContainEqual(expect.objectContaining({ target: { surface: "subject", selector: "#card" }, elevation: 24 }));
    expect(recovered.some(({ target }) => "anchor" in target && target.anchor === "revenue-card")).toBe(false);
  }, route);
});
