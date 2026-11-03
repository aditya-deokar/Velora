import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeProjectCommand, executeStudioCommand, previewBase } from "../../src/project/commands";
import { STUDIO_PROXY_PATTERN, isLoopbackUrl, loopbackOrigin, studioRunConfig, studioWorkspaceFiles } from "../../src/project/studio";
import { ProjectStateSchema } from "../../src/core/project";
import { runCli } from "../../src/cli";

let root: string;
const servers: Server[] = [];
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "velora-site-")); });
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});
async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

describe("any-site plan (pure)", () => {
  it("accepts only credential-free http(s) loopback URLs", () => {
    for (const ok of ["http://127.0.0.1:4321", "http://localhost:3000/", "https://localhost", "http://[::1]:8080/docs?x=1"]) expect(isLoopbackUrl(ok), ok).toBe(true);
    for (const bad of ["http://example.com", "http://127.0.0.2:80", "ftp://localhost", "http://user:pw@localhost:3000", "http://localhost:99999", "localhost:3000", "http://localhost.evil.com"])
      expect(isLoopbackUrl(bad), bad).toBe(false);
    expect(loopbackOrigin("HTTP://LocalHost:4321/pricing")).toBe("http://localhost:4321");
  });
  it("proxies every path except the studio base and Vite internals", () => {
    const proxied = new RegExp(STUDIO_PROXY_PATTERN);
    for (const pathname of ["/", "/pricing", "/assets/site.css", "/ws", "/_astro/x.js", "/__veloraX"]) expect(proxied.test(pathname), pathname).toBe(true);
    for (const pathname of ["/__velora/", "/__velora", "/__velora/main.tsx", "/@vite/client", "/@fs/C:/x", "/@id/react", "/node_modules/.vite/deps/react.js"]) expect(proxied.test(pathname), pathname).toBe(false);
  });
  it("pins the workspace, aliases Velora to the running package and serves under /__velora/", () => {
    const files = studioWorkspaceFiles("1.2.3");
    expect(JSON.parse(files["package.json"]).dependencies).toEqual({ react: "19.2.0", "react-dom": "19.2.0", vite: "7.3.6", "@vitejs/plugin-react": "5.1.0" });
    expect(files["vite.config.mjs"]).toContain('base: "/__velora/"');
    expect(files["vite.config.mjs"]).toContain('dedupe: ["react", "react-dom"]');
    expect(files["vite.config.mjs"]).toContain('delete response.headers["x-frame-options"]');
    expect(files["vite.config.mjs"]).toContain("ws: true");
    expect(files["main.tsx"]).toContain('import.meta.glob("@velora-project/src/velora/scenes/*.{scene.json,tsx,jsx}")');
    const config = JSON.parse(studioRunConfig({ projectRoot: "C:\\site", projectId: "id", site: "http://localhost:4321/x", port: 5180, packageRoot: "C:\\pkg" }));
    expect(config).toEqual({ projectRoot: "C:/site", projectId: "id", site: "http://localhost:4321", port: 5180, packageRoot: "C:/pkg" });
  });
});

describe("velora studio", () => {
  it("records a site project without touching dependencies, and validates its scenes", async () => {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "astro-site", dependencies: { astro: "^5.0.0" } }));
    const result = await executeStudioCommand("studio-init", { site: "http://localhost:4321/" }, { root });
    expect(result).toMatchObject({ success: true, data: { site: "http://localhost:4321", project: { adapter: "site", site: "http://localhost:4321" } } });
    const state = ProjectStateSchema.parse(JSON.parse(await readFile(path.join(root, ".velora/project.json"), "utf8")));
    expect(JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))).toEqual({ name: "astro-site", dependencies: { astro: "^5.0.0" } });
    expect(await readFile(path.join(root, "VELORA.md"), "utf8")).toContain("velora guide");
    // Re-running keeps the project identity; a new site origin updates it.
    const again = await executeStudioCommand("studio-init", { site: "http://127.0.0.1:4000" }, { root });
    expect(again).toMatchObject({ success: true, data: { project: { projectId: state.projectId, site: "http://127.0.0.1:4000" } } });
    await mkdir(path.join(root, "src/velora/scenes"), { recursive: true });
    await writeFile(path.join(root, "src/velora/scenes/home.scene.json"), JSON.stringify({ version: 1, id: "home", title: "Home", definition: { scene: { nodes: [{ id: "subject" }] } } }));
    await writeFile(path.join(root, "src/velora/scenes/home.jsx"), "export default function Home() { return null; }\n");
    const validated = await executeProjectCommand("validate-project", {}, { root });
    expect(validated, JSON.stringify(validated)).toMatchObject({ success: true });
    expect(await previewBase(root, "http://127.0.0.1:5180")).toBe("http://127.0.0.1:5180/__velora/");
    expect(await executeProjectCommand("sync-project", {}, { root })).toMatchObject({ success: true, data: { changed: false } });
    expect(await executeProjectCommand("init-project", {}, { root })).toMatchObject({ success: false, issues: [{ code: "unsupported-project", message: expect.stringContaining("velora studio --site") }] });
  });
  it("uses the origin root as preview base for React hosts", async () => {
    expect(await previewBase(root, "http://127.0.0.1:5173/anything")).toBe("http://127.0.0.1:5173/");
  });
  it("refuses non-loopback sites, React-connected projects and missing sites", async () => {
    expect(await executeStudioCommand("studio-init", { site: "https://example.com" }, { root })).toMatchObject({ success: false, issues: [{ code: "ERR_SITE_NOT_LOOPBACK" }] });
    expect(await executeStudioCommand("studio-check", {}, { root })).toMatchObject({ success: false, issues: [{ code: "ERR_MISSING_VALUE" }] });
    await mkdir(path.join(root, ".velora"));
    await writeFile(path.join(root, ".velora/project.json"), JSON.stringify({ version: 1, projectId: "00000000-0000-4000-8000-000000000000", entry: "src/main.tsx", packageManager: "npm" }));
    expect(await executeStudioCommand("studio-init", { site: "http://localhost:4321" }, { root })).toMatchObject({ success: false, issues: [{ code: "conflict" }] });
  });
  it("diagnoses an unreachable site and an off-machine redirect before provisioning anything", async () => {
    const closed = await serve((_request, response) => response.end("x"));
    await new Promise(resolve => servers.pop()!.close(resolve));
    expect(await executeStudioCommand("studio-check", { site: closed }, { root })).toMatchObject({ success: false, issues: [{ code: "ERR_SITE_UNREACHABLE" }] });
    const redirecting = await serve((_request, response) => { response.writeHead(302, { location: "https://example.com/login" }); response.end(); });
    expect(await executeStudioCommand("studio-check", { site: redirecting }, { root })).toMatchObject({ success: false, issues: [{ code: "ERR_SITE_REDIRECT_EXTERNAL", message: expect.stringContaining("example.com") }] });
  });
  it("is wired into the CLI", async () => {
    const init = await runCli(["studio", "init", "--site", "http://127.0.0.1:4321", "--json"], { root });
    expect(init.code).toBe(0);
    expect(JSON.parse(init.stdout)).toMatchObject({ success: true, command: "studio" });
    expect((await runCli(["studio", "--site"], { root })).code).toBe(2);
    expect((await runCli(["studio", "start"], { root })).code).toBe(2);
    expect((await runCli(["studio", "--port", "x", "--site", "http://127.0.0.1:1"], { root })).code).toBe(2);
    expect((await runCli(["studio", "--help"], { root })).stdout).toContain("/__velora/");
  });
});
