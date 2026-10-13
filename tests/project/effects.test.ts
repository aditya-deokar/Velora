import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeProjectCommand } from "../../src/project/commands";

let root: string;
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function put(file: string, content: string | Buffer) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), content);
}
const recipeDoc = { version: 1, id: "demo", title: "Demo", definition: { width: 128, height: 96, scene: { nodes: [{ id: "main" }] } } };
function compositionDoc(scenes: unknown) {
  return { version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 0, scenes, assets: [] };
}
async function initialized() {
  root = await mkdtemp(path.join(tmpdir(), "flute-effects-"));
  await put("package.json", JSON.stringify({ name: "host", scripts: { dev: "vite" },
    dependencies: { react: "^19.2.0", "react-dom": "^19.2.0", "@webprodigies/flute": "0.1.0" }, devDependencies: { vite: "^7.3.6" } }));
  await put("package-lock.json", '{"lockfileVersion":3}');
  await put("index.html", '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  await put("vite.config.ts", 'import {defineConfig} from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({plugins:[react()]});');
  await put("src/main.tsx", 'import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\ncreateRoot(document.getElementById("root")!).render(<StrictMode><div/></StrictMode>);\n');
  await put("node_modules/react/package.json", '{"name":"react","version":"19.2.0"}');
  await put("node_modules/react-dom/package.json", '{"name":"react-dom","version":"19.2.0"}');
  await put("node_modules/@webprodigies/flute/package.json", JSON.stringify({ name: "@webprodigies/flute", version: "0.1.0", exports: { "./preview": { import: "./preview.js" } } }));
  await put("node_modules/@webprodigies/flute/preview.js", "export const ProjectPreview = () => null;");
  await put("src/flute/scenes/demo.scene.json", JSON.stringify(recipeDoc));
  await put("src/flute/scenes/demo.tsx", "export default function Demo() { return null; }");
  expect(await executeProjectCommand("init-project", {}, { root })).toMatchObject({ success: true });
}
const validate = (composition?: string) => executeProjectCommand("validate-project", composition ? { composition } : {}, { root });

describe("transition declarations", () => {
  it("accepts sane declarations and rejects overruns, leafless scenes and unknown types", async () => {
    await initialized();
    await put("teaser.composition.json", JSON.stringify(compositionDoc([
      { id: "s1", recipe: "demo", startMs: 0, durationMs: 2000, transition: { type: "dissolve", durationMs: 500 } },
      { id: "s2", recipe: "demo", startMs: 2000, durationMs: 2000, transition: { type: "depth-dolly", durationMs: 800 } },
    ])));
    expect(await validate("teaser.composition.json")).toMatchObject({ success: true });
    await put("teaser.composition.json", JSON.stringify(compositionDoc([
      { id: "s1", recipe: "demo", startMs: 0, durationMs: 2000, transition: { type: "slide-push", durationMs: 5000 } },
    ])));
    const overrun = await validate("teaser.composition.json");
    expect(overrun.success).toBe(false);
    expect(!overrun.success && overrun.issues.map((i) => `${i.code} ${i.path}`)).toContain("ERR_TRANSITION_INVALID composition.scenes.0.transition.durationMs");
    await put("src/flute/scenes/demo.scene.json", JSON.stringify({ ...recipeDoc, definition: { ...recipeDoc.definition, scene: { nodes: [] } } }));
    await put("teaser.composition.json", JSON.stringify(compositionDoc([
      { id: "s1", recipe: "demo", startMs: 0, durationMs: 2000, transition: { type: "dissolve", durationMs: 500 } },
    ])));
    const leafless = await validate("teaser.composition.json");
    expect(leafless.success).toBe(false);
    expect(!leafless.success && leafless.issues.map((i) => i.code)).toContain("ERR_TRANSITION_INVALID");
    await put("teaser.composition.json", JSON.stringify(compositionDoc([
      { id: "s1", recipe: "demo", startMs: 0, durationMs: 2000, transition: { type: "melt", durationMs: 500 } },
    ])));
    expect(await validate("teaser.composition.json")).toMatchObject({ success: false, issues: [{ code: "ERR_COMPOSITION_INVALID" }] });
  }, 60_000);
});

describe("render-path clock discipline", () => {
  it("rejects ScrollTrigger, ticker and rAF clocks with file and line", async () => {
    await initialized();
    await put("src/flute/scenes/demo.tsx", "import { ScrollTrigger } from 'gsap/ScrollTrigger';\nexport default function Demo() { return null; }");
    const scrolled = await validate();
    expect(scrolled.success).toBe(false);
    expect(!scrolled.success && scrolled.issues).toMatchObject([{ code: "ERR_ANIMATION_CLOCK", path: "src/flute/scenes/demo.tsx:1" }]);
    await put("src/flute/scenes/demo.tsx", "import { gsap } from 'gsap';\ngsap.ticker.add(() => {});\nexport default function Demo() { return null; }");
    expect(await validate()).toMatchObject({ success: false, issues: [{ code: "ERR_ANIMATION_CLOCK", path: "src/flute/scenes/demo.tsx:2" }] });
    await put("src/flute/scenes/demo.tsx", "export default function Demo() { return null; }");
    await put("src/flute/components/helper.tsx", "export function loop() {\n requestAnimationFrame(loop);\n}\n");
    expect(await validate()).toMatchObject({ success: false, issues: [{ code: "ERR_ANIMATION_CLOCK", path: "src/flute/components/helper.tsx:2" }] });
  }, 60_000);
});
