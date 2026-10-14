import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeAudioCommand, executeCaptionsCommand, executeProjectCommand } from "../../src/project/commands";

let root: string;
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
// 1s 8kHz mono 16-bit 440Hz sine WAV, synthesized so fixtures need no encoder.
function toneWav(seconds = 1): Buffer {
  const rate = 8000, samples = Math.floor(rate * seconds);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPdwAAAAASUVORK5CYII=", "base64");
const recipeDoc = { version: 1, id: "demo", title: "Demo", definition: { width: 128, height: 96, scene: { nodes: [] } } };
const goodSrt = "1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:06,000\nWorld\n";
function compositionDoc(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, id: "teaser", title: "Teaser", width: 128, height: 96, fps: 30, seed: 0,
    scenes: [{ id: "s1", recipe: "demo", startMs: 0, durationMs: 8000 }], assets: [],
    audio: [{ id: "music", assetId: "tone", startMs: 0 }], captions: { file: "subs.srt", burnIn: false },
    ...overrides,
  };
}
async function put(file: string, content: string | Buffer) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), content);
}
async function mediaHost() {
  root = await mkdtemp(path.join(tmpdir(), "velora-media-"));
  await put("src/velora/scenes/demo.scene.json", JSON.stringify(recipeDoc));
  await put("src/velora/scenes/demo.tsx", "export default function Demo() { return null; }");
  await put("assets/tone.wav", toneWav());
  await put("subs.srt", goodSrt);
  await put("teaser.composition.json", JSON.stringify(compositionDoc()));
}
beforeEach(mediaHost);
const audio = (op: "list-audio" | "check-audio", input = {}) => executeAudioCommand(op, { composition: "teaser.composition.json", ...input }, { root });
const captions = (op: "validate-captions" | "check-captions", input = {}) => executeCaptionsCommand(op, input, { root });

describe("audio ops", () => {
  it("lists tracks with frame-snapped placement", async () => {
    await put("teaser.composition.json", JSON.stringify(compositionDoc({ audio: [{ id: "music", assetId: "tone", startMs: 50 }] })));
    const result = await audio("list-audio");
    expect(result).toMatchObject({ success: true, command: "audio", data: { fps: 30, driftBudgetMs: 40, tracks: [{ id: "music", frame: 2, placedStartMs: 200 / 3 }] } });
  });
  it("passes a healthy mix and names every failure class", async () => {
    expect(await audio("check-audio")).toMatchObject({ success: true });
    await put("teaser.composition.json", JSON.stringify(compositionDoc({ audio: [{ id: "music", assetId: "ghost", startMs: 0 }] })));
    expect(await audio("check-audio")).toMatchObject({ success: false, issues: [{ code: "ERR_ASSET_NOT_FOUND", path: "audio.0.assetId" }] });
    await put("assets/cover.png", tinyPng);
    await put("teaser.composition.json", JSON.stringify(compositionDoc({ audio: [{ id: "music", assetId: "cover", startMs: 0 }] })));
    expect(await audio("check-audio")).toMatchObject({ success: false, issues: [{ code: "ERR_ASSET_UNSUPPORTED" }] });
    await put("assets/fake.mp3", "definitely not audio bytes, just text");
    await put("teaser.composition.json", JSON.stringify(compositionDoc({ audio: [{ id: "music", assetId: "fake", startMs: 0 }] })));
    expect(await audio("check-audio")).toMatchObject({ success: false, issues: [{ code: "ERR_AUDIO_CODEC" }] });
    await put("teaser.composition.json", JSON.stringify(compositionDoc({ audio: [{ id: "music", assetId: "tone", startMs: 0, fadeInMs: 900, fadeOutMs: 900 }] })));
    expect(await audio("check-audio")).toMatchObject({ success: false, issues: [{ code: "ERR_AUDIO_INVALID" }] });
    await put("teaser.composition.json", JSON.stringify(compositionDoc({ audio: [{ id: "music", assetId: "tone", startMs: 0, duckUnder: { trackId: "ghost", amount: 0.5 } }] })));
    expect(await audio("check-audio")).toMatchObject({ success: false, issues: [{ code: "ERR_AUDIO_INVALID", path: "audio.0.duckUnder.trackId" }] });
    await put("teaser.composition.json", JSON.stringify(compositionDoc({ audio: [
      { id: "a", assetId: "tone", startMs: 0, duckUnder: { trackId: "b", amount: 0.5 } },
      { id: "b", assetId: "tone", startMs: 0, duckUnder: { trackId: "a", amount: 0.5 } },
    ] })));
    expect(await audio("check-audio")).toMatchObject({ success: false, issues: [{ code: "ERR_AUDIO_INVALID", path: "audio" }] });
  }, 60_000);
});

