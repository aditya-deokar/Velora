import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { evaluateMotion, loopSeam, motionDuration, SURFACE_VISUAL_PROPERTIES } from "../../src/core/motion";
import { evaluateScene, cameraToCss, transformToCss, type Measurements } from "../../src/core/spatial";
import { lensFor } from "../../src/core/lens";
import { ASPECT_FRAMES, AspectSchema, IntensitySchema, SHOT_KINDS, buildShot, framingReport } from "../../src/core/shots";
import { TEMPLATE_CATALOG, resolveTemplateParams, templateDefinition } from "../../src/core/templates";
import { compositePreview } from "../../src/core/composites";

/** v2.1 Phase 00 goldens: byte-level records of today's motion, spatial, optics and shot behavior.
 * Every later v2.1 phase is additive, so these records must never move. They are regenerated only by
 * `node scripts/golden.mjs --update` (which sets VELORA_GOLDEN=update); otherwise tests compare.
 */
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const GOLDEN_DIRECTORY = path.join(ROOT, "tests/core/fixtures/v21-golden");
export const UPDATING = process.env.VELORA_GOLDEN === "update";
export const MOTION_SAMPLES = 25;
export const SPATIAL_SAMPLES = 5;
export const LENS_TABLE_MM = [16, 24, 35, 50, 85, 135, 200] as const;
export const FRAME_HEIGHTS = [1080, 1350, 1920] as const;
const visualKeys: ReadonlySet<string> = new Set(SURFACE_VISUAL_PROPERTIES);
// Fixed synthetic layout: roots fill a 1400x980 stage, nested nodes are 400x300 cards.
const ROOT_SIZE = { width: 1400, height: 980 }, NESTED_SIZE = { width: 400, height: 300 };

type Definition = { scene?: { nodes?: { id: string; parentId?: string; transform?: Record<string, number> }[]; camera?: object; focus?: object }; motion?: unknown };
export type GoldenSource = { key: string; definition: Definition };

