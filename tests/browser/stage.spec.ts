import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCli } from "../../src/cli";
import { parsePng } from "../../src/export/compositor";
import { sceneFile, withStageProject, type StageProbe } from "./stage-fixture";

test("laptop layout matches 1080p export and 4K records the capture cap", async ({ page }) => {
  test.setTimeout(150_000);
  await withStageProject(async ({ root, url, probes }) => {
    const run = async (args: string[]) => {
      const result = await runCli([...args, "--json"], { root });
      expect(result.code, result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    };
    const target = path.join(root, sceneFile);
    const recipe = JSON.parse(await readFile(target, "utf8"));
    expect(recipe.definition.stage).toMatchObject({ preset: "laptop-14", width: 1512, height: 982, dpr: 2 });
    recipe.definition.scene = { nodes: [{ id: "subject" }], camera: { perspective: 1000 }, focus: { maxBlur: 0 } };
    recipe.definition.motion = { durationMs: 40, tracks: [{ target: { kind: "camera" }, property: "z",
      keyframes: [{ timeMs: 0, value: 3000, easing: "linear" }, { timeMs: 40, value: 0 }] }] };
    await writeFile(target, JSON.stringify(recipe));
    const preview = `${url}/__velora/?velora-preview=1&velora-scene=home-hero`;
    await page.goto(preview);
    const body = page.frameLocator('iframe[title="Route /app/"]').locator("body");
    await expect(body).toHaveAttribute("data-stage-probe", /"width":1512,"height":982/);
    const previewProbe: StageProbe = JSON.parse((await body.getAttribute("data-stage-probe"))!);
    expect(previewProbe.wide).toBe(true);
    const exported = await run(["export", "--url", preview, "--output", "stage.mp4", "--quality", "standard", "--width", "1920", "--height", "1080", "--fps", "30"]);
    expect(exported.data.stage).toMatchObject({ width: 1512, height: 982, dpr: 2, effectiveDpr: 2 });
    const capture = probes.find(probe => probe.dpr === 2)!;
    expect(capture).toMatchObject({ width: 1512, height: 982, dpr: 2, wide: true, backing: 292 });
    capture.rect.forEach((value, index) => expect(Math.abs(value - previewProbe.rect[index])).toBeLessThanOrEqual(0.5));
    const video = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", "stage.mp4"], { cwd: root, encoding: "utf8" });
    expect(video.stdout.trim()).toBe("1920,1080");

    const inspected = await run(["inspect", "--scene", "home-hero"]);
    expect(inspected.data.stage).toMatchObject({ effectiveDpr: 2, undersampled: false });
    const shot = ["shot", "--scene", "home-hero", "--time", "40", "--url", url];
    const standard = await run([...shot, "--out", "close.png"]);
    const reference = await run([...shot, "--stage-dpr", "2", "--out", "reference.png"]);
    expect(standard.data.sha).toBe(reference.data.sha);
    expect((await run([...shot, "--stage-dpr", "1.25", "--out", "fractional.png"])).data.stage.effectiveDpr).toBe(1.25);
    expect(parsePng(await readFile(path.join(root, "fractional.png")))).toMatchObject({ width: 1920, height: 1080 });

    await writeFile(path.join(root, "stage.composition.json"), JSON.stringify({
      version: 1, id: "stage", title: "4K stage", width: 3840, height: 2160, fps: 30,
      scenes: [{ id: "picture", recipe: "home-hero", startMs: 0, durationMs: 40 }],
    }));
    await run(["render", "--composition", "stage.composition.json", "--frame", "0", "--out", "4k.png", "--url", url, "--no-cache"]);
    expect(parsePng(await readFile(path.join(root, "4k.png")))).toMatchObject({ width: 3840, height: 2160 });
    const manifest = JSON.parse(await readFile(path.join(root, "4k.manifest.json"), "utf8"));
    expect(manifest.stage).toMatchObject({ preset: "laptop-14", effectiveDpr: 1, dprCapped: true });
    expect(manifest.checks).toContainEqual(expect.objectContaining({ id: "stage-dpr", pass: false }));
  });
});
