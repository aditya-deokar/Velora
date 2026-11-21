import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startSceneBridge } from "../../src/project/edit";
import { outlineSource } from "../../src/project/source";

const origin = "http://127.0.0.1:4321";
const jsx = "src/velora/scenes/design.jsx", recipe = "src/velora/scenes/design.scene.json";
const text = "export default function Design(){ return <h1>Proof</h1>; }\n";
const scene = JSON.stringify({ version: 1, id: "design", title: "Design", definition: { scene: { nodes: [] } } });
let root: string, bridge: Awaited<ReturnType<typeof startSceneBridge>>;
const file = (relative: string) => path.join(root, relative);
const read = (relative: string) => readFile(file(relative), "utf8");
const write = async (relative: string, content: string) => { await mkdir(path.dirname(file(relative)), { recursive: true }); await writeFile(file(relative), content); };
const request = { kind: "wrap", file: jsx, scene: "design", node: outlineSource(jsx, text).nodes[0].path, id: "headline" };
const outline = (file: string) => `outline?${new URLSearchParams({ file })}`;
const call = async (route: string, body?: unknown, access = bridge.token) => {
  const response = await fetch(`${bridge.server.origin}/v1/source/${route}`, {
    method: body === undefined ? "GET" : "POST", headers: { origin, authorization: `Bearer ${access}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-source-security-"));
  await write(jsx, text); await write(recipe, scene);
  bridge = await startSceneBridge(root, { origin, version: "test", readOnly: false });
});
afterEach(async () => { await bridge.server.stop(); await rm(root, { recursive: true, force: true }); });

it("protects the outline, excludes unmanaged paths from edits, and refuses editor process launch", async () => {
  expect((await call(outline(jsx), undefined, "fake-bridge-token-123")).status).toBe(401);
  expect((await call(outline(jsx))).status).toBe(200);
  expect((await call(outline("../secret.tsx"))).status).toBe(403);
  expect((await call(outline("app/page.tsx"))).status).toBe(403);
  expect((await call(outline("src/velora/catalog.jsx"))).status).toBe(403);
  expect((await call("open", { file: jsx })).status).toBe(405);
  await write(".velora/integration.json", JSON.stringify({ files: { [jsx]: text } }));
  expect((await call(outline(jsx))).status).toBe(403);
  expect((await call("preview", request)).status).toBe(403);
});

it("refuses a symlinked path under src", async () => {
  await symlink(file("src/velora/scenes"), file("src/alias"), process.platform === "win32" ? "junction" : "dir");
  expect((await call(outline("src/alias/design.jsx"))).status).toBe(403);
});

it("requires reviewed hashes and checks both files again on undo", async () => {
  const preview = await call("preview", request);
  expect(preview.status).toBe(200);
  expect(await read(jsx)).toBe(text);
  expect(await read(recipe)).toBe(scene);
  const confirm = { previewId: preview.body.previewId, baseShas: preview.body.baseShas };
  expect((await call("apply", { ...confirm, baseShas: { [jsx]: confirm.baseShas[jsx] } })).status).toBe(409);
  const applied = await call("apply", confirm);
  expect(applied.status).toBe(200);
  expect((await call("apply", confirm)).status).toBe(409);
  expect(await read(jsx)).toContain('id="headline"');
  expect(JSON.parse(await read(recipe)).definition.scene.nodes).toEqual([{ id: "headline" }]);
  const committed = await read(recipe);
  await write(recipe, committed + "\n");
  expect((await call("undo", { undoId: applied.body.undoId })).status).toBe(409);
  expect(await read(jsx)).toContain('id="headline"');
  await write(recipe, committed);
  expect((await call("undo", { undoId: applied.body.undoId })).status).toBe(200);
  expect(await read(jsx)).toBe(text);
  expect(await read(recipe)).toBe(scene);
});

it("permits inspection in read-only mode and refuses apply and undo", async () => {
  await bridge.server.stop();
  bridge = await startSceneBridge(root, { origin, version: "test", readOnly: true });
  const preview = await call("preview", request);
  expect(preview.status).toBe(200);
  expect((await call("apply", { previewId: preview.body.previewId, baseShas: preview.body.baseShas })).status).toBe(405);
  expect((await call("undo", {})).status).toBe(405);
  expect(await read(jsx)).toBe(text);
});