describe("captions ops", () => {
  it("validates SRT and VTT files", async () => {
    const validated = await captions("validate-captions", { file: "subs.srt" });
    expect(validated).toMatchObject({ success: true, command: "captions", data: { kind: "srt" } });
    expect(validated.success && validated.data.cues.map((c) => c.text)).toEqual(["Hello", "World"]);
    await put("subs.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n");
    expect(await captions("validate-captions", { file: "subs.vtt" })).toMatchObject({ success: true, data: { kind: "vtt" } });
    await put("bad.srt", "1\nno timing\n\n");
    expect(await captions("validate-captions", { file: "bad.srt" })).toMatchObject({ success: false, issues: [{ code: "ERR_CAPTION_INVALID" }] });
    expect(await captions("validate-captions", { file: "subs.txt" })).toMatchObject({ success: false, issues: [{ code: "ERR_CAPTION_INVALID" }] });
    expect(await captions("validate-captions", { file: "missing.srt" })).toMatchObject({ success: false, issues: [{ code: "ERR_CAPTION_INVALID" }] });
  });
  it("checks cues against the composition span", async () => {
    expect(await captions("check-captions", { composition: "teaser.composition.json" })).toMatchObject({ success: true, data: { durationMs: 8000 } });
    await put("subs.srt", "1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:02,000 --> 00:00:04,000\nOverlap\n");
    expect(await captions("check-captions", { composition: "teaser.composition.json" })).toMatchObject({ success: false, issues: [{ code: "ERR_CAPTION_OVERLAP" }] });
    await put("subs.srt", "1\n00:00:07,000 --> 00:00:09,000\nBeyond\n");
    expect(await captions("check-captions", { composition: "teaser.composition.json" })).toMatchObject({ success: false, issues: [{ code: "ERR_CAPTION_TIMING" }] });
    await put("teaser.composition.json", JSON.stringify(compositionDoc({ captions: undefined })));
    expect(await captions("check-captions", { composition: "teaser.composition.json" })).toMatchObject({ success: false, issues: [{ code: "ERR_CAPTION_INVALID" }] });
  });
});

describe("validate folding", () => {
  async function initialized() {
    await put("package.json", JSON.stringify({ name: "host", scripts: { dev: "vite" },
      dependencies: { react: "^19.2.0", "react-dom": "^19.2.0", "velora": "0.1.0" }, devDependencies: { vite: "^7.3.6" } }));
    await put("package-lock.json", '{"lockfileVersion":3}');
    await put("index.html", '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    await put("vite.config.ts", 'import {defineConfig} from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({plugins:[react()]});');
    await put("src/main.tsx", 'import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\ncreateRoot(document.getElementById("root")!).render(<StrictMode><div/></StrictMode>);\n');
    await put("node_modules/react/package.json", '{"name":"react","version":"19.2.0"}');
    await put("node_modules/react-dom/package.json", '{"name":"react-dom","version":"19.2.0"}');
    await put("node_modules/velora/package.json", JSON.stringify({ name: "velora", version: "0.1.0", exports: { "./preview": { import: "./preview.js" } } }));
    await put("node_modules/velora/preview.js", "export const ProjectPreview = () => null;");
    const inited = await executeProjectCommand("init-project", {}, { root });
    expect(inited).toMatchObject({ success: true });
  }
  const validate = (composition?: string) => executeProjectCommand("validate-project", composition ? { composition } : {}, { root });
  it("passes healthy projects with advisory validation summaries", async () => {
    await initialized();
    const result = await validate("teaser.composition.json");
    expect(result).toMatchObject({ success: true, data: { validation: { scenes: 1, assets: 1, composition: "teaser.composition.json", durationMs: 8000, requiresVisualReview: true } } });
    expect(Array.isArray(result.success && result.data.validation?.advice)).toBe(true);
  }, 60_000);
  it.each([
    ["missing audio asset", { audio: [{ id: "m", assetId: "ghost", startMs: 0 }] }, "ERR_ASSET_NOT_FOUND"],
    ["non-audio asset", { audio: [{ id: "m", assetId: "cover", startMs: 0 }] }, "ERR_ASSET_UNSUPPORTED"],
    ["overlapping cues", { captions: { file: "overlap.srt" } }, "ERR_CAPTION_OVERLAP"],
    ["ghost recipe", { scenes: [{ id: "s1", recipe: "ghost", startMs: 0, durationMs: 100 }] }, "ERR_SCENE_NOT_FOUND"],
    ["bad fps", { fps: 24 }, "ERR_COMPOSITION_INVALID"],
  ])("validate fails closed on %s", async (_label, patch, code) => {
    await initialized();
    await put("assets/cover.png", tinyPng);
    await put("overlap.srt", "1\n00:00:01,000 --> 00:00:03,000\nA\n\n2\n00:00:02,000 --> 00:00:04,000\nB\n");
    await put("teaser.composition.json", JSON.stringify({ ...compositionDoc(), ...patch }));
    const result = await validate("teaser.composition.json");
    expect(result.success).toBe(false);
    expect(!result.success && result.issues.map((i) => i.code)).toContain(code);
  }, 60_000);
  it("classifies recipe diagnostics to stable codes", async () => {
    await initialized();
    await rm(path.join(root, "src/velora/scenes/demo.tsx"));
    expect(await validate()).toMatchObject({ success: false, issues: [{ code: "ERR_BINDING_MISSING" }] });
    await put("src/velora/scenes/demo.tsx", "export default function Demo() { return null; }");
    await put("src/velora/scenes/demo.scene.json", JSON.stringify({ ...recipeDoc, definition: { ...recipeDoc.definition, focus: { distance: 10, fStop: 8, focalLength: 50, maxBlur: 6 } } }));
    expect(await validate()).toMatchObject({ success: false, issues: [{ code: "ERR_FOCUS_INVALID" }] });
    await put("src/velora/scenes/demo.scene.json", JSON.stringify(recipeDoc));
    await put("src/velora/scenes/other.scene.json", JSON.stringify({ ...recipeDoc }));
    const dupes = await validate();
    expect(dupes.success).toBe(false);
    expect(!dupes.success && dupes.issues.map((i) => i.code)).toContain("ERR_SCENE_INVALID");
  }, 60_000);
});
