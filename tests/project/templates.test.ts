import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeBrandCommand, executeEditorialCommand, executeProjectCommand, executeTemplateCommand } from "../../src/project/commands";
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
    expect(recipe.template).toEqual({ id: "hero-push", version: 1, aspect: "16:9", stage: "laptop-14", params: { intensity: "standard", lens: 35, durationMs: 6000 } });
    expect(recipe.definition.stage).toMatchObject({ width: 1512, height: 982, dpr: 2 });
    expect(recipe.definition.scene.nodes).toEqual([{ id: "subject", transform: { x: 0, y: 0, z: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1 } }]);
    const binding = await readFile(path.join(root, "src/velora/scenes/home-hero.tsx"), "utf8");
    expect(binding).toContain(`import { Surface, AppStage } from '${VELORA_PACKAGE.name}';`);
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
    expect(route).toContain('<RouteFrame route="/pricing" scrollChannel="subject-scroll" />');
    expect(route).toContain("<AppStage fit=");
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
      [{ template: "hero-push", id: "native", route: "/", stage: "user-native" }, "invalid-input"],
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

describe("Wave 2 scaffolding and brand", () => {
  it("writes a branded motion-graphics scene with kit imports and a default brand file", async () => {
    const root = await host();
    const result = await executeTemplateCommand("new-scene", { template: "title-reveal", id: "opener", set: { title: "Hello\\nworld", subtitle: "Launch day" } }, { root });
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, data: { files: ["src/velora/scenes/opener.scene.json", "src/velora/scenes/opener.tsx", "velora.brand.json"] } });
    const binding = await readFile(path.join(root, "src/velora/scenes/opener.tsx"), "utf8");
    expect(binding).toContain(`import { Backdrop, BrandProvider, Title } from '${VELORA_PACKAGE.name}/kit';`);
    expect(binding).toContain("import brand from '../../../velora.brand.json';");
    expect(binding).toContain("<BrandProvider brand={brand}>");
    expect(binding).toContain('<Surface id="title"');
    // A CLI "\n" becomes a real line break, written as an escaped JSX string.
    expect(binding).toContain('text={"Hello\\nworld"}');
    expect(binding).not.toContain("SlotPlaceholder");
    const recipe = SceneRecipeSchema.parse(JSON.parse(await readFile(path.join(root, "src/velora/scenes/opener.scene.json"), "utf8")));
    expect(recipe.definition.scene.nodes.map(node => node.id)).toEqual(["backdrop", "title"]);
    expect(JSON.parse(await readFile(path.join(root, "velora.brand.json"), "utf8"))).toMatchObject({ version: 1, name: "Host", motion: "calm" });
    expect((await discoverRecipes(root)).issues).toEqual([]);
    // A second branded scene leaves the existing brand file alone.
    const second = await executeTemplateCommand("new-scene", { template: "end-card", id: "closer" }, { root });
    expect(second).toMatchObject({ success: true, data: { files: ["src/velora/scenes/closer.scene.json", "src/velora/scenes/closer.tsx"] } });
  });
  it("slots a route into a layered template and names every surface", async () => {
    const root = await host();
    expect((await executeTemplateCommand("new-scene", { template: "device-showcase", id: "showcase", route: "/", set: { device: "phone" } }, { root })).success).toBe(true);
    const binding = await readFile(path.join(root, "src/velora/scenes/showcase.tsx"), "utf8");
    expect(binding).toContain("<PhoneFrame");
    expect(binding).toContain('<RouteFrame route="/" />');
    expect(binding).toContain("<AppStage fit=");
    for (const id of ["backdrop", "shadow", "subject"]) expect(binding).toContain(`<Surface id="${id}"`);
    expect((await executeTemplateCommand("new-scene", { template: "cursor-demo", id: "demo", component: "src/components/Dashboard.tsx#Dashboard" }, { root })).success).toBe(true);
    expect(await readFile(path.join(root, "src/velora/scenes/demo.tsx"), "utf8")).toContain('<Cursor id="cursor" skin="pointer" />');
    expect((await discoverRecipes(root)).issues).toEqual([]);
  });
  it("rejects over-long text params", async () => {
    const root = await host();
    expect(await executeTemplateCommand("new-scene", { template: "lower-third", id: "lt", set: { label: "x".repeat(80) } }, { root })).toMatchObject({ success: false, issues: [{ code: "ERR_TEMPLATE_PARAM" }] });
  });
  it("brand init seeds tokens from CSS, refuses to overwrite, and brand check validates", async () => {
    const root = await host();
    await put(root, "src/index.css", ":root { --primary: #ff6600; --font-sans: 'Geist', sans-serif; --radius: 0.5rem; }");
    const init = await executeBrandCommand("brand-init", { fromCss: "src/index.css" }, { root });
    expect(init, JSON.stringify(init)).toMatchObject({ success: true, data: { brand: { name: "Host", colors: { primary: "#ff6600" }, radius: 8 }, fromCss: { colors: ["primary"] } } });
    expect(await executeBrandCommand("brand-init", {}, { root })).toMatchObject({ success: false, issues: [{ code: "output-exists" }] });
    expect(await executeBrandCommand("brand-check", {}, { root })).toMatchObject({ success: true });
    await writeFile(path.join(root, "velora.brand.json"), JSON.stringify({ version: 1, name: "X", motion: "frantic" }));
    expect(await executeBrandCommand("brand-check", {}, { root })).toMatchObject({ success: false, issues: [{ code: "ERR_BRAND_INVALID", path: "velora.brand.json#motion" }] });
    expect(await executeBrandCommand("brand-init", { fromCss: "src/missing.css" }, { root: await host() })).toMatchObject({ success: false, issues: [{ code: "invalid-input" }] });
  });
});

