import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeProjectCommand, executeTemplateCommand } from "../../src/project/commands";
import { componentExport, sceneImportPath } from "../../src/project/templates";
import { discoverRecipes } from "../../src/project/discovery";
import { SceneRecipeSchema } from "../../src/core/recipes";
import { CompositionSchema } from "../../src/core/composition";
import { VELORA_PACKAGE } from "../../src/core/branding";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function put(root: string, file: string, text: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
// An initialized Vite host with real components to slot into templates.
async function host() {
  const root = await mkdtemp(path.join(tmpdir(), "velora-templates-"));
  roots.push(root);
  await put(root, "package.json", JSON.stringify({ name: "host", scripts: { dev: "vite" }, dependencies: { react: "^19.2.0", "react-dom": "^19.2.0", [VELORA_PACKAGE.name]: "0.1.0" }, devDependencies: { vite: "^7.3.6" } }));
  await put(root, "package-lock.json", '{"lockfileVersion":3}');
  await put(root, "index.html", '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  await put(root, "vite.config.ts", 'import {defineConfig} from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({plugins:[react()]});');
  await put(root, "src/main.tsx", 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);\n');
  await put(root, "src/App.tsx", "export default function App() { return <main>App</main>; }\n");
  await put(root, "src/components/Dashboard.tsx", "export function Dashboard() { return <section>Revenue</section>; }\nexport const Chart = () => null;\n");
  for (const name of ["react", "react-dom"]) await put(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version: "19.2.0" }));
  await put(root, `node_modules/${VELORA_PACKAGE.name}/package.json`, JSON.stringify({ name: VELORA_PACKAGE.name, version: "0.1.0", exports: { "./preview": { import: "./preview.js" } } }));
  await put(root, `node_modules/${VELORA_PACKAGE.name}/preview.js`, "export const ProjectPreview = () => null;");
  const init = await executeProjectCommand("init-project", {}, { root });
  expect(init.success, JSON.stringify(init)).toBe(true);
  return root;
}
const scenes = (root: string) => readdir(path.join(root, "src/velora/scenes")).catch(() => [] as string[]);

describe("velora new scene", () => {
  it("scaffolds an editable recipe and a binding around a named component", async () => {
    const root = await host();
    const result = await executeTemplateCommand("new-scene", { template: "hero-push", id: "home-hero", component: "src/components/Dashboard.tsx#Dashboard", set: { intensity: "standard", lens: "35" } }, { root });
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, data: { scene: "home-hero", template: "hero-push", slot: "component", files: ["src/velora/scenes/home-hero.scene.json", "src/velora/scenes/home-hero.tsx"] } });
    const recipe = SceneRecipeSchema.parse(JSON.parse(await readFile(path.join(root, "src/velora/scenes/home-hero.scene.json"), "utf8")));
    expect(recipe.template).toEqual({ id: "hero-push", version: 1, aspect: "16:9", params: { intensity: "standard", lens: 35, durationMs: 6000 } });
    expect(recipe.definition.scene.nodes).toEqual([{ id: "subject", transform: { x: 0, y: 0, z: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1 } }]);
    const binding = await readFile(path.join(root, "src/velora/scenes/home-hero.tsx"), "utf8");
    expect(binding).toContain(`import { Surface } from '${VELORA_PACKAGE.name}';`);
    expect(binding).toContain("import { Dashboard } from '../../components/Dashboard';");
    expect(binding).toContain('<Surface id="subject"');
    expect(binding).toContain("export default function HomeHero()");
    const catalog = await discoverRecipes(root);
    expect(catalog.issues).toEqual([]);
    expect(catalog.scenes.map(scene => scene.id)).toEqual(["home-hero"]);
  });
  it("slots a default export, a route (with a scroll channel) and a placeholder", async () => {
    const root = await host();
    expect((await executeTemplateCommand("new-scene", { template: "orbit-reveal", id: "app-orbit", component: "src/App.tsx" }, { root })).success).toBe(true);
    expect(await readFile(path.join(root, "src/velora/scenes/app-orbit.tsx"), "utf8")).toContain("import App from '../../App';");
    expect((await executeTemplateCommand("new-scene", { template: "scroll-through", id: "landing", route: "/pricing", aspect: "9:16" }, { root })).success).toBe(true);
    const route = await readFile(path.join(root, "src/velora/scenes/landing.tsx"), "utf8");
    expect(route).toContain(`import { RouteFrame } from '${VELORA_PACKAGE.name}/kit';`);
    expect(route).toContain('<RouteFrame route="/pricing" width={900} height={1600} scrollChannel="subject-scroll" />');
    const placeholder = await executeTemplateCommand("new-scene", { template: "float-loop", id: "hero-loop" }, { root });
    expect(placeholder).toMatchObject({ success: true, data: { slot: "placeholder" }, warnings: [{ code: "WARN_TEMPLATE_PLACEHOLDER" }] });
    expect(await readFile(path.join(root, "src/velora/scenes/hero-loop.tsx"), "utf8")).toContain("<SlotPlaceholder");
    expect((await discoverRecipes(root)).issues).toEqual([]);
  });
  it("refuses existing scenes, missing exports, bad routes, params and aspects before writing", async () => {
    const root = await host();
    expect((await executeTemplateCommand("new-scene", { template: "hero-push", id: "taken", route: "/" }, { root })).success).toBe(true);
    const binding = await readFile(path.join(root, "src/velora/scenes/taken.tsx"), "utf8");
    const cases: [Record<string, unknown>, string][] = [
      [{ template: "hero-push", id: "taken", route: "/" }, "ERR_SCENE_EXISTS"],
      [{ template: "hero-push", id: "a", component: "src/components/Dashboard.tsx#Missing" }, "ERR_COMPONENT_EXPORT_MISSING"],
      [{ template: "hero-push", id: "b", component: "src/components/Dashboard.tsx" }, "ERR_COMPONENT_EXPORT_MISSING"],
      [{ template: "hero-push", id: "c", component: "src/Nope.tsx#X" }, "ERR_COMPONENT_EXPORT_MISSING"],
      [{ template: "hero-push", id: "d", route: "https://evil.com" }, "ERR_ROUTE_INVALID"],
      [{ template: "hero-push", id: "d2", route: "C:/Program Files/Git/pricing" }, "ERR_ROUTE_INVALID"],
      [{ template: "hero-push", id: "e", route: "/", set: { lens: "500" } }, "ERR_TEMPLATE_PARAM"],
      [{ template: "website-hero-loop", id: "f", route: "/" }, "ERR_TEMPLATE_NOT_FOUND"],
      [{ template: "hero-push", id: "g", route: "/", aspect: "3:2" }, "ERR_TEMPLATE_ASPECT"],
      [{ template: "hero-push", id: "Bad_Id", route: "/" }, "invalid-input"],
    ];
    for (const [input, code] of cases) {
      const result = await executeTemplateCommand("new-scene", input, { root });
      expect(result, JSON.stringify(input)).toMatchObject({ success: false, issues: [{ code }] });
    }
    const rewritten = await executeTemplateCommand("new-scene", { template: "hero-push", id: "d3", route: "C:/Program Files/Git/" }, { root });
    expect(JSON.stringify(rewritten)).toContain("MSYS_NO_PATHCONV=1");
    expect((await scenes(root)).sort()).toEqual(["taken.scene.json", "taken.tsx"]);
    expect(await readFile(path.join(root, "src/velora/scenes/taken.tsx"), "utf8")).toBe(binding);
  });
  it("requires an initialized project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "velora-templates-bare-"));
    roots.push(root);
    expect(await executeTemplateCommand("new-scene", { template: "hero-push", id: "x", route: "/" }, { root })).toMatchObject({ success: false, issues: [{ code: "not-initialized" }] });
  });
});

