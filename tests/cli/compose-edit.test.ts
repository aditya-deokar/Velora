import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";
import { startSceneBridge } from "../../src/project/edit";

const file = "launch cut.composition.json";
const text = '{ "version": 1, "id": "launch", "title": "Launch", "width": 640, "height": 360, "scenes": [{ "id": "one", "recipe": "one", "startMs": 0, "durationMs": 1000 }, { "id": "two", "recipe": "two", "startMs": 1000, "durationMs": 1000 }] }\r\n';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-compose-"));
  await writeFile(path.join(root, file), text);
});
afterEach(() => rm(root, { recursive: true, force: true }));
const run = (args: string[], stdin?: string) => runCli(["compose", ...args, "--composition", file, "--json"], { root, readStdin: async () => stdin ?? "" });

it("prints dry-run diffs and SHA, writes only on request and accepts inverse envelopes", async () => {
  const args = ["trim", "--id", "one", "--edge", "out", "--delta", "-100", "--ripple"];
  const dry = await run(args);
  expect(dry.code, dry.stderr).toBe(0);
  const { data } = JSON.parse(dry.stdout);
  expect(data).toMatchObject({ written: false, diff: expect.stringContaining('"startMs": 900') });
  expect(await readFile(path.join(root, file), "utf8")).toBe(text);
  const wrote = await run([...args, "--expect-sha", data.sha, "--write"]);
  expect(JSON.parse(wrote.stdout)).toMatchObject({ success: true, command: "compose", data: { written: true } });
  const stale = await run([...args, "--expect-sha", data.sha, "--write"]);
  expect(stale.code).toBe(1);
  expect(JSON.parse(stale.stderr)).toMatchObject({ issues: [{ code: "ERR_EDIT_CONFLICT" }] });
  const undo = await run(["edit", "--ops", "-", "--write"], wrote.stdout);
  expect(undo.code, undo.stderr).toBe(0);
  expect(await readFile(path.join(root, file), "utf8")).toBe(text);
});

it("supports file batches and composition helpers with the common timeline errors", async () => {
  await writeFile(path.join(root, "ops.json"), JSON.stringify([{ op: "segment.slip", id: "two", deltaMs: 200 }]));
  expect((await run(["edit", "--ops", "ops.json", "--write"])).code).toBe(0);
  expect((await run(["transition", "--id", "two", "--type", "crossfade", "--duration", "400", "--write"])).code).toBe(0);
  const invalid = await run(["move", "--id", "two", "--at", "800"]);
  expect(JSON.parse(invalid.stderr)).toMatchObject({ issues: [{ code: "ERR_TIMELINE_OVERLAP" }] });
  expect((await run(["transition", "--id", "two", "--remove", "--write"])).code).toBe(0);
  expect((await run(["split", "--id", "two", "--at", "1500", "--new-id", "third", "--write"])).code).toBe(0);
  expect(JSON.parse(await readFile(path.join(root, file), "utf8")).scenes[2]).toMatchObject({ id: "third", inMs: 700 });
});

it("allows exactly one concurrent bridge write for a revision and returns the current text on conflict", async () => {
  const origin = "http://127.0.0.1:5173";
  const { server, token } = await startSceneBridge(root, { origin, readOnly: false, version: "test" });
  try {
    const url = `${server.origin}/v1/compositions/${encodeURIComponent(file)}`;
    const headers = { origin, authorization: `Bearer ${token}`, "content-type": "application/json" };
    const { sha256 } = await fetch(url, { headers }).then(response => response.json());
    const results = await Promise.all([100, 200].map(deltaMs => fetch(`${url}/edits`, { method: "POST", headers,
      body: JSON.stringify({ baseSha: sha256, ops: [{ op: "segment.slip", id: "two", deltaMs }] }) })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const conflict = await results.find(result => result.status === 409)!.json();
    expect(conflict.text).toBe(await readFile(path.join(root, file), "utf8"));
    expect(conflict.sha).not.toBe(sha256);
  } finally { await server.stop(); }
});
