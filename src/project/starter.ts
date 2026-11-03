import { VELORA_PACKAGE } from "../core/branding";
import { BrandSchema } from "../core/brand";
import { BLUEPRINT_CATALOG } from "../core/templates";

/** SOURCE OF TRUTH: starterFiles, STARTER_DEPENDENCIES.
 * WHAT: the file set of `velora create <dir>`: a blank Vite React host with a branded landing page to film,
 * velora.brand.json, a README with the five-minute path, and npm scripts that initialize Velora, install the
 * skills and scaffold a launch blueprint after `npm install`.
 * WHY: teams without a React app still need a stage for motion graphics, screen recordings and (with
 * any-site mode) routes of their real site; the starter gets them to a first render in minutes.
 * WHERE: project/commands executeCreateCommand writes these files create-only; cli `create` adapts arguments.
 */
export const STARTER_DEPENDENCIES = Object.freeze({
  dependencies: { react: "^19.2.0", "react-dom": "^19.2.0" },
  devDependencies: { vite: "^7.3.6", "@vitejs/plugin-react": "^5.1.0", "@types/react": "^19.2.0", "@types/react-dom": "^19.2.0", typescript: "^5.9.0" },
});
export type StarterInput = { name: string; slug: string; packageVersion: string; blueprint: string };
export function starterBlueprintIds(): string[] {
  return BLUEPRINT_CATALOG.map(blueprint => blueprint.id);
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export function starterFiles(input: StarterInput): Record<string, string> {
  const { name, slug, packageVersion, blueprint } = input;
  const safeName = name.replace(/[<>&"'`$\\{}]/g, "").trim() || "Your product";
  const brand = BrandSchema.parse({ version: 1, name: safeName, motion: "crisp" });
  return {
    "package.json": json({
      name: slug, private: true, version: "0.0.0", type: "module",
      scripts: {
        dev: "vite --host 127.0.0.1",
        build: "vite build",
        "velora:setup": `velora init && velora skills install --agent claude && velora new video --blueprint ${blueprint} --id launch --route /`,
        "velora:studio": "velora open --url http://127.0.0.1:5173",
      },
      dependencies: STARTER_DEPENDENCIES.dependencies,
      devDependencies: { ...STARTER_DEPENDENCIES.devDependencies, [VELORA_PACKAGE.name]: `^${packageVersion}` },
    }),
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    "vite.config.mjs": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
`,
    "tsconfig.json": json({
      compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", strict: true, skipLibCheck: true, noEmit: true },
      include: ["src"],
    }),
    "src/main.tsx": `import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
`,
    "src/App.tsx": `// The page Velora films. Replace it with your product's story, screenshots (assets/) or embedded demo.
const FEATURES = [
  { title: "Fast setup", body: "Live in minutes, not sprints." },
  { title: "Real insight", body: "Every number explained in plain words." },
  { title: "Built to share", body: "One link for the whole team." },
];

export function App() {
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Introducing</p>
        <h1>${safeName}</h1>
        <p className="lede">One sentence that says what it does and who it is for.</p>
        <a className="cta" href="#start">Get started</a>
      </header>
      <section className="features" id="start">
        {FEATURES.map(feature => (
          <article key={feature.title}>
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
`,
    "src/index.css": `:root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: ${brand.colors.background}; color: ${brand.colors.text}; }
body { margin: 0; }
.page { min-height: 100vh; padding: 72px 8vw; box-sizing: border-box; }
.hero { max-width: 760px; }
.eyebrow { color: ${brand.colors.accent}; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; }
h1 { font-size: clamp(48px, 8vw, 96px); line-height: 1; margin: 0.2em 0; }
.lede { font-size: 22px; color: ${brand.colors.muted}; }
.cta { display: inline-block; margin-top: 24px; padding: 14px 24px; border-radius: ${brand.radius}px; background: ${brand.colors.accent}; color: #fff; text-decoration: none; font-weight: 600; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-top: 72px; }
.features article { padding: 24px; border-radius: ${brand.radius}px; background: ${brand.colors.surface}; }
.features h2 { margin: 0 0 8px; font-size: 20px; }
.features p { margin: 0; color: ${brand.colors.muted}; }
`,
    "velora.brand.json": json({ $schema: `./node_modules/${VELORA_PACKAGE.name}/schemas/brand.schema.json`, ...brand }),
    ".gitignore": "node_modules/\ndist/\n.velora/cache/\n*.mp4\n*.webm\ndeliverables/\n",
    "README.md": `# ${safeName} launch studio

A blank React stage for Velora: motion graphics, product shots of this page, and launch deliverables.
Real-UI shots of an existing product need a React host (run \`npx velora init\` there) or any-site mode
(\`npx velora studio --site <url>\` for Astro, SvelteKit, Rails or static sites).

## Five minutes to a first render

\`\`\`sh
npm install
npm run velora:setup        # velora init, skills for your agent, the ${blueprint} blueprint
npm run dev                 # keep it running
npx velora doctor --url http://127.0.0.1:5173 --json
npx velora frames --composition launch.composition.json --out board --every 30 --contact-sheet --url http://127.0.0.1:5173 --json
npx velora render --composition launch.composition.json --out launch.mp4 --quality draft --url http://127.0.0.1:5173 --json
\`\`\`

Then edit \`velora.brand.json\` and \`src/App.tsx\`, read \`launch.brief.md\`, and ask your coding agent:
\`npx velora prompts show --id launch-film\`. Ship every platform at once with
\`npx velora deliver --composition launch.composition.json --targets youtube,reels,website-hero,og-image --json\`.
`,
  };
}
