import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startSceneBridge } from "../../src/project/edit";
import { canvasHash, seek } from "../three/support";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

const origin = process.env.VELORA_TEST_URL ?? "http://127.0.0.1:" + (process.env.VELORA_TEST_PORT ?? 4173);
const product = {
  id: "mesh", version: 1, title: "3D editor", definition: {
    width: 640, height: 360, scene: { camera: { perspective: 650 }, focus: { maxBlur: 0 }, nodes: [{ id: "world" }, { id: "marker" }] },
    motion: { durationMs: 2000, speed: 1, tracks: [
      { target: { kind: "channel", id: "three:hero-mesh.position.x" }, property: "value", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 2000, value: 50 }] },
    ] },
  },
};

test("pick a registered mesh, drag its gizmo, save the channel and capture without controls", async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), "velora-editor-three-"));
  const folder = path.join(root, "src/velora/scenes");
  const file = path.join(folder, "mesh.scene.json");
  await mkdir(folder, { recursive: true });
  await writeFile(file, JSON.stringify(product));
  const bridge = await startSceneBridge(root, { origin, readOnly: false, version: "test" });
  try {
    await page.goto(`/tests/fixtures/three.html?velora-scene=mesh&velora-edit=1#velora-bridge=${bridge.server.port}.${bridge.token}`);
    await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
    await expect(page.locator('[data-item="three:hero-mesh"]')).toHaveText(/Hero mesh/);
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.click(x, y);
    await expect(canvas).toHaveAttribute("data-velora-gizmo", "three:hero-mesh");
    await expect(page.getByRole("button", { name: "Animate color" })).toBeVisible();
    await page.keyboard.press("Shift+ArrowRight");
    // Drag the right-hand X handle from the current selection, not the DOM overlay handles.
    const half = box.width / 640;
    const startX = x + 25 * half + box.height * 0.085;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 50 * half, y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => {
      const saved = JSON.parse(await readFile(file, "utf8")) as typeof product;
      return saved.definition.motion.tracks[0].keyframes.find(key => key.timeMs === 1000)?.value ?? -Infinity;
    }).toBeGreaterThan(25);
    await expect(page.getByTestId("editor-save-state")).toHaveText("● Saved");
    await seek(page, 1000);
    await expect(canvas).not.toHaveAttribute("data-velora-gizmo", /.+/);
    const editorCapture = await canvasHash(page);
    const { definition } = JSON.parse(await readFile(file, "utf8"));
    await page.goto(`/tests/fixtures/three.html?definition=${encodeURIComponent(JSON.stringify(definition))}`);
    await seek(page, 1000);
    await expect(canvas).not.toHaveAttribute("data-velora-gizmo", /.+/);
    expect(await canvasHash(page)).toBe(editorCapture);
  } finally {
    await bridge.server.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
