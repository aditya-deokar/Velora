import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCli } from "../../src/cli";
import { sceneFile, withStageProject } from "./stage-fixture";

test("depth resolves a live staged route, stores its hash, and supports exact file undo", async ({ page }) => {
  test.setTimeout(180_000);
  await withStageProject(async ({ root, url }) => {
    const recipe = path.join(root, sceneFile);
    const run = async (...args: string[]) => {
      const result = await runCli([...args, "--json"], { root });
      expect(result.code, result.stderr).toBe(0);
      return JSON.parse(result.stdout).data;
    };
    await run("edit", "depth", "--scene", "home-hero", "--surface", "subject", "--mode", "auto", "--intensity", "standard", "--write");
    const before = await readFile(recipe, "utf8");
    const args = ["depth", "resolve", "--scene", "home-hero", "--url", url];
    const dry = await run(...args);
    expect(await readFile(recipe, "utf8")).toBe(before);
    const saved = await run(...args, "--write");
    expect(saved.ops).toEqual(dry.ops);
    const { hash, layers } = saved.ops[0].resolved;
    expect(layers).toHaveLength(2);
    const still = await run("shot", "--scene", "home-hero", "--time", "0", "--url", url, "--out", "depth.png");
    expect(still.depth).toEqual([{ surface: "subject", hash }]);
    await writeFile(path.join(root, "depth.composition.json"), JSON.stringify({ version: 1, id: "depth", title: "Depth", width: 960, height: 540, fps: 30,
      scenes: [{ id: "intro", recipe: "home-hero", startMs: 0, durationMs: 1000 }] }));
    await run("render", "--composition", "depth.composition.json", "--frame", "0", "--out", "frame.png", "--url", url, "--no-cache");
    expect(JSON.parse(await readFile(path.join(root, "frame.manifest.json"), "utf8")).depth).toEqual([{ sceneId: "home-hero", surface: "subject", hash }]);
    const inverse = await runCli(["edit", "apply", "--scene", "home-hero", "--ops", "-", "--write", "--json"], { root, readStdin: async () => JSON.stringify(saved.inverse) });
    expect(inverse.code, inverse.stderr).toBe(0);
    expect(await readFile(recipe, "utf8")).toBe(before);
    await page.goto(`${url}/app/`);
    const originalHost = await page.locator("body").innerHTML();
    await page.goto(`${url}/__velora/?velora-preview=1&velora-scene=home-hero&velora-edit=1`);
    await expect(page.getByRole("button", { name: "Depth view" })).toBeVisible();
    await expect(page.getByLabel(/Depth tier for.*button/i)).toBeVisible();
    await page.getByRole("button", { name: "Depth view" }).click();
    await expect(page.locator("[data-velora-depth-view]")).toHaveCount(1);
    await expect(page.evaluate(() => (window as unknown as { __VELORA_CAPTURE__: { seek(ms: number): Promise<void> } }).__VELORA_CAPTURE__.seek(0))).rejects.toThrow("Close Depth view");
    await page.locator("iframe").evaluate(frame => Object.assign(window, { savedRoute: (frame as HTMLIFrameElement).contentDocument }));
    await page.getByRole("link", { name: "Scenes", exact: true }).click();
    await expect(page.locator("iframe")).toHaveCount(0);
    const cleaned = await page.evaluate(() => {
      const doc = (window as unknown as { savedRoute: Document }).savedRoute;
      return { body: doc.body.innerHTML, sheet: !!doc.getElementById("velora-route-frame") };
    });
    expect(cleaned).toEqual({ body: originalHost, sheet: false });
  });
});

test("CLI applies a physical lens and resolves a rack between live iframe layers", async () => {
  test.setTimeout(180_000);
  await withStageProject(async ({ root, url }) => {
    const run = async (...args: string[]) => {
      const result = await runCli([...args, "--json"], { root });
      expect(result.code, result.stderr).toBe(0);
      return JSON.parse(result.stdout).data;
    };
    await run("edit", "depth", "--scene", "home-hero", "--surface", "subject", "--mode", "auto", "--write");
    await run("edit", "lens", "--scene", "home-hero", "--preset", "200mm-telephoto", "--hold", "framing", "--write");
    const recipe = path.join(root, sceneFile);
    const before = await readFile(recipe, "utf8");
    const definition = JSON.parse(before).definition;
    expect(definition.scene.camera.perspective).toBe(definition.height * 200 / 24);
    expect(definition.scene.focus.focalLength).toBeCloseTo(200 * 1512 / 302, 10);
    const focus = await run("inspect", "--scene", "home-hero", "--at", "400", "--url", url);
    expect(focus.layerFocus).toHaveLength(2);
    expect(focus.layerFocus.every((item: { signed: number; blur: number }) => Number.isFinite(item.signed) && item.blur >= 0)).toBe(true);
    const [a, b] = focus.layerFocus.map((item: { match: { selector: string } }) => `layer:${item.match.selector}`);
    const command = ["edit", "rack", "--scene", "home-hero", "--from", a, "--to", b, "--at", "400", "--duration", "800", "--breathing", "0.018", "--url", url];
    const dry = await run(...command);
    expect(dry.written).toBe(false);
    expect(await readFile(recipe, "utf8")).toBe(before);
    await run(...command, "--write");
    const clip = JSON.parse(await readFile(recipe, "utf8")).definition.motion.clips[0];
    expect(clip.source).toMatchObject({ rack: "focus", params: { from: { layer: a.slice(6) }, to: { layer: b.slice(6) }, breathing: { amount: 0.018 } } });
    expect(clip.clips[0].tracks[0].property).toBe("zoom");
  });
});
