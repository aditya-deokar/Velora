import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { runCli } from "../../src/cli";

const repository = process.cwd();
export const sceneFile = "src/velora/scenes/home-hero.scene.json";
export type StageProbe = { width: number; height: number; dpr: number; wide: boolean; backing: number; rect: number[] };
const route = `<!doctype html><meta charset="utf-8" />
<style>body{margin:0;background:#ecf2fa}button{position:absolute;left:702px;top:422px;width:108px;height:44px}
canvas{position:absolute;left:683px;top:469px;width:146px;height:44px}</style>
<button>Revenue</button><canvas></canvas>
<script>
const canvas = document.querySelector("canvas");
canvas.width = 146 * devicePixelRatio;
canvas.height = 44 * devicePixelRatio;
const context = canvas.getContext("2d");
for (let x = 0; x < canvas.width; x++) {
  context.fillStyle = x % 3 === 0 ? "#073b7e" : "#aeeafd";
  context.fillRect(x, 0, 1, canvas.height);
}
const rect = document.querySelector("button").getBoundingClientRect();
const probe = {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,wide:matchMedia("(min-width:1500px)").matches,
  backing:canvas.width,rect:[rect.x,rect.y,rect.width,rect.height]};
document.body.dataset.stageProbe = JSON.stringify(probe);
fetch("/stage-probe", {method:"POST",body:JSON.stringify(probe)});
</script>`;

export async function withStageProject(run: (fixture: { root: string; url: string; probes: StageProbe[] }) => Promise<void>) {
  const root = await mkdtemp(path.join(repository, ".test-dist", "stage-host-"));
  const put = (file: string, value: string) => writeFile(path.join(root, file), value);
  const probes: StageProbe[] = [];
  let dev: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    const id = randomUUID();
    await mkdir(path.join(root, ".velora"));
    await mkdir(path.join(root, "__velora"));
    await mkdir(path.join(root, "app"));
    await put(".velora/project.json", JSON.stringify({ version: 1, projectId: id, entry: "main.tsx", packageManager: "npm", adapter: "site", site: "http://127.0.0.1:5555" }));
    await put("app/index.html", route);
    await put("__velora/index.html", `<!doctype html><meta name="velora-project" content="${id}"><div id="root"></div><script type="module" src="/main.tsx"></script>`);
    await put("main.tsx", `import {createRoot} from 'react-dom/client';
      import {ProjectPreview} from '@adityadeokar/velora/preview';
      createRoot(document.querySelector('#root')!).render(<ProjectPreview projectId=${JSON.stringify(id)} enabled hot={import.meta.hot}
        sceneModules={import.meta.glob('/src/velora/scenes/*.{scene.json,tsx,jsx}')} compositionModules={import.meta.glob('/*.composition.json')}/>);`);
    const scaffolded = await runCli(["new", "scene", "--template", "hero-push", "--id", "home-hero", "--route", "/app/", "--stage", "laptop-14", "--json"], { root });
    if (scaffolded.code) throw new Error(scaffolded.stderr);
    dev = await createServer({ root, configFile: false, plugins: [react(), {
      name: "stage-probe",
      configureServer(server) {
        server.middlewares.use("/stage-probe", (request, response) => {
          let body = "";
          request.on("data", data => { body += data; });
          request.on("end", () => { probes.push(JSON.parse(body)); response.end(); });
        });
      },
    }], cacheDir: path.join(root, ".vite"), resolve: { alias: [
      { find: /^@adityadeokar\/velora$/, replacement: path.join(repository, "src/index.ts") },
      { find: "@adityadeokar/velora/preview", replacement: path.join(repository, "src/preview/index.tsx") },
      { find: "@adityadeokar/velora/kit", replacement: path.join(repository, "src/kit/index.ts") },
    ], dedupe: ["react", "react-dom"] }, server: { host: "127.0.0.1", port: 0, fs: { allow: [repository] } } });
    await dev.listen();
    const address = dev.httpServer!.address() as { port: number };
    await run({ root, url: `http://127.0.0.1:${address.port}`, probes });
  } finally {
    await dev?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
