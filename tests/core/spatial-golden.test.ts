import { describe, expect, it } from "vitest";
import { lensFor } from "../../src/core/lens";
import {
  UPDATING, committedBytes, committedFiles, diffRecords, golden, opticsRecord, recipeSources, scaffoldSources, sha256, spatialRecord,
} from "./v21-golden";

/** v2.1 Phase 00 spatial, optics, shot and formatting goldens. Later phases are additive, so every
 * record here stays byte-identical; regenerate only with `node scripts/golden.mjs --update`. */
type Record_ = Record<string, unknown>;

describe("v2.1 spatial golden", () => {
  const recorded = UPDATING ? undefined : golden<{ recipes: Record_; scaffolds: Record_ }>("spatial.json", { recipes: {}, scaffolds: {} });
  const files = recorded ? Object.keys(recorded.recipes) : committedFiles(/\.scene\.json$/);
  const actual = {
    recipes: Object.fromEntries(recipeSources(files).map(source => [source.key, spatialRecord(source.definition)])),
    scaffolds: Object.fromEntries(scaffoldSources().map(source => [source.key, spatialRecord(source.definition)])),
  };
  const expected = recorded ?? golden("spatial.json", actual);
  it("records world matrices, blur, focus depth and CSS strings for recipes", () => expect(diffRecords(expected.recipes, actual.recipes)).toEqual([]));
  it("records the same for every template scaffold", () => expect(diffRecords(expected.scaffolds, actual.scaffolds)).toEqual([]));
});

describe("v2.1 optics and shot golden", () => {
  const actual = opticsRecord();
  const expected = golden("optics.json", actual);
  it("keeps every buildShot output and framing summary byte-identical", () => {
    expect(diffRecords(expected.shots as Record_, actual.shots)).toEqual([]);
    expect(diffRecords(expected.framing as Record_, actual.framing)).toEqual([]);
  });
  it("keeps every recorded lensFor value; only a recorded throw may become a value (reported)", () => {
    const conversions: string[] = [];
    for (const key of diffRecords(expected.lenses as Record_, actual.lenses)) {
      const before = (expected.lenses as Record_)[key] as { throws?: string } | undefined;
      const after = actual.lenses[key] as { throws?: string } | undefined;
      if (before?.throws !== undefined && after && after.throws === undefined) conversions.push(key);
      else expect.fail(`lensFor ${key} changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    }
    if (conversions.length) console.info(`lensFor throw -> value conversions: ${conversions.join(", ")}`);
    // Today's long-lens limits are part of the record (Phase 14 may convert exactly these).
    expect(() => lensFor(200, 1920)).toThrow(RangeError);
  });
});

describe("v2.1 formatting corpus", () => {
  const files = [...committedFiles(/\.scene\.json$/), ...committedFiles(/\.composition\.json$/)].sort();
  const actual = Object.fromEntries(files.map(file => {
    const bytes = committedBytes(file);
    return [file, { sha256: sha256(bytes), base64: bytes.toString("base64") }];
  }));
  const expected = golden<Record<string, { sha256: string; base64: string }>>("format-corpus.json", actual);
  it("stores the exact committed bytes of every recipe and composition", () => {
    expect(Object.keys(expected).length).toBeGreaterThanOrEqual(30);
    for (const [file, entry] of Object.entries(expected))
      expect(sha256(Buffer.from(entry.base64, "base64")), file).toBe(entry.sha256);
  });
  it("derives CRLF and BOM variants that still parse to the same document", () => {
    for (const [file, entry] of Object.entries(expected)) {
      const lf = Buffer.from(entry.base64, "base64").toString("utf8");
      const variants = [lf, lf.replace(/\r?\n/g, "\r\n"), "﻿" + lf, "﻿" + lf.replace(/\r?\n/g, "\r\n")];
      const documents = variants.map(text => JSON.stringify(JSON.parse(text.replace(/^﻿/, ""))));
      expect(new Set(documents).size, file).toBe(1);
    }
  });
});