/** Committed recipe files in the audited roots (tracked by git, so scratch files never enter). */
export function committedFiles(pattern: RegExp, roots = ["tests/", "local-project/src/velora/scenes/", "skills/velora/templates/"]): string[] {
  const listed = execFileSync("git", ["ls-files", "--", ...roots], { cwd: ROOT, encoding: "utf8" });
  return listed.split(/\r?\n/).filter(name => pattern.test(name)).sort();
}
/** The committed blob bytes (independent of core.autocrlf in the working tree). */
export function committedBytes(file: string): Buffer {
  return execFileSync("git", ["show", `HEAD:${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}
export function recipeSources(files: readonly string[]): GoldenSource[] {
  return files.map(file => {
    const text = readFileSync(path.join(ROOT, file), "utf8").replace(/^﻿/, "");
    return { key: file, definition: (JSON.parse(text) as { definition: Definition }).definition };
  });
}
/** One scaffold per template id x aspect x intensity, built through the same path velora new scene uses. */
export function scaffoldSources(): GoldenSource[] {
  const sources: GoldenSource[] = [];
  for (const manifest of TEMPLATE_CATALOG) {
    const intensities = manifest.params.some(param => param.name === "intensity") ? IntensitySchema.options : [undefined];
    for (const aspect of manifest.aspects)
      for (const intensity of intensities) {
        const { params, issues } = resolveTemplateParams(manifest, intensity ? { intensity } : {});
        if (issues.length) throw new Error(`${manifest.id}: ${JSON.stringify(issues)}`);
        const definition = compositePreview(templateDefinition(manifest, params, aspect)) as unknown as Definition;
        sources.push({ key: `${manifest.id}@${aspect}@${intensity ?? "-"}`, definition });
      }
  }
  return sources;
}

function sampleTimes(motion: unknown, count: number): number[] {
  const duration = motionDuration(motion);
  return Array.from({ length: count }, (_, k) => (count === 1 ? 0 : (duration * k) / (count - 1)));
}
export function motionRecord(definition: Definition) {
  const motion = definition.motion ?? { durationMs: 0, tracks: [] };
  return {
    loopSeam: loopSeam(motion),
    samples: sampleTimes(motion, MOTION_SAMPLES).map(timeMs => ({ timeMs, state: evaluateMotion(motion, timeMs) })),
  };
}
/** The React Scene merge (camera, focus and transform keys of surface tracks) without a DOM. */
export function spatialRecord(definition: Definition) {
  const motion = definition.motion ?? { durationMs: 0, tracks: [] };
  const nodes = definition.scene?.nodes ?? [];
  const measurements: Measurements = Object.fromEntries(nodes.map(node => [node.id, node.parentId ? NESTED_SIZE : ROOT_SIZE]));
  return sampleTimes(motion, SPATIAL_SAMPLES).map(timeMs => {
    const state = evaluateMotion(motion, timeMs);
    const camera = { ...definition.scene?.camera, ...state.camera };
    const transforms = nodes.map(node => ({
      ...node.transform,
      ...Object.fromEntries(Object.entries(Object.hasOwn(state.surfaces, node.id) ? state.surfaces[node.id] : {}).filter(([key]) => !visualKeys.has(key))),
    }));
    const input = { ...definition.scene, camera, focus: { ...definition.scene?.focus, ...state.focus }, nodes: nodes.map((node, i) => ({ ...node, transform: transforms[i] })) };
    const evaluation = evaluateScene(input, measurements);
    let cameraCss: string, transformCss: string[];
    try { cameraCss = cameraToCss(camera); } catch (error) { cameraCss = `throws: ${(error as Error).message}`; }
    try { transformCss = transforms.map(transform => transformToCss(transform)); } catch (error) { transformCss = [`throws: ${(error as Error).message}`]; }
    return {
      timeMs,
      focusDepth: evaluation.focusDepth,
      issues: evaluation.issues,
      nodes: evaluation.nodes.map(node => ({ id: node.id, world: node.world, blur: node.blur })),
      cameraCss,
      transformCss,
    };
  });
}
const attempt = <T,>(run: () => T): T | { throws: string } => {
  try { return run(); } catch (error) { return { throws: (error as Error).message }; }
};
export function opticsRecord() {
  const lenses: Record<string, unknown> = {};
  for (const mm of LENS_TABLE_MM) for (const height of FRAME_HEIGHTS) lenses[`${mm}mm@${height}`] = attempt(() => lensFor(mm, height));
  const shots: Record<string, unknown> = {}, framing: Record<string, unknown> = {};
  for (const kind of SHOT_KINDS)
    for (const aspect of AspectSchema.options)
      for (const intensity of IntensitySchema.options) {
        const key = `${kind}@${aspect}@${intensity}`;
        const shot = attempt(() => buildShot({ kind, aspect, intensity }));
        shots[key] = shot;
        framing[key] = "throws" in shot ? shot : (({ minSubjectVisible, minDepthMargin, worstRegionBlur }) => ({ minSubjectVisible, minDepthMargin, worstRegionBlur }))(framingReport(shot, ASPECT_FRAMES[aspect].subject));
      }
  return { lenses, shots, framing };
}

/** Byte-level comparison of one golden document; returns the keys that changed. */
export function diffRecords(expected: Record<string, unknown>, actual: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...keys].filter(key => JSON.stringify(expected[key]) !== JSON.stringify(actual[key])).sort();
}
export function goldenPath(name: string): string {
  return path.join(GOLDEN_DIRECTORY, name);
}
/** In update mode write the record; otherwise read the committed record (missing goldens fail). */
export function golden<T>(name: string, actual: T): T {
  const file = goldenPath(name);
  if (UPDATING) {
    mkdirSync(GOLDEN_DIRECTORY, { recursive: true });
    writeFileSync(file, JSON.stringify(actual) + "\n");
    return JSON.parse(JSON.stringify(actual)) as T;
  }
  if (!existsSync(file)) throw new Error(`Missing golden ${name}; run node scripts/golden.mjs --update deliberately and commit it.`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
