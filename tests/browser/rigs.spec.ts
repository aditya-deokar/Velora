import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCli } from "../../src/cli";
import { CaptureManifestSchema, type CaptureBridge, type CaptureManifest } from "../../src/core";
import { openCapture } from "../../src/export/services";
import { sceneFile, withStageProject } from "./stage-fixture";

const route = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#17202a}
article{position:absolute;top:380px;width:300px;height:140px;border-radius:6px;color:white;background:#30465d}
#revenue{left:280px}#growth{left:850px}
#control{position:absolute;left:1410px;top:180px;width:64px;height:40px;background:#79bcde}
#floating{position:absolute;left:1410px;top:300px;width:72px;height:52px;background:#f6aa41}
</style><article id="revenue" data-velora-anchor="revenue">Revenue</article>
<article id="growth" data-velora-anchor="growth">Growth</article>
<div id="control" data-velora-anchor="control"></div><div id="floating" data-velora-anchor="floating"></div>`;
const measure = (manifest: CaptureManifest, name: string) => manifest.anchors?.find(anchor => "anchor" in anchor.target && anchor.target.anchor === name);
const sha = (png: Buffer) => createHash("sha256").update(png).digest("hex");
const seek = (page: Page, timeMs: number) => page.evaluate(async ms => {
  const bridge = (window as unknown as { __VELORA_CAPTURE__: CaptureBridge }).__VELORA_CAPTURE__;
  await bridge.seek(ms);
}, timeMs);

// Use the same Chromium compositor in preview and in the export service.
test.use({ channel: "chromium" });
test("CLI bakes repeatable drone, telephoto and whip renders through the same preview and capture path", async ({ page }) => {
  test.setTimeout(480_000);
  await withStageProject(async ({ root, url }) => {
    const recipe = path.join(root, sceneFile);
    const doc = JSON.parse(await readFile(recipe, "utf8"));
    doc.definition.motion = { durationMs: 0, speed: 1, tracks: [] };
    doc.definition.scene.camera = {};
    doc.definition.width = 960;
    doc.definition.height = 540;
    doc.definition.depth = { subject: { mode: "rules", rules: [
      { match: { selector: "#control" }, tier: "control" },
      { match: { selector: "#floating" }, tier: "floating" },
      { match: { selector: "#floating" }, z: 240 },
    ] } };
    await writeFile(recipe, JSON.stringify(doc, null, 2));
    const run = async (...args: string[]) => {
      const result = await runCli([...args, "--json"], { root });
      expect(result.code, result.stderr).toBe(0);
      return JSON.parse(result.stdout).data;
    };
    const base = ["edit", "rig", "--scene", "home-hero", "--url", url];
    const preview = `${url}/__velora/?velora-preview=1&velora-scene=home-hero`;
    await page.setViewportSize({ width: 960, height: 540 });
    const assertCapture = async (timeMs: number, inspect?: (manifest: CaptureManifest) => void) => {
      await page.goto(preview);
      await expect(page.frameLocator("iframe").locator("#revenue")).toBeVisible({ timeout: 30_000 });
      await page.waitForFunction(() => typeof (window as unknown as { __VELORA_CAPTURE__?: CaptureBridge }).__VELORA_CAPTURE__?.seek === "function");
      await page.addStyleTag({ content: "[data-velora-preview-chrome],nextjs-portal{visibility:hidden!important}" });
      await seek(page, timeMs);
      const rect = (await page.locator('[data-velora-capture="scene"]').boundingBox())!;
      const shot = await page.screenshot({ clip: rect, type: "png", animations: "disabled" });
      const session = await openCapture({ url: preview, width: 960, height: 540 });
      try {
        const manifest = CaptureManifestSchema.parse(await session.manifest(timeMs));
        inspect?.(manifest);
        const first = await session.snapshot(timeMs, manifest);
        expect(await session.snapshot(timeMs, manifest)).toBe(first);
        const png = Buffer.from(first.split(",")[1], "base64");
        if (sha(png) !== sha(shot)) {
          await test.info().attach(`preview-${timeMs}`, { body: shot, contentType: "image/png" });
          await test.info().attach(`capture-${timeMs}`, { body: png, contentType: "image/png" });
        }
        expect(sha(png), `preview and capture at ${timeMs} ms`).toBe(sha(shot));
        test.info().annotations.push({ type: `frame-${timeMs}`, description: sha(png) });
      } finally { await session.close(); }
    };
    const flight = { waypoints: [[-330, 20, 0], [-120, -80, 0], [75, -50, 0]], altitude: 400, durationMs: 2400, through: true };
    const droneArgs = [...base, "--kind", "drone-flyover", "--params", JSON.stringify(flight)];
    const before = await readFile(recipe, "utf8");
    const dry = await run(...droneArgs);
    expect(dry.written).toBe(false);
    expect(await readFile(recipe, "utf8")).toBe(before);
    const drone = await run(...droneArgs, "--write");
    expect(drone.clearance.pass).toBe(true);
    expect(drone.smoothness.maxVelocityDiscontinuity).toBeLessThan(0.05);
    expect(drone.smoothness.pass, JSON.stringify(drone.smoothness)).toBe(true);
    await assertCapture(1300);

    const orbit = await run(...base, "--kind", "telephoto-parallax-orbit", "--target", "subject:revenue", "--arc", "36", "--duration", "1800", "--params", '{"depthBoost":1.35}', "--write");
    const capture = await openCapture({ url: preview, width: 960, height: 540 });
    try {
      const offsets = new Map<string, number[][]>();
      for (const t of [0, 300, 600, 900, 1200, 1500, 1800]) {
        const manifest = CaptureManifestSchema.parse(await capture.manifest(t));
        const lock = measure(manifest, "revenue")!;
        expect(lock.point).toEqual([expect.closeTo(480, 4), expect.closeTo(270, 4)]);
        expect(lock.blur).toBeLessThan(0.5);
        for (const name of ["control", "floating", "growth"]) {
          const point = measure(manifest, name)!.point!;
          offsets.set(name, [...(offsets.get(name) ?? []), [point[0] - lock.point![0], point[1] - lock.point![1]]]);
        }
      }
      for (const [name, samples] of offsets) {
        const peak = Math.max(...samples.map(point => Math.hypot(point[0] - samples[0][0], point[1] - samples[0][1])));
        const expected = orbit.parallax.find((item: { id: string }) => item.id === `subject:${name}`).peakPx;
        expect(Math.abs(peak / expected - 1), `${name}: ${peak} px measured, ${expected} px predicted`).toBeLessThan(0.05);
        test.info().annotations.push({ type: `parallax-${name}`, description: `${peak.toFixed(3)} / ${expected} px` });
      }
    } finally { await capture.close(); }
    await assertCapture(900);

    const whip = await run(...base, "--kind", "whip-pan-macro", "--from", "subject:revenue", "--to", "subject:growth", "--duration", "800", "--write");
    await assertCapture(whip.peakMs, manifest => expect(manifest.blurMode).toBe("velocity"));
    const blur = page.locator('filter[id$="-velocity"] feGaussianBlur');
    const [horizontal, vertical] = (await blur.getAttribute("stdDeviation"))!.split(" ").map(Number);
    expect(horizontal).toBeGreaterThan(10);
    expect(horizontal).toBeGreaterThan(4 * vertical);
    await page.evaluate(() => (window as unknown as { __VELORA_CAPTURE__: CaptureBridge }).__VELORA_CAPTURE__.configure!({ velocityBlur: false }));
    await expect(page.locator("[data-velora-velocity-blur]")).toHaveCSS("filter", "none");
    const arrival = await openCapture({ url: preview, width: 960, height: 540, accumulateMotion: true });
    try {
      const manifest = CaptureManifestSchema.parse(await arrival.manifest(800));
      expect(manifest.blurMode).toBe("shutter");
      expect(measure(manifest, "growth")?.point).toEqual([expect.closeTo(480, 4), expect.closeTo(270, 4)]);
      expect(measure(manifest, "growth")?.blur).toBeLessThan(0.5);
    } finally { await arrival.close(); }
    const saved = JSON.parse(await readFile(recipe, "utf8"));
    expect(saved.definition.motion.clips[0]).toMatchObject({ source: { rig: "whip-pan-macro", version: 1 }, tracks: expect.arrayContaining([expect.objectContaining({ property: "position", timing: "parametric" })]) });
  }, route);
});
