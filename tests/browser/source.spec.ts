import { expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { VELORA_PACKAGE } from "../../src/core";
import { startSceneBridge } from "../../src/project/edit";
import { audit, loadAudit } from "./audit";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const binding = "src/velora/scenes/design.jsx";
const recipeFile = "src/velora/scenes/design.scene.json";
const original = `import { Surface } from ${JSON.stringify(VELORA_PACKAGE.name)};
function Counter({value}) { return <output data-testid="source-counter">{value}</output>; }
export default function Design() {
  return <Surface id="frame" style={{width:800,height:500,background:"#26242c",color:"white",padding:24}}>
    <section style={{display:"flex",gap:20}}>
      <h1 data-testid="headline" data-insp-path="${binding}:6:7:h1">Headline</h1>
      <h1 data-testid="benefit">Benefit</h1>
      <h1 data-testid="proof">Proof</h1>
    </section>
    <Counter value={7}/>
  </Surface>;
}
`;
const recipe = { version: 1, id: "design", title: "Source design", definition: {
  width: 800, height: 500, scene: { nodes: [{ id: "frame" }], focus: { maxBlur: 0 } }, motion: { durationMs: 2500, speed: 1, tracks: [] },
} };
let root = "", vite: ViteDevServer | undefined, bridge: Awaited<ReturnType<typeof startSceneBridge>> | undefined;
const read = (target: string) => readFile(path.join(root, target), "utf8");
const disk = async () => JSON.parse(await read(recipeFile));
test.afterEach(async () => { await bridge?.server.stop(); await vite?.close(); if (root) await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); root = ""; bridge = undefined; vite = undefined; });

async function open(page: Page) {
  // Keep Vite's project, source aliases and dependencies on the same volume on Windows runners.
  root = await mkdtemp(path.join(workspace, ".test-dist", "source-host-"));
  const put = async (file: string, content: string) => { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content); };
  await put("package.json", '{"name":"codemod-fixture","type":"module","private":true}');
  await put("index.html", '<div id="root"></div><script type="module" src="/src/main.jsx"></script>');
  await put("src/main.jsx", `import {createRoot} from 'react-dom/client'; import Host from './Host.jsx'; createRoot(document.getElementById('root')).render(<Host/>);`);
  await put("src/Host.jsx", `import { SceneLibrary } from '${VELORA_PACKAGE.name}/preview';
    import Source from './velora/scenes/design.scene.json'; import Binding from './velora/scenes/design.jsx';
    export default function Host(){return <SceneLibrary sources={{'${recipeFile}':Source}} bindings={{'${binding}':Binding}} hot={import.meta.hot}/>;}`);
  await put(binding, original); await put(recipeFile, JSON.stringify(recipe, null, 2) + "\n");
  vite = await createServer({ root, configFile: false, plugins: [react()], cacheDir: path.join(root, ".vite"), resolve: { dedupe: ["react", "react-dom"], alias: [
    { find: `${VELORA_PACKAGE.name}/preview`, replacement: path.join(workspace, "src/preview/index.tsx") },
    { find: VELORA_PACKAGE.name, replacement: path.join(workspace, "src/index.ts") },
  ] }, server: { host: "127.0.0.1", port: 0, fs: { allow: [workspace] } } });
  await vite.listen();
  const port = (vite.httpServer!.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  bridge = await startSceneBridge(root, { origin, readOnly: false, version: "test" });
  await page.goto(`${origin}/?velora-scene=design&velora-edit=1#velora-bridge=${bridge.server.port}.${bridge.token}`);
  await expect(page.getByRole("button", { name: "Pick source element" })).toBeVisible({ timeout: 40_000 });
  return origin;
}