describe("Wave 3 blueprints and editorial commands", () => {
  it.each(["launch-film-30s", "feature-drop-15s", "social-teaser-9x16", "changelog-20s", "product-hunt-kit", "app-preview-25s"])("scaffolds %s into a valid composition", async blueprint => {
    const root = await host();
    const result = await executeTemplateCommand("new-video", { blueprint, id: "film", route: "/" }, { root });
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    const composition = CompositionSchema.parse(JSON.parse(await readFile(path.join(root, "film.composition.json"), "utf8")));
    const validated = await executeProjectCommand("validate-project", { composition: "film.composition.json" }, { root });
    expect(validated.success, JSON.stringify(validated)).toBe(true);
    expect(await readFile(path.join(root, "film.brief.md"), "utf8")).toContain("## Shot list");
    expect(composition.markers.some(marker => marker.kind === "section")).toBe(true);
    // Shipped defaults are review-clean on the platform each blueprint targets.
    const platform = ({ "launch-film-30s": "youtube-1080p", "feature-drop-15s": "x-landscape", "social-teaser-9x16": "tiktok", "changelog-20s": "linkedin", "product-hunt-kit": "product-hunt-gallery", "app-preview-25s": undefined } as Record<string, string | undefined>)[blueprint];
    const reviewed = await executeEditorialCommand("review", { composition: "film.composition.json", ...(platform ? { platform } : {}) }, { root });
    expect(reviewed, JSON.stringify(reviewed)).toMatchObject({ success: true, data: { advisories: [] } });
    if (blueprint === "launch-film-30s") {
      expect(composition.scenes.map(scene => scene.transition?.type ?? "cut")).toEqual(["cut", "whip", "crossfade", "dip-to-black", "push", "crossfade"]);
      expect(composition.overlays).toHaveLength(1);
      expect(composition.captions).toEqual({ file: "film.captions.srt", burnIn: false, style: "karaoke" });
      const overlay = await readFile(path.join(root, `src/velora/scenes/${composition.overlays[0].recipe}.tsx`), "utf8");
      expect(overlay).not.toContain("<Backdrop");
      const end = composition.scenes.at(-1)!;
      expect(end.startMs + end.durationMs).toBeGreaterThan(29_000);
    }
  }, 60_000);
  it("detects beats, writes markers, snaps cuts only with --write, and reviews", async () => {
    const root = await host();
    expect((await executeTemplateCommand("new-video", { blueprint: "product-reel-20s", id: "reel", route: "/" }, { root })).success).toBe(true);
    // A 120 BPM click track (8 kHz mono WAV) as the music bed.
    const rate = 8000, samples = new Int16Array(rate * 22);
    for (let beat = 0; beat * 500 < 22_000; beat++) { const start = Math.round(beat * 0.5 * rate); for (let s = 0; s < 240 && start + s < samples.length; s++) samples[start + s] = Math.round(20000 * Math.sin((2 * Math.PI * 1500 * s) / rate) * Math.exp(-s / 50)); }
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(36 + samples.byteLength, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(samples.byteLength, 40);
    await put(root, "assets/bed.wav", "");
    await writeFile(path.join(root, "assets/bed.wav"), Buffer.concat([header, Buffer.from(samples.buffer)]));
    const beats = await executeEditorialCommand("audio-beats", { file: "assets/bed.wav", composition: "reel.composition.json", writeMarkers: true }, { root });
    expect(beats, JSON.stringify(beats)).toMatchObject({ success: true, command: "audio" });
    const data = (beats as { data: { bpm: number; markersWritten: number } }).data;
    expect(Math.abs(data.bpm - 120)).toBeLessThanOrEqual(1);
    expect(data.markersWritten).toBeGreaterThan(30);
    const before = await readFile(path.join(root, "reel.composition.json"), "utf8");
    const dry = await executeEditorialCommand("compose-snap", { composition: "reel.composition.json", to: "beats" }, { root });
    expect(dry).toMatchObject({ success: true, data: { written: false } });
    expect(await readFile(path.join(root, "reel.composition.json"), "utf8")).toBe(before);
    const review = await executeEditorialCommand("review", { composition: "reel.composition.json", platform: "youtube-1080p" }, { root });
    expect(review).toMatchObject({ success: true, command: "review", data: { requiresVisualReview: true } });
    expect(await executeEditorialCommand("compose-snap", { composition: "missing.composition.json" }, { root })).toMatchObject({ success: false });
    const bare = await host();
    expect((await executeTemplateCommand("new-video", { blueprint: "product-reel-20s", id: "reel", route: "/" }, { root: bare })).success).toBe(true);
    expect(await executeEditorialCommand("compose-snap", { composition: "reel.composition.json" }, { root: bare })).toMatchObject({ success: false, issues: [{ code: "ERR_MARKERS_MISSING" }] });
  }, 60_000);
});
