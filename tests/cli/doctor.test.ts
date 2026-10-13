import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { runCli } from "../../src/cli";
import { CLI_ERROR_CODES, CliEnvelopeSchema, DoctorResultSchema } from "../../src/core/cli-schema";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function put(root: string, file: string, text: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
// Minimal healthy host: single-root npm + Vite + React 19 + installed toolkit.
async function healthyHost() {
  const root = await mkdtemp(path.join(tmpdir(), "velora-doctor-"));
  roots.push(root);
  await put(root, "package.json", JSON.stringify({
    name: "host", scripts: { dev: "vite" },
    dependencies: { react: "^19.2.0", "react-dom": "^19.2.0", "@webprodigies/flute": "0.1.0" },
    devDependencies: { vite: "^7.3.6" },
  }));
  await put(root, "package-lock.json", '{"lockfileVersion":3}');
  await put(root, "index.html", '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  await put(root, "vite.config.ts", 'import {defineConfig} from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({plugins:[react()]});');
  await put(root, "src/main.tsx", "export {};\n");
  await put(root, "node_modules/react/package.json", '{"name":"react","version":"19.2.0"}');
  await put(root, "node_modules/react-dom/package.json", '{"name":"react-dom","version":"19.2.0"}');
  await put(root, "node_modules/@webprodigies/flute/package.json", JSON.stringify({ name: "@webprodigies/flute", version: "0.1.0", exports: { "./preview": { import: "./preview.js" } } }));
  await put(root, "node_modules/@webprodigies/flute/preview.js", "export const ProjectPreview = () => null;");
  return root;
}
async function loopbackServer() {
  const instance = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html></html>");
  });
  servers.push(instance);
  await new Promise<void>((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", resolve);
  });
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  return `http://127.0.0.1:${address.port}`;
}

describe("velora doctor", () => {
  it("diagnoses an empty directory with catalog codes and a valid envelope", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "velora-doctor-empty-"));
    roots.push(root);
    const result = await runCli(["doctor", "--project", root, "--json"], { root });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    const body = JSON.parse(result.stderr);
    expect(DoctorResultSchema.safeParse(body).success, result.stderr).toBe(true);
    expect(CliEnvelopeSchema.safeParse({ success: false, issues: body.issues }).success).toBe(true);
    expect(body.command).toBe("doctor");
    for (const issue of body.issues) {
      expect(CLI_ERROR_CODES).toContain(issue.code);
      expect(issue.hint.length).toBeGreaterThan(0);
    }
    const ids = body.data.checks.map((check: { id: string }) => check.id);
    for (const id of ["scope", "node", "package", "react", "toolkit", "scenes", "ffmpeg", "chromium"]) expect(ids).toContain(id);
  }, 30000);
  it("reports real project health for a healthy host", async () => {
    const root = await healthyHost();
    const result = await runCli(["doctor", "--project", root, "--json"], { root });
    const body = JSON.parse(result.code === 0 ? result.stdout : result.stderr);
    expect(DoctorResultSchema.safeParse(body).success).toBe(true);
    const byId = Object.fromEntries(body.data.checks.map((check: { id: string; pass: boolean }) => [check.id, check.pass]));
    // Project-side facts hold regardless of FFmpeg/Chromium presence on the machine.
    for (const id of ["scope", "node", "package", "react", "toolkit", "scenes"]) expect(byId[id]).toBe(true);
    expect(typeof byId.ffmpeg).toBe("boolean");
    expect(typeof byId.chromium).toBe("boolean");
    // Exit code follows the full check set, including real capture probes.
    expect(result.code).toBe(byId.ffmpeg && byId.chromium ? 0 : 1);
  }, 30000);
  it("probes dev-server reachability only when --url is given", async () => {
    const root = await healthyHost();
    const first = await runCli(["doctor", "--project", root, "--json"], { root });
    const without = JSON.parse(first.code === 0 ? first.stdout : first.stderr);
    expect(without.data.checks.some((check: { id: string }) => check.id === "dev-server")).toBe(false);
    const origin = await loopbackServer();
    const reachable = await runCli(["doctor", "--project", root, "--url", origin, "--json"], { root });
    const reachableBody = JSON.parse(reachable.code === 0 ? reachable.stdout : reachable.stderr);
    expect(reachableBody.data.checks.find((check: { id: string }) => check.id === "dev-server")).toMatchObject({ pass: true });
    const closed = await runCli(["doctor", "--project", root, "--url", "http://127.0.0.1:1", "--json"], { root });
    expect(closed.code).toBe(1);
    const closedBody = JSON.parse(closed.stderr);
    expect(closedBody.data.checks.find((check: { id: string }) => check.id === "dev-server")).toMatchObject({ pass: false });
    expect(closedBody.issues.map((issue: { code: string }) => issue.code)).toContain("ERR_SERVER_UNREACHABLE");
  }, 30000);
  it("renders human-readable checks without JSON", async () => {
    const root = await healthyHost();
    const result = await runCli(["doctor", "--project", root], { root });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("FFmpeg");
    expect(combined).toContain("Node runtime");
    // Human mode never emits the JSON envelope.
    expect(combined).not.toContain('"success":');
  }, 30000);
});