async function pick(page: Page, name: string) {
  await page.getByRole("button", { name: "Pick source element" }).click();
  const box = (await page.getByTestId(name).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.getByRole("dialog", { name: "Source integration" });
  await expect(panel.getByRole("region", { name: "JSX outline" })).toBeVisible();
  return panel;
}

async function seek(page: Page, at: number) {
  await page.waitForFunction(() => "__VELORA_CAPTURE__" in window);
  await page.evaluate(async time => {
    const capture = (window as unknown as { __VELORA_CAPTURE__: { seek(atMs: number): void | Promise<void> } }).__VELORA_CAPTURE__;
    await capture.seek(time);
  }, at);
}

test("Vite promotes three JSX siblings, groups and staggers them, and captures motion after HMR", async ({ page, context }) => {
  test.setTimeout(120_000);
  const origin = await open(page);
  await loadAudit(page);
  for (const [id, label, mapped] of [["headline", "Headline", true], ["benefit", "Benefit", false], ["proof", "Proof", false]] as const) {
    const panel = await pick(page, id);
    if (mapped) await audit(page, '[aria-label="Source integration"]', "source integration");
    const sourceNode = panel.getByRole("button", { name: new RegExp(`h1 · ${label}`) });
    if (mapped) await expect(sourceNode).toHaveAttribute("aria-pressed", "true");
    else { await expect(sourceNode).toHaveAttribute("data-source-candidate", ""); await sourceNode.click(); }
    await expect(panel.getByRole("link", { name: "Open in editor" })).toHaveAttribute("href", /vscode:\/\/file/);
    await panel.getByLabel("Layer ID").fill(id);
    await panel.getByRole("button", { name: "Preview source edit" }).click();
    await expect(panel.getByRole("region", { name: "Source diff" })).toContainText(`<Surface id="${id}">`);
    await expect(panel.getByText("Preview wrapper layout", { exact: true })).toBeVisible();
    expect((await disk()).definition.scene.nodes.some((node: { id: string }) => node.id === id)).toBe(false);
    await panel.getByRole("button", { name: "Apply source edit" }).click();
    await expect(page.locator(`[data-item="${id}"]`)).toBeVisible({ timeout: 25_000 });
    await expect(page.locator(`[data-velora-id="${id}"]`)).toBeVisible();
  }
  const panel = page.getByRole("dialog", { name: "Source integration" });
  for (const id of ["headline", "benefit", "proof"]) await panel.getByRole("checkbox", { name: `Group ${id}` }).check();
  await panel.getByLabel("Layer ID").fill("cards");
  await panel.getByRole("button", { name: "Preview source edit" }).click();
  await expect(panel.getByRole("region", { name: "Source diff" })).toContainText('<Surface id="cards">');
  await panel.getByRole("button", { name: "Apply source edit" }).click();
  await expect(page.locator('[data-velora-id="cards"] [data-velora-id="proof"]')).toBeVisible({ timeout: 25_000 });
  expect((await disk()).definition.scene.nodes).toEqual([
    { id: "frame" }, { id: "headline", parentId: "cards" }, { id: "benefit", parentId: "cards" }, { id: "proof", parentId: "cards" }, { id: "cards", parentId: "frame" },
  ]);
  await panel.getByRole("button", { name: "Close" }).click();
  await page.locator('[data-item="cards"]').click();
  const x = page.getByRole("textbox", { name: "x value", exact: true });
  await page.getByRole("button", { name: "Animate x", exact: true }).click();
  await page.getByRole("button", { name: "Auto-key", exact: true }).click();
  await seek(page, 1000);
  await x.fill("65"); await x.press("Enter");
  await expect.poll(async () => (await disk()).definition.motion.tracks).toMatchObject([{ target: { kind: "surface", id: "cards" }, property: "x", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 65 }] }]);
  await seek(page, 0);
  await page.locator('[data-item="headline"]').click();
  await page.locator('[data-item="benefit"]').click({ modifiers: ["Shift"] });
  await page.locator('[data-item="proof"]').click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("stagger.open");
  await palette.getByRole("option").first().click();
  const stagger = page.getByRole("dialog", { name: "Stagger layers" });
  await stagger.getByRole("combobox", { name: "Template", exact: true }).selectOption("behavior:fade-up");
  await stagger.getByRole("button", { name: "Create stagger" }).click();
  await expect.poll(async () => (await disk()).definition.motion.clips?.[0]?.members).toEqual(["headline", "benefit", "proof"]);
  const exportPage = await context.newPage();
  await exportPage.goto(`${origin}/?velora-scene=design`);
  await expect(exportPage.locator('[data-velora-id="cards"]')).toBeVisible();
  await seek(exportPage, 0);
  const first = await exportPage.locator('[data-velora-id="cards"]').evaluate(element => getComputedStyle(element).transform);
  await seek(exportPage, 1000);
  await expect(exportPage.locator('[data-velora-id="cards"]')).toHaveCSS("transform", /65/);
  expect(first).not.toContain("65");
});

test("Vite exposes a literal counter prop and writes a channel from the layer inspector", async ({ page }) => {
  test.setTimeout(100_000);
  await open(page);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Source integration" });
  await panel.getByRole("button", { name: "Counter", exact: true }).click();
  await panel.getByRole("combobox", { name: "Operation" }).selectOption("expose");
  await panel.getByLabel("Animatable ID").fill("count");
  await panel.getByRole("combobox", { name: "Prop", exact: true }).selectOption("value");
  await panel.getByRole("button", { name: "Preview source edit" }).click();
  await expect(panel.getByRole("region", { name: "Source diff" })).toContainText('useAnimatable("count"');
  await panel.getByRole("button", { name: "Apply source edit" }).click();
  await expect.poll(() => read(binding)).toContain("veloraValue.value");
  await panel.getByRole("button", { name: "Close" }).click();
  await page.locator('[data-item="frame"]').click();
  const value = page.getByRole("textbox", { name: "count.value value", exact: true });
  await expect(value).toHaveValue("7", { timeout: 25_000 });
  await value.fill("19"); await value.press("Enter");
  await expect.poll(async () => (await disk()).definition.motion.tracks).toMatchObject([{ target: { kind: "channel", id: "count.value" }, keyframes: [{ value: 19 }] }]);
  await expect(page.getByTestId("source-counter")).toHaveText("19");
});
