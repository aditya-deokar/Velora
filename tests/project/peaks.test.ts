import { afterEach, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compositionMediaPeaks } from "../../src/project/composition-edit";
import { startSceneBridge } from "../../src/project/edit";

function wav(amplitude: number, seconds = 1) {
  const count = 8000 * seconds, bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(i % 80 < 40 ? -amplitude : amplitude, 44 + i * 2);
  return bytes;
}
const file = "cut.composition.json";
const tone = wav(16384);
const base = { version: 1, id: "cut", title: "Cut", width: 128, height: 96, scenes: [{ id: "one", recipe: "one", startMs: 0, durationMs: 1000 }],
  assets: [{ id: "tone", path: "assets/tone.wav", type: "audio" }, { id: "copy", path: "assets/copy.wav", type: "audio" },
    { id: "private", path: "assets/../private.wav", type: "audio" }], audio: [{ id: "tone", assetId: "tone", startMs: 0 }] };
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-peaks-"));
  await mkdir(path.join(root, "assets"));
  await Promise.all([writeFile(path.join(root, file), JSON.stringify(base)), writeFile(path.join(root, "assets/tone.wav"), tone),
    writeFile(path.join(root, "assets/copy.wav"), tone), writeFile(path.join(root, "assets/undeclared.wav"), tone), writeFile(path.join(root, "private.wav"), tone)]);
});
afterEach(() => rm(root, { recursive: true, force: true }));

it("decodes deterministic 10 ms extrema and shares cache entries by asset content", async () => {
  const first = await compositionMediaPeaks(root, file, "tone");
  expect(first).toMatchObject({ bucketMs: 10, durationMs: 1000, sha256: createHash("sha256").update(tone).digest("hex") });
  const extrema = Buffer.from(first.peaks, "base64");
  expect(extrema.length).toBe(200);
  expect(extrema[0]).toBeLessThan(70);
  expect(extrema[1]).toBeGreaterThan(185);
  expect(await compositionMediaPeaks(root, file, "copy")).toEqual(first);
  const cache = path.join(root, ".velora/cache/peaks");
  expect(await readdir(cache)).toEqual([`${first.sha256}.json`]);
  expect(JSON.parse(await readFile(path.join(cache, `${first.sha256}.json`), "utf8"))).toEqual(first);
  await writeFile(path.join(root, "assets/tone.wav"), wav(8192));
  const second = await compositionMediaPeaks(root, file, "tone");
  expect(second.sha256).not.toEqual(first.sha256);
  expect(second.peaks).not.toEqual(first.peaks);
  expect(await readdir(cache)).toHaveLength(2);
});

it("serves bounded waveforms through the authenticated bridge, scoped to declared audio assets", async () => {
  await writeFile(path.join(root, "assets/tone.wav"), wav(16384, 361));
  const origin = "http://127.0.0.1:5173";
  const { server, token } = await startSceneBridge(root, { origin, readOnly: true, version: "test" });
  try {
    const request = (asset: string, auth = true) => fetch(`${server.origin}/v1/media/peaks?${new URLSearchParams({ composition: file, asset })}`,
      { headers: { origin, ...(auth ? { authorization: `Bearer ${token}` } : {}) } });
    expect((await request("tone", false)).status).toBe(401);
    expect((await request("undeclared")).status).toBe(403);
    expect((await request("private")).status).toBe(403);
    const response = await request("tone");
    expect(response.status).toBe(200);
    const payload = await response.text();
    expect(Buffer.byteLength(payload)).toBeLessThan(256_000);
    expect(JSON.parse(payload).durationMs).toBe(360_000);
  } finally { await server.stop(); }
}, 20_000);