describe("velora new video", () => {
  it("scaffolds a blueprint composition whose scenes validate and fill the timeline", async () => {
    const root = await host();
    const result = await executeTemplateCommand("new-video", { blueprint: "product-reel-20s", id: "reel", route: "/" }, { root });
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, data: { composition: "reel.composition.json", durationMs: 20000 } });
    const composition = CompositionSchema.parse(JSON.parse(await readFile(path.join(root, "reel.composition.json"), "utf8")));
    expect(composition.scenes.map(scene => [scene.recipe, scene.startMs, scene.durationMs])).toEqual([
      ["reel-1-hero-push", 0, 5000], ["reel-2-macro-detail", 5000, 5000], ["reel-3-scroll-through", 10000, 6000], ["reel-4-orbit-reveal", 16000, 4000],
    ]);
    expect((await discoverRecipes(root)).scenes.map(scene => scene.id).sort()).toEqual(composition.scenes.map(scene => scene.recipe).sort());
    const validated = await executeProjectCommand("validate-project", { composition: "reel.composition.json" }, { root });
    expect(validated.success, JSON.stringify(validated)).toBe(true);
  });
});

describe("generation helpers", () => {
  it("finds exports statically", () => {
    const source = "export default function Page(){}\nexport const A = 1;\nfunction B(){}\nexport { B as Card };\n";
    expect(componentExport(source, "x.tsx", undefined)).toEqual({ name: "Page", isDefault: true });
    expect(componentExport(source, "x.tsx", "Card")).toEqual({ name: "Card", isDefault: false });
    expect(componentExport(source, "x.tsx", "A")).toEqual({ name: "A", isDefault: false });
    expect(componentExport(source, "x.tsx", "B")).toBeUndefined();
    expect(componentExport("export const x = 1;", "x.ts", undefined)).toBeUndefined();
  });
  it("computes scene-relative imports", () => {
    expect(sceneImportPath("src/components/Dashboard.tsx")).toBe("../../components/Dashboard");
    expect(sceneImportPath("src/App.tsx")).toBe("../../App");
    expect(sceneImportPath("app/page.tsx")).toBe("../../../app/page");
  });
});
