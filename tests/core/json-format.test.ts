import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatJsonDocument, parseJsonDocument } from "../../src/core/json";
import { goldenPath } from "./v21-golden";

// v2.1 Phase 03.2: the formatting-preserving writer over the Phase 00 corpus.
const corpus = JSON.parse(readFileSync(goldenPath("format-corpus.json"), "utf8")) as Record<string, { base64: string }>;
const texts = Object.entries(corpus).map(([file, entry]) => [file, Buffer.from(entry.base64, "base64").toString("utf8")] as const);
const variants = (text: string) => ({ lf: text, crlf: text.replace(/\r?\n/g, "\r\n"), bom: "﻿" + text, bomCrlf: "﻿" + text.replace(/\r?\n/g, "\r\n") });
describe("formatJsonDocument", () => {
  it("is a byte-identical no-op over the whole corpus, with CRLF and BOM variants", () => {
    expect(texts.length).toBeGreaterThanOrEqual(30);
    for (const [file, text] of texts) for (const [name, variant] of Object.entries(variants(text)))
      expect(formatJsonDocument(variant, parseJsonDocument(variant)), `${file} (${name})`).toBe(variant);
  });
  it("is a no-op for 4-space, tab and inline fixtures", () => {
    for (const text of ['{\n    "a": 1,\n    "b": [1, 2]\n}\n', '{\n\t"a": {\n\t\t"b": true\n\t}\n}', '{"a":1,"b":{"c":[1,2,3]}}', '[ 1, 2, 3 ]\n'])
      expect(formatJsonDocument(text, JSON.parse(text))).toBe(text);
  });
  it("changes exactly the lines of one changed keyframe", () => {
    for (const [file, text] of texts.filter(([file]) => file.endsWith(".scene.json"))) {
      const doc = parseJsonDocument(text) as { definition: { motion?: { tracks: { keyframes: { value: unknown }[] }[] } } };
      const frame = doc.definition.motion?.tracks.find(track => typeof track.keyframes[0]?.value === "number")?.keyframes[0];
      if (!frame) continue;
      frame.value = (frame.value as number) + 1.5;
      const next = formatJsonDocument(text, doc);
      const a = text.split("\n"), b = next.split("\n");
      expect(b.length, file).toBe(a.length);
      expect(a.filter((line, i) => line !== b[i]).length, file).toBe(1);
      expect(parseJsonDocument(next)).toEqual(doc);
    }
  });
  it("keeps key order, inserts new keys in canonical order and styles new elements like their siblings", () => {
    const text = '{\n  "version": 1,\n  "definition": {\n    "scene": { "nodes": [] },\n    "motion": {\n      "durationMs": 1000,\n      "tracks": [\n        { "target": { "kind": "camera" }, "property": "x", "keyframes": [{ "timeMs": 0, "value": 0 }] }\n      ]\n    }\n  },\n  "id": "a"\n}\n';
    const doc = JSON.parse(text);
    doc.definition.motion.tracks[0].keyframes.push({ timeMs: 500, value: 10, easing: "linear" });
    doc.definition.motion.clips = [{ id: "c", startMs: 0 }];
    doc.title = "T";
    const next = formatJsonDocument(text, doc);
    expect(JSON.parse(next)).toEqual(doc);
    expect(Object.keys(JSON.parse(next))).toEqual(["version", "title", "definition", "id"]);
    expect(next).toContain('"keyframes": [{ "timeMs": 0, "value": 0 }, { "timeMs": 500, "value": 10, "easing": "linear" }]');
    expect(Object.keys(JSON.parse(next).definition.motion)).toEqual(["durationMs", "tracks", "clips"]);
    expect(next.endsWith("}\n")).toBe(true);
  });
  it("leaves snapshot bytes untouched and preserves CRLF, BOM and missing trailing newlines on edits", () => {
    const snapshot = "data:image/png;base64," + "iVBORw0KGgo".padEnd(4000, "A");
    const text = '﻿{\r\n  "id": "a",\r\n  "snapshot": {\r\n    "image": "' + snapshot + '",\r\n    "timeMs": 0\r\n  }\r\n}';
    const doc = parseJsonDocument(text) as Record<string, unknown>;
    doc.id = "b";
    const next = formatJsonDocument(text, doc);
    expect(next.startsWith("﻿{\r\n")).toBe(true);
    expect(next.endsWith("}")).toBe(true);
    expect(next).toContain(snapshot);
    expect(next.replace('"b"', '"a"')).toBe(text);
  });
  it("writes numbers in shortest round-trip form", () => {
    expect(formatJsonDocument('{"a":1}', { a: 0.1 + 0.2 })).toBe('{"a":0.30000000000000004}');
    expect(formatJsonDocument('{"a":1}', { a: 1e21 })).toBe('{"a":1e+21}');
  });
});
