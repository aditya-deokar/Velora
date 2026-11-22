import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkArchitecture, checkProject, checkDocumentation } from '../scripts/check-architecture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sceneDoc = `/** SOURCE OF TRUTH: SceneSchema, TransformSchema.
 * WHAT: define validated scene data.
 * WHY: keep all consumers consistent.
 * WHERE: consumed by spatial evaluator.
 */`;
const spatialDoc = `/** SOURCE OF TRUTH: evaluateScene, transformToCss, focusForSurface, sampleFocus, focusMask, cameraToCss, uniformFocusBlur, resolveConstraints, projectWorld, screenRay, intersectPlane, surfaceQuad, coverScaleAt.
 * WHAT: evaluate transforms and focus.
 * WHY: prevent divergent renderer math.
 * WHERE: consumed by React adapter.
 */`;
const valid = {
 'src/core/depth.ts': `/** SOURCE OF TRUTH: DEPTH_TIERS, classifyDepth, evaluateDepthLayers. WHAT: classify depth and compute light. WHY: keep capture and preview consistent. WHERE: consumed by the depth renderers. */
 export const DEPTH_TIERS=Object.freeze({}); export function classifyDepth(){return [];} export function evaluateDepthLayers(){return [];}`,
 'src/react/depth/ledger.ts': `/** SOURCE OF TRUTH: createStyleLedger. WHAT: record inline styles before writes. WHY: restore host DOM exactly. WHERE: consumed by the depth renderers. */
 export function createStyleLedger(){return {};}`,
 'src/project/discovery.ts':`/** SOURCE OF TRUTH: discoverRecipes. WHAT: read scoped recipes. WHY: share discovery policy. WHERE: project commands call this owner. */ export function discoverRecipes(){return {}}`,
 'src/project/portable.ts':`/** SOURCE OF TRUTH: portableIntegration, portableCatalog. WHAT: generate host connection source. WHY: reuse shared rendering contracts. WHERE: project commands write generated files. */ export function portableIntegration(){return {}} export function portableCatalog(){return ''}`,
 'src/core/recipes.ts':`/** SOURCE OF TRUTH: SceneRecipeSchema, SceneSnapshotSchema, SnapshotSceneSchema, loadSceneRecipes, ListScenesSchema, LoadSceneSchema, OpenSceneSchema.
 * WHAT: validate source recipes and selection.
 * WHY: browser and CLI share catalog policy.
 * WHERE: project commands and SceneLibrary call the owner.
 */
 import {z} from 'zod'; export const SceneSnapshotSchema=z.strictObject({}); export const SnapshotSceneSchema=z.strictObject({}); export const SceneRecipeSchema=z.strictObject({}); export const ListScenesSchema=z.strictObject({}); export const LoadSceneSchema=z.strictObject({}); export const OpenSceneSchema=z.strictObject({}); export function loadSceneRecipes(){return {};}`,
 'src/project/recipes.ts':`/** SOURCE OF TRUTH: executeRecipeCommand.
 * WHAT: load project scene recipes.
 * WHY: reads stay scoped behind commands.
 * WHERE: CLI calls this owner.
 */
 export function executeRecipeCommand(){return {};}`,
 'src/preview/SceneLibrary.tsx':`/** SOURCE OF TRUTH: SceneLibrary.
 * WHAT: present the discovered source catalog.
 * WHY: share browser scene entry behavior.
 * WHERE: installed projects call this owner.
 */
 export function SceneLibrary(){return null;}`,

 'src/core/preview.ts': `/** SOURCE OF TRUTH: PreviewDefinitionSchema, presentPreview.
 * WHAT: validate source preview revisions.
 * WHY: preserve a canonical presentation boundary.
 * WHERE: browser preview calls this operation.
 */
 import {z} from 'zod'; export const PreviewDefinitionSchema=z.strictObject({}); export function presentPreview(){return {};}`,
 'src/core/stage.ts': `/** SOURCE OF TRUTH: StageSchema, STAGE_PRESETS, resolutionBudget.
 * WHAT: define concrete logical stage geometry and raster demand.
 * WHY: keep layout independent from capture dimensions.
 * WHERE: preview and export read the same stage contract.
 */
 import {z} from 'zod'; export const StageSchema=z.strictObject({}); export const STAGE_PRESETS=Object.freeze({}); export function resolutionBudget(){return {};}`,
 'src/react/stage.tsx': `/** SOURCE OF TRUTH: AppStage, useAppStage.
 * WHAT: render a named size container and expose its metrics.
 * WHY: guarantee consistent viewport layout across preview and export.
 * WHERE: used by generated scene bindings.
 */
 export function AppStage(){return null;} export function useAppStage(){return undefined;}`,
 'src/preview/ScenePreview.tsx': `/** SOURCE OF TRUTH: ScenePreview.
 * WHAT: render the shared preview interface.
 * WHY: avoid duplicate product shells.
 * WHERE: installed applications call the component.
 */
 export function ScenePreview(){return null;}`,
 'src/preview/session.ts': `/** SOURCE OF TRUTH: usePreviewSession.
 * WHAT: maintain one playback session.
 * WHY: coordinate capture and preview controls.
 * WHERE: consumed by the product shell.
 */
 export function usePreviewSession(){return {};}`,

 'src/core/branding.ts': `/** SOURCE OF TRUTH: VELORA_BRAND, VELORA_PACKAGE. WHAT: shared attribution and package identity. WHY: consistent presentation and imports. WHERE: CLI, generators and browser. */ export const VELORA_BRAND=Object.freeze({}); export const VELORA_PACKAGE=Object.freeze({});`,
 'src/core/authoring.ts': `/** SOURCE OF TRUTH: getAuthoringGuide, reviewAuthoring, AuthoringGuideSchema.
 * WHAT: define cinematic concepts and review.
 * WHY: share capabilities across clients.
 * WHERE: CLI and package consume these operations.
 */
 import {z} from 'zod'; export const AuthoringGuideSchema=z.strictObject({}); export function getAuthoringGuide(){return {};} export function reviewAuthoring(){return {};}`,

 'src/core/export.ts': `/** SOURCE OF TRUTH: ExportVideoSchema, CaptureManifestSchema.
 * WHAT: validate capture configuration.
 * WHY: share one export contract.
 * WHERE: consumed by export commands.
 */
import {z} from 'zod'; export const ExportVideoSchema=z.strictObject({}); export const CaptureManifestSchema=z.strictObject({});`,
 'src/export/commands.ts': `/** SOURCE OF TRUTH: executeVideoExport, executeSceneSnapshot.
 * WHAT: validate and run export requests.
 * WHY: centralize the export policy.
 * WHERE: CLI calls the command.
 */
export function executeVideoExport(){return {};} export function executeSceneSnapshot(){return {};}`,

 'src/core/choreography.ts': `/** SOURCE OF TRUTH: CascadeSchema, createCascadeTracks, createCascadeClip.
 * WHAT: define validated entrances.
 * WHY: prevent duplicate choreography.
 * WHERE: consumed by scene authors.
 */
import {z} from 'zod'; export const CascadeSchema=z.strictObject({}); export function createCascadeTracks(){return [];} export function createCascadeClip(){return {};}`,

  'src/core/project.ts': `/** SOURCE OF TRUTH: InitProjectSchema, SyncProjectSchema.\n * WHAT: validate project command inputs.\n * WHY: keep adapters using contracts.\n * WHERE: consumed by trusted commands.\n */\nimport { z } from 'zod'; export const InitProjectSchema=z.strictObject({}); export const SyncProjectSchema=z.strictObject({});`,
  'src/project/commands.ts': `/** SOURCE OF TRUTH: executeProjectCommand.\n * WHAT: execute validated project commands.\n * WHY: protect scoped project state.\n * WHERE: invoked through CLI adapters.\n */\nexport async function executeProjectCommand(){return {};}`, 
  'src/core/scene.ts': `${sceneDoc}\nimport { z } from 'zod';\nexport const TransformSchema = z.strictObject({ x: z.number() });\nexport const SceneSchema = z.strictObject({ transform: TransformSchema }).superRefine(() => {});`,
  'src/core/spatial.ts': `${spatialDoc}\nimport { SceneSchema } from './scene';\nexport function evaluateScene(input: unknown) { return SceneSchema.parse(input); }\nexport const transformToCss = () => 'none'; export const focusForSurface=()=>0; export const sampleFocus=()=>0; export const focusMask=()=>''; export const cameraToCss=()=>''; export const uniformFocusBlur=()=>0; export const resolveConstraints=()=>({}); export const projectWorld=()=>null; export const screenRay=()=>({}); export const intersectPlane=()=>null; export const surfaceQuad=()=>[]; export const coverScaleAt=()=>1;`,
  'src/core/shots.ts': '/** SOURCE OF TRUTH: buildOrbitRig, buildRackFocus.\n * WHAT: compile camera rigs and focus moves to data.\n * WHY: one vocabulary for shots.\n * WHERE: consumed by templates and agents.\n */\nexport function buildOrbitRig(){return {};} export function buildRackFocus(){return {};}',
  'src/core/easing.ts': '/** SOURCE OF TRUTH: applyEasing.\n * WHAT: easing curves for motion segments.\n * WHY: one evaluator for every renderer.\n * WHERE: consumed by core motion.\n */\nimport { z } from \'zod\'; export function applyEasing(){return 0;}',
  'src/core/noise.ts': '/** SOURCE OF TRUTH: NoiseSchema, sampleNoise.\n * WHAT: seeded noise texture over time.\n * WHY: deterministic handheld camera motion.\n * WHERE: consumed by core motion.\n */\nimport { z } from \'zod\'; export const NoiseSchema=z.strictObject({}); export function sampleNoise(){return 0;}',
  'src/core/targets.ts': '/** SOURCE OF TRUTH: ElementTargetSchema, resolveTarget.\n * WHAT: validate live target names and selectors.\n * WHY: keep constraints stable across layout changes.\n * WHERE: consumed by the spatial evaluator.\n */\nimport { z } from \'zod\'; export const ElementTargetSchema=z.union([z.strictObject({}),z.strictObject({})]); export function resolveTarget(){return {};}',
  'src/react/anchors.ts': '/** SOURCE OF TRUTH: measureAnchors.\n * WHAT: read transform-free element geometry.\n * WHY: publish current layout during scene playback.\n * WHERE: consumed by the React scene registry.\n */\nexport function measureAnchors(){return {};}',
  'src/core/lens.ts': '/** SOURCE OF TRUTH: perspectiveForFocalLength, focalLengthForPerspective, lensFor, LENS_PRESETS, lensPreset, applyLens.\n * WHAT: lens millimetres mapped to perspective.\n * WHY: one lens language for every shot.\n * WHERE: consumed by builders and the guide.\n */\nexport const LENS_PRESETS=Object.freeze({}); export function perspectiveForFocalLength(){return 0;} export function focalLengthForPerspective(){return 0;} export function lensFor(){return 0;} export function lensPreset(){return {};} export function applyLens(){return [];}',
  'src/core/color.ts': '/** SOURCE OF TRUTH: parseCssColor, mixColors.\n * WHAT: parse and blend CSS colors.\n * WHY: deterministic perceptual color frames.\n * WHERE: consumed by core motion.\n */\nexport function parseCssColor(){return 0;} export function mixColors(){return 0;}',
  'src/core/animatable.ts': '/** SOURCE OF TRUTH: AnimatableSpecSchema.\n * WHAT: typed animatable prop specs.\n * WHY: one contract for keyframeable props.\n * WHERE: consumed by the React hook.\n */\nimport { z } from "zod"; export const AnimatableSpecSchema=z.record(z.string(), z.number());',
  'src/react/animatable.ts': '/** SOURCE OF TRUTH: useAnimatable.\n * WHAT: read typed props at scene time.\n * WHY: components share the motion clock.\n * WHERE: consumed by kit components.\n */\nexport function useAnimatable(){return {};}',
  'src/editor/store.ts': '/** SOURCE OF TRUTH: createEditorStore.\n * WHAT: editor fixture behavior.\n * WHY: one owner for editor policy.\n * WHERE: consumed by editor panels.\n */\nexport function createEditorStore(){return {};}',
  'src/editor/intents.ts': '/** SOURCE OF TRUTH: intentToOps.\n * WHAT: editor fixture behavior.\n * WHY: one owner for editor policy.\n * WHERE: consumed by editor panels.\n */\nexport function intentToOps(){return [];}',
  'src/editor/commands.ts': '/** SOURCE OF TRUTH: EDITOR_COMMANDS.\n * WHAT: editor fixture behavior.\n * WHY: one owner for editor policy.\n * WHERE: consumed by editor panels.\n */\nexport const EDITOR_COMMANDS=Object.freeze([]);',
  'src/react/inspector.ts': '/** SOURCE OF TRUTH: useSceneInspector.\n * WHAT: editor fixture behavior.\n * WHY: one owner for editor policy.\n * WHERE: consumed by editor panels.\n */\nexport function useSceneInspector(){return undefined;}',
  'src/core/edit.ts': '/** SOURCE OF TRUTH: EditOpSchema, applyEdits.\n * WHAT: typed edit operations and reducer.\n * WHY: one vocabulary for every author.\n * WHERE: consumed by the edit command.\n */\nimport { z } from \'zod\'; export const EditOpSchema=z.discriminatedUnion(\'op\', [z.strictObject({}), z.strictObject({})]); export function applyEdits(){return {};}',
  'src/core/json.ts': '/** SOURCE OF TRUTH: formatJsonDocument.\n * WHAT: write JSON preserving formatting.\n * WHY: minimal diffs for author files.\n * WHERE: consumed by the edit command.\n */\nexport function formatJsonDocument(){return \'\';}',
  'src/project/edit.ts': '/** SOURCE OF TRUTH: executeEditCommand.\n * WHAT: apply edit batches to recipes.\n * WHY: one write policy for agents and editors.\n * WHERE: CLI calls this owner.\n */\nexport async function executeEditCommand(){return {};}',
  'src/core/motion.ts': '/** SOURCE OF TRUTH: MotionSchema, evaluateMotion, motionDuration, motionTime, cinematicProgress, cinematicTimeAtProgress, sampleFrameTime, loopSeam, monotoneTangents.\n * WHAT: validate motion and time.\n * WHY: prevent multiple competing clocks.\n * WHERE: consumed by React adapters.\n */\nimport { z } from \'zod\'; export function monotoneTangents(){return [];} export const MotionSchema=z.strictObject({}); export function evaluateMotion(){return 0;} export function motionDuration(){return 0;} export function motionTime(){return 0;} export function cinematicProgress(){return 0;} export function cinematicTimeAtProgress(){return 0;} export function sampleFrameTime(){return 0;} export function loopSeam(){return 0;}',
  'src/core/behaviors.ts': '/** SOURCE OF TRUTH: BEHAVIOR_CATALOG, buildBehavior.\n * WHAT: compile behaviors to clips.\n * WHY: share behavior definitions.\n * WHERE: consumed by the editor.\n */\nexport const BEHAVIOR_CATALOG=Object.freeze([]); export function buildBehavior(){return {};}',
  'src/core/source.ts': '/** SOURCE OF TRUTH: SourceOutlineSchema.\n * WHAT: validate source outlines.\n * WHY: share source data.\n * WHERE: consumed by the editor.\n */\nimport { z } from "zod"; export const SourceOutlineSchema=z.strictObject({});',
  'src/project/source.ts': '/** SOURCE OF TRUTH: outlineSource, wrapElement.\n * WHAT: inspect source and prepare edits.\n * WHY: preserve host formatting.\n * WHERE: used by the source bridge.\n */\nexport function outlineSource(){return [];} export function wrapElement(){return {};}',
  'src/core/presets.ts': '/** SOURCE OF TRUTH: PresetSchema.\n * WHAT: validate project presets.\n * WHY: share preset data.\n * WHERE: consumed by project adapters.\n */\nimport { z } from "zod"; export const PresetSchema=z.strictObject({});',
  'src/core/typography.ts': '/** SOURCE OF TRUTH: textAnimatorAt.\n * WHAT: evaluate text selectors.\n * WHY: share range selection.\n * WHERE: consumed by the kit.\n */\nexport function textAnimatorAt(){return [];}',
  'src/kit/text-animator.tsx': '/** SOURCE OF TRUTH: TextAnimator.\n * WHAT: render animated text.\n * WHY: share text animation.\n * WHERE: consumed by scene authors.\n */\nexport function TextAnimator(){return null;}',
  'src/kit/draw-path.tsx': '/** SOURCE OF TRUTH: DrawPath.\n * WHAT: render trimmed paths.\n * WHY: share stroke animation.\n * WHERE: consumed by scene authors.\n */\nexport function DrawPath(){return null;}',
  'src/kit/shape.tsx': '/** SOURCE OF TRUTH: Shape.\n * WHAT: render animated shapes.\n * WHY: share shape animation.\n * WHERE: consumed by scene authors.\n */\nexport function Shape(){return null;}',
  'src/core/index.ts': `export * from './scene'; export { evaluateScene, transformToCss } from './spatial';`,
};
const fixture = (file, text, options) => checkArchitecture({ ...valid, [file]: text }, options);
const rejects = (file, text, rule = 'module-boundary', options) => {
  const issues = fixture(file, text, options);
  assert.ok(issues.some(issue => issue.file === file && issue.rule === rule), JSON.stringify(issues));
};
test('host styles can only be written by the depth ledger', () => {
  rejects('src/kit/DepthFixture.tsx', `function apply(element){element.style.transform='translateZ(2px)'}`, 'host-style-ledger');
  rejects('src/react/depth/Projected.tsx', `function apply(element){element.style.setProperty('box-shadow','none')}`, 'host-style-ledger');
  rejects('src/react/depth/Volumetric.tsx', `function apply(element){element.style.cssText='color:red'}`, 'host-style-ledger');
  assert.deepEqual(fixture('src/react/depth/Volumetric.tsx', `function add(doc){ const plane=doc.createElement('div'); plane.style.transform='translateZ(2px)'; }`), []);
});

test('allowed canonical declarations, barrels, imports and browser adapter', () => {
  assert.deepEqual(checkArchitecture({ ...valid,
    'src/react/index.tsx': `import React from 'react'; import { ErrorBoundary } from 'react-error-boundary'; import { evaluateScene } from '../core'; export { SceneSchema } from '../core'; const x = document.createElement('div'); new ResizeObserver(() => {}); evaluateScene({});`,
    'src/runtime/index.ts': `export * from '../core';`,
  }), []);
});

for (const layer of ['core', 'runtime', 'react']) {
  for (const target of ['node:fs', 'fs/promises', '../demo/data', '../../demo/data', '../services/data', '../database/client', '@prisma/client', 'some-unreviewed-host-sdk']) {
    test(`${layer} rejects ${target}`, () => rejects(`src/${layer}/bad.ts`, `import thing from '${target}';`));
  }
}
for (const target of ['react', 'react/jsx-runtime', 'react-dom/client', 'react-error-boundary', '../react', '../runtime']) {
  test(`core rejects ${target}`, () => rejects('src/core/bad.ts', `import '${target}';`));
}
for (const form of [
  `export * from 'node:fs';`, `export { readFile } from 'node:fs';`,
  `import type { Stats } from 'node:fs';`, `type Stats = import('node:fs').Stats;`,
  `const x = import('node:fs');`, 'const x = import(`node:fs`);',
  `const x = require('node:fs');`, `import fs = require('node:fs');`,
  `const x = import(target);`, `const x = require('node:' + 'fs');`,
  `const load = require; load('node:fs');`, `require.resolve('node:fs');`,
]) test(`module syntax: ${form}`, () => rejects('src/react/bad.ts', form));

test('configured path aliases cannot bypass core boundary', () => {
  const issues = checkArchitecture({ ...valid, 'src/core/bad.ts': `import '@host/data';`, 'src/services/data.ts': 'export const data = 1;' }, { compilerOptions: { baseUrl: '.', paths: { '@host/*': ['src/services/*'] } } });
  assert.ok(issues.some(issue => issue.file === 'src/core/bad.ts' && issue.rule === 'module-boundary'));
});
test('allowed path alias resolves to core', () => {
  assert.deepEqual(fixture('src/react/view.ts', `import { SceneSchema } from '@core/scene';`, { compilerOptions: { baseUrl: '.', paths: { '@core/*': ['src/core/*'] } } }), []);
});
test('barrel cannot launder a disallowed dependency', () => {
  const issues = checkArchitecture({ ...valid, 'src/react/index.ts': `import './barrel';`, 'src/react/barrel.ts': `export * from '../services/data';` });
  assert.ok(issues.some(issue => issue.file === 'src/react/barrel.ts' && issue.rule === 'module-boundary'));
});

for (const expression of ['window.innerWidth', 'document.body', 'fetch("/")', 'new ResizeObserver(() => {})', 'new DOMMatrix()', 'requestAnimationFrame(() => {})', 'globalThis.document', 'globalThis["document"]', 'const { document: doc } = globalThis', 'process.env', 'Buffer.from("x")']) {
  test(`core rejects runtime global ${expression}`, () => rejects('src/core/bad.ts', expression, 'runtime-global'));
}
for (const expression of ['process.env', 'Buffer.from("x")', 'globalThis.process', 'globalThis["Buffer"]', 'globalThis[key]', 'const { Buffer } = globalThis', 'const host = globalThis; host.process']) {
  test(`React rejects Node global ${expression}`, () => rejects('src/react/bad.ts', expression, 'runtime-global'));
}
test('runtime rejects browser globals', () => rejects('src/runtime/bad.ts', 'document.body;', 'runtime-global'));
for (const layer of ['core', 'runtime']) test(`${layer} rejects implicit JSX dependencies`, () => rejects(`src/${layer}/bad.tsx`, 'const node = <div />;'));
test('AST avoids false positives from text, properties, type references and shadowed globals', () => {
  assert.deepEqual(fixture('src/core/allowed.ts', `
    // import fs from 'node:fs'; document.body; const SceneSchema = {};
    const message = "require('react'); window.innerWidth";
    type DOMType = HTMLElement;
    type HostType = typeof window;
    const record = { document: 'label', window: 1 };
    const value = record.document;
    function local(document: { body: number }, require: (x: string) => string) {
      return { document, value: document.body, module: require('node:fs') };
    }
  `), []);
});
test('shorthand global reads still fail', () => rejects('src/core/bad.ts', 'const globals = { document };', 'runtime-global'));

for (const [symbol, expression] of [
  ['SceneSchema', 'const SceneSchema = {};'], ['TransformSchema', 'class TransformSchema {}'],
  ['evaluateScene', 'function evaluateScene() { return {}; }'], ['transformToCss', `const transformToCss = () => 'none';`],
  ['SceneSchema', 'interface SceneSchema {}'], ['SceneSchema', 'type SceneSchema = {};'],
  ['SceneSchema', 'const { SceneSchema } = source;'], ['SceneSchema', 'function view(SceneSchema: unknown) {}'],
]) test(`duplicate canonical declaration: ${expression}`, () => rejects('src/react/duplicate.ts', expression, 'canonical-owner'));

test('duplicate canonical implementation in owner fails', () => {
  const issues = fixture('src/core/spatial.ts', valid['src/core/spatial.ts'] + '\nexport function evaluateScene() { return 1; }');
  assert.ok(issues.some(issue => issue.rule === 'canonical-presence'));
});
for (const text of [
  sceneDoc, `${sceneDoc}\nexport type SceneSchema = {}; export type TransformSchema = {};`,
  `${sceneDoc}\nexport const SceneSchema = {}; export const TransformSchema = {};`,
  `${sceneDoc}\ndeclare const SceneSchema: unknown; declare const TransformSchema: unknown;`,
  `${sceneDoc}\nexport { SceneSchema, TransformSchema } from './copy';`,
  `${sceneDoc}\nconst z = { strictObject: () => ({}) }; export const SceneSchema = z.strictObject({}); export const TransformSchema = z.strictObject({});`,
]) test(`owner file cannot substitute for implementations: ${text.slice(sceneDoc.length)}`, () => {
  assert.ok(fixture('src/core/scene.ts', text).some(issue => issue.rule === 'canonical-presence'));
});
test('empty function or signature cannot satisfy evaluator presence', () => {
  const incomplete = valid['src/core/spatial.ts']
    .replace('export function evaluateScene(input: unknown) { return SceneSchema.parse(input); }', 'export function evaluateScene(): void;')
    .replace("export const transformToCss = () => 'none';", 'export function transformToCss() {}');
  const missing = fixture('src/core/spatial.ts', incomplete).filter(issue => issue.rule === 'canonical-presence');
  assert.deepEqual(missing.map(issue => issue.message), [
    'Expected exactly one exported runtime implementation of evaluateScene in src/core/spatial.ts.',
    'Expected exactly one exported runtime implementation of transformToCss in src/core/spatial.ts.',
  ]);
});
test('absent owner fails even if declarations are elsewhere', () => {
  const { 'src/core/scene.ts': scene, ...rest } = valid;
  const issues = checkArchitecture({ ...rest, 'src/core/copy.ts': scene });
  assert.ok(issues.some(issue => issue.rule === 'canonical-presence'));
  assert.ok(issues.some(issue => issue.rule === 'canonical-owner'));
});
for (const replacement of ['', '/* SOURCE OF TRUTH: SceneSchema TransformSchema WHAT: WHY: WHERE: */', 'const documentation = ' + JSON.stringify(sceneDoc) + ';', sceneDoc.replace('WHY: keep all consumers consistent.', 'WHY: TODO')]) {
  test(`owner documentation must have meaningful comment clauses: ${replacement.slice(0, 40)}`, () => rejects('src/core/scene.ts', valid['src/core/scene.ts'].replace(sceneDoc, replacement), 'owner-documentation'));
}
test('syntax errors cannot silently pass', () => rejects('src/react/bad.ts', 'export const = ;', 'syntax'));

test('actual source obeys architecture, including React whenever present', () => {
  assert.deepEqual(checkProject(root), []);
});
test('CLI succeeds for allowed source, fails for violations and missing source', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'velora-architecture-'));
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/check-architecture.mjs'), directory], { encoding: 'utf8' });
  try {
    assert.equal(run().status, 1);
    for (const [name, text] of Object.entries(valid)) {
      mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
      writeFileSync(path.join(directory, name), text);
    }
    mkdirSync(path.join(directory,'docs'));
    writeFileSync(path.join(directory,'docs/architecture.md'),'# Architecture');
    writeFileSync(path.join(directory,'docs/product.md'),'# Product');
    const allowed = run();
    assert.equal(allowed.status, 0, allowed.stderr);
    writeFileSync(path.join(directory,'docs/rogue.md'),'untracked extra document');
    const badDocs=run();
    assert.equal(badDocs.status,1);
    assert.match(badDocs.stderr,/documentation-boundary/);
    rmSync(path.join(directory,'docs/rogue.md'));
    assert.equal(run().status,0);
    writeFileSync(path.join(directory, 'src/core/bad.ts'), `export * from 'node:fs';`);
    const denied = run();
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /src\/core\/bad\.ts:1:\d+ \[module-boundary\]/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for(const symbol of ['sampleFocus','focusMask','focusForSurface','cameraToCss','evaluateMotion','MotionSchema'])test('rejects duplicate '+symbol+' owner',()=>rejects('src/react/duplicate.ts',`export const ${symbol}=()=>0;`,'canonical-owner'));

function docsFixture(run) {
  const directory=mkdtempSync(path.join(tmpdir(),'velora-docs-'));
  try {
    mkdirSync(path.join(directory,'docs'));
    for(const name of ['architecture.md','product.md'])writeFileSync(path.join(directory,'docs',name),'# Canonical');
    run(directory);
  } finally {rmSync(directory,{recursive:true,force:true});}
}
test('documentation accepts exactly the two canonical regular files',()=>docsFixture(root=>assert.deepEqual(checkDocumentation(root),[])));
for(const name of ['random.md','image.png','.hidden'])test('documentation rejects extra '+name,()=>docsFixture(root=>{
 writeFileSync(path.join(root,'docs',name),'extra');
 assert.ok(checkDocumentation(root).some(issue=>issue.file==='docs/'+name));
}));
test('documentation rejects incorrectly cased canonical filenames',()=>docsFixture(root=>{
 rmSync(path.join(root,'docs/architecture.md'));
 writeFileSync(path.join(root,'docs/Architecture.md'),'incorrect casing');
 const issues=checkDocumentation(root);
 assert.ok(issues.some(issue=>issue.file==='docs/Architecture.md'));
 assert.ok(issues.some(issue=>issue.file==='docs/architecture.md'));
}));
test('documentation rejects nested directories even with allowed basenames',()=>docsFixture(root=>{
 mkdirSync(path.join(root,'docs/nested'));writeFileSync(path.join(root,'docs/nested/architecture.md'),'extra');
 assert.ok(checkDocumentation(root).some(issue=>issue.file==='docs/nested'));
}));
test('documentation requires both files and its directory',()=>docsFixture(root=>{
 rmSync(path.join(root,'docs/product.md'));assert.ok(checkDocumentation(root).some(issue=>issue.file==='docs/product.md'));
 rmSync(path.join(root,'docs'),{recursive:true});assert.ok(checkDocumentation(root).some(issue=>issue.file==='docs'));
}));
test('documentation rejects symlink files and symlink directory',()=>docsFixture(root=>{
 rmSync(path.join(root,'docs/product.md'));symlinkSync('architecture.md',path.join(root,'docs/product.md'));
 assert.ok(checkDocumentation(root).some(issue=>issue.file==='docs/product.md'));
 rmSync(path.join(root,'docs'),{recursive:true});mkdirSync(path.join(root,'other'));symlinkSync('other',path.join(root,'docs'));
 assert.ok(checkDocumentation(root).some(issue=>issue.file==='docs'));
}));

test('runtime rejects the React error adapter', () => rejects('src/runtime/bad.ts', `import 'react-error-boundary';`));

for (const [file, target] of [
  ['src/cli/bypass.ts','../project/services'],
  ['src/cli/bypass.ts','../project/adapter'],
  ['src/project/adapter.ts','./services'],
  ['src/project/commands.ts','node:fs/promises'],
  ['src/preview/bypass.ts','../project/commands'],
  ['src/react/bypass.ts','../project/services'],
  ['src/preview/bypass.ts','node:fs'],
]) test(`project boundary rejects ${file} → ${target}`,()=>rejects(file,`import x from '${target}';`));
for (const file of ['src/preview/unsafe.ts','src/project/adapter.ts','src/project/commands.ts'])
 test(`project boundary rejects direct fetch in ${file}`,()=>{
  // Preview can use browser APIs, but trusted project effects stay out of commands/adapter.
  if(!file.includes('preview')) rejects(file,'fetch("http://localhost");','runtime-global');
  else rejects(file,'process.cwd();','runtime-global');
 });
test('CLI cannot launder a filesystem service through a project barrel',()=>{
 const issues=checkArchitecture({...valid,'src/cli/entry.ts':`import { read } from '../project/barrel';`,'src/project/barrel.ts':`export { read } from './services';`,'src/project/services.ts':'export const read=()=>0;'});
 assert.ok(issues.some(i=>i.rule==='module-boundary'&&i.file==='src/project/barrel.ts'));
});
test('project service effects and pure adapters have explicit allowed layers',()=>{
 const issues=checkArchitecture({...valid,
 'src/project/services.ts':`import { readFile } from 'node:fs/promises'; import { spawn } from 'node:child_process'; const root=process.cwd(); fetch('http://127.0.0.1');`,
 'src/project/adapter.ts':`import ts from 'typescript'; import { InitProjectSchema } from '../core/project';`,
 'src/preview/index.tsx':`import {Scene} from '../react'; import {useState} from 'react'; const x=<Scene/>;`,
 'src/cli/main.ts':`import {executeProjectCommand} from '../project/commands'; executeProjectCommand(); process.cwd();`,
 });
 assert.deepEqual(issues,[]);
});

for (const expression of [
  `export * from '../project/services';`,
  `const service = import('../project/services');`,
  `const service = require('../project/services');`,
  `type Service = import('../project/services').Service;`,
]) test('CLI rejects service bypass form '+expression,()=>rejects('src/cli/bypass.ts',expression));
test('CLI service alias cannot bypass project operations',()=>{
  const issues=checkArchitecture({...valid,
    'src/cli/entry.ts':`import { read } from '@services';`,
    'src/project/services.ts':`export const read=()=>0;`,
  },{compilerOptions:{baseUrl:'.',paths:{'@services':['src/project/services.ts']}}});
  assert.ok(issues.some(i=>i.file==='src/cli/entry.ts'&&i.rule==='module-boundary'));
});
test('renamed project-command declaration cannot replace canonical owner',()=>{
  const issues=checkArchitecture({...valid,'src/project/commands.ts':'export async function otherCommand() { return {}; }'});
  assert.ok(issues.some(i=>i.rule==='canonical-presence'&&i.message.includes('executeProjectCommand')));
});

test('shared project errors cannot become an effect bypass',()=>rejects('src/project/errors.ts',`import {readFile} from 'node:fs/promises';`));
test('services may share pure diagnostics without importing project policy',()=>{
 const issues=checkArchitecture({...valid,
 'src/project/errors.ts':`export const fault = (message:string) => new Error(message);`,
 'src/project/services.ts':`import {fault} from './errors'; import {readFile} from 'node:fs/promises';`,
 });
 assert.deepEqual(issues,[]);
});

test("uniform blur classification cannot move into a renderer", () => rejects("src/react/copied.ts", "export function uniformFocusBlur() { return 0; }", "canonical-owner"));

test('export UI cannot bypass the trusted command',()=>rejects('src/cli/bypass.ts',"import '../export/services';"));
test('export commands cannot import Node effects',()=>rejects('src/export/commands.ts',"import 'node:fs';"));
test('cascade builder cannot be reimplemented in React',()=>rejects('src/react/cascade.ts',"export function createCascadeTracks(){return [];}",'canonical-owner'));

test('authoring concepts cannot acquire a competing CLI owner',()=>{
 rejects('src/cli/guide.ts','export function getAuthoringGuide(){return {purpose:"copied"};}', 'canonical-owner');
});

test('preview cannot establish a competing scene validator',()=>rejects('src/preview/copied.ts','export function presentPreview(){return {};}', 'canonical-owner'));
test('React cannot bypass the preview session owner',()=>rejects('src/react/copied.ts','export function usePreviewSession(){return {};}', 'canonical-owner'));

test('recipe loader cannot be redeclared in preview',()=>{assert.ok(fixture('src/preview/fork.ts','export function loadSceneRecipes(){return {}}').some(issue=>issue.rule==='canonical-owner'))});
test('recipe commands may use scoped services while preview cannot',()=>{assert.ok(fixture('src/preview/leak.ts',"import {readText} from '../project/services'; export const leaked=readText;").some(issue=>issue.rule==='module-boundary'))});

test('CLI cannot duplicate scene request schemas',()=>{assert.ok(fixture('src/cli/repeated.ts',"import {z} from 'zod';export const OpenSceneSchema=z.strictObject({});").some(issue=>issue.rule==='canonical-owner'))});
test('snapshot schemas and command keep canonical owners',()=>{
 for(const symbol of ['SceneSnapshotSchema','SnapshotSceneSchema','executeSceneSnapshot'])rejects('src/preview/copied.ts',`export const ${symbol}=()=>({});`,'canonical-owner');
});
test('preview cannot call snapshot filesystem or browser effects',()=>rejects('src/preview/capture.ts',"import {openCapture} from '../export/services'; openCapture({});",'module-boundary'));

test("rejects another branding owner",()=>{ rejects("src/preview/brand.ts", "export const VELORA_BRAND=Object.freeze({});", "canonical-owner"); });
test("rejects another package identity owner",()=>{ rejects("src/project/package.ts", "export const VELORA_PACKAGE=Object.freeze({name:'velora'});", "canonical-owner"); });

// Framework adapters must reuse the shared owners, never establish competing policy.
test('framework connection cannot duplicate canonical recipe discovery', () => {
  const issues=checkArchitecture({'src/project/other.ts':'export async function discoverRecipes() { return {}; }'});
  assert.ok(issues.length);
});

// Kit layer: browser building blocks over core and react only, never project or export effects.
test('kit may compose core and react', () => {
  assert.deepEqual(fixture('src/kit/Frame.tsx', "import {useChannel} from '../react'; import {RouteSchema} from '../core/templates'; export function Frame(){useChannel('x'); RouteSchema.parse('/'); return <div/>;}").filter(issue => issue.file === 'src/kit/Frame.tsx'), []);
});
test('kit cannot reach project services', () => rejects('src/kit/Frame.tsx', "import {readText} from '../project/services'; export function Frame(){readText('a','b'); return null;}"));
test('kit cannot reach export services', () => rejects('src/kit/Frame.tsx', "import {openCapture} from '../export/services'; export function Frame(){openCapture({}); return null;}"));
test('kit cannot read node globals', () => rejects('src/kit/Frame.tsx', "export function Frame(){return process.cwd();}", 'runtime-global'));

// v2.1 Phase 00.5 layers: editor, three, bridgeServices and sourceAdapter, each with precise rule ids.
test('v2.1 positive fixtures: editor composes preview, three composes React Three Fiber', () => {
  const issues = checkArchitecture({ ...valid,
    'src/editor/Inspector.tsx': `import {useState} from 'react'; import {Scene} from '../react'; import {ScenePreview} from '../preview/ScenePreview'; import {applyEasing} from '../core/easing'; export function Inspector(){useState(0); applyEasing(); return <Scene/>;}`,
    'src/three/ThreeSurface.tsx': `import {Canvas} from '@react-three/fiber'; import {Mesh} from 'three'; import {useChannel} from '../react'; export function ThreeSurface(){useChannel('x'); return <Canvas/>;}`,
    'src/preview/EditMode.tsx': `export const loadEditor = () => import('../editor/Inspector');`,
    'src/project/services/bridge.ts': `import {createServer} from 'node:http'; import {atomic} from '../services'; const port = process.env.PORT; createServer();`,
    'src/project/services.ts': `export const atomic=()=>0;`,
    'src/project/source.ts': `${valid['src/project/source.ts']}\nimport ts from 'typescript'; export const outline=()=>ts.version;`,
    'src/project/edit.ts': `/** SOURCE OF TRUTH: executeEditCommand.
 * WHAT: apply edit batches to recipes.
 * WHY: one write policy for agents and editors.
 * WHERE: CLI calls this owner.
 */
import {outline} from './source'; import {createServer} from './services/bridge'; outline(); export async function executeEditCommand(){return {};}`,
  });
  assert.deepEqual(issues, []);
});
for (const [file, text, rule] of [
  ['src/editor/save.ts', `import {executeProjectCommand} from '../project/commands';`, 'editor-project-boundary'],
  ['src/editor/save.ts', `import {atomicWrite} from '../project/services';`, 'editor-project-boundary'],
  ['src/editor/render.ts', `import {executeVideoExport} from '../export/commands';`, 'editor-project-boundary'],
  ['src/editor/render.ts', `const x = import('../export/services');`, 'editor-project-boundary'],
  ['src/preview/Shell.tsx', `import {Inspector} from '../editor/Inspector';`, 'editor-lazy-boundary'],
  ['src/preview/Shell.tsx', `const editor = import('../editor/Inspector');`, 'editor-lazy-boundary'],
  ['src/preview/EditMode.tsx', `import {Inspector} from '../editor/Inspector';`, 'editor-lazy-boundary'],
  ['src/editor/Gizmo.tsx', `import {useFrame} from '@react-three/fiber';`, 'editor-three-boundary'],
  ['src/editor/Gizmo.tsx', `import {Mesh} from 'three';`, 'editor-three-boundary'],
  ['src/editor/Gizmo.tsx', `import {ThreeSurface} from '../three/ThreeSurface';`, 'editor-three-boundary'],
  ['src/core/ease.ts', `import gsap from 'gsap';`, 'gsap-ban'],
  ['src/react/ease.ts', `import {CustomEase} from 'gsap/CustomEase';`, 'gsap-ban'],
  ['src/editor/ease.ts', `import {useGSAP} from '@gsap/react';`, 'gsap-ban'],
  ['src/kit/ease.tsx', `const g = import('gsap');`, 'gsap-ban'],
  ['src/three/ease.ts', `import gsap from 'gsap';`, 'gsap-ban'],
  ['src/core/color.ts', `import React from 'react';`, 'module-boundary'],
  ['src/core/color.ts', `import {Canvas} from '@react-three/fiber';`, 'module-boundary'],
  ['src/three/leak.ts', `import {readFile} from 'node:fs';`, 'module-boundary'],
  ['src/three/leak.ts', `import {Inspector} from '../editor/Inspector';`, 'module-boundary'],
  ['src/project/source.ts', `import {readFile} from 'node:fs/promises';`, 'module-boundary'],
  ['src/project/services/bridge.ts', `import {executeProjectCommand} from '../commands';`, 'module-boundary'],
]) test(`v2.1 layer rejects ${file}: ${text}`, () => rejects(file, text, rule));
test('v2.1 editor cannot read Node globals', () => rejects('src/editor/env.ts', 'process.env.HOME;', 'runtime-global'));

test('v2.1 Phase 01 owners cannot be reimplemented elsewhere', () => {
  for (const text of ['export function parseCssColor(){return 0;}', 'export const mixColors=()=>0;', 'export function monotoneTangents(){return [];}', 'export function useAnimatable(){return {};}'])
    rejects('src/kit/copied.ts', text, 'canonical-owner');
  rejects('src/preview/copied.ts', "import {z} from 'zod'; export const AnimatableSpecSchema=z.record(z.string(), z.number());", 'canonical-owner');
});
test('a record schema needs key and value schemas to count as an implementation', () => {
  const doc = '/** SOURCE OF TRUTH: AnimatableSpecSchema.\n * WHAT: typed animatable prop specs.\n * WHY: one contract for keyframeable props.\n * WHERE: consumed by the React hook.\n */\n';
  assert.ok(fixture('src/core/animatable.ts', doc + "import { z } from 'zod'; export const AnimatableSpecSchema=z.record();").some(issue => issue.rule === 'canonical-presence'));
});

test('v2.1 Phase 02 owners cannot be reimplemented elsewhere', () => {
  for (const text of ['export function createCascadeClip(){return {};}', 'export function buildOrbitRig(){return {};}', 'export const resolveConstraints=()=>({});'])
    rejects('src/react/copied.ts', text, 'canonical-owner');
});

test('v2.1 Phase 03 owners cannot be reimplemented elsewhere', () => {
  for (const text of ['export function applyEdits(){return {};}', 'export function formatJsonDocument(){return "";}', 'export async function executeEditCommand(){return {};}'])
    rejects('src/cli/copied.ts', text, 'canonical-owner');
  rejects('src/preview/copied.ts', "import {z} from 'zod'; export const EditOpSchema=z.discriminatedUnion('op', [z.strictObject({}), z.strictObject({})]);", 'canonical-owner');
});

test('v2.1 Phase 06 projection owners cannot be reimplemented elsewhere', () => {
  for (const text of ['export function projectWorld(){return null;}', 'export const screenRay=()=>({});', 'export function intersectPlane(){return null;}', 'export function surfaceQuad(){return [];}'])
    rejects('src/editor/viewport/copied.ts', text, 'canonical-owner');
});

test('v2.1 Phase 04 owners cannot be reimplemented elsewhere', () => {
  for (const text of ['export function createEditorStore(){return {};}', 'export function intentToOps(){return [];}', 'export const EDITOR_COMMANDS=Object.freeze([]);', 'export function useSceneInspector(){return undefined;}'])
    rejects('src/preview/copied.ts', text, 'canonical-owner');
});
test('frozen catalogs must be frozen literals', () => {
  assert.ok(fixture('src/editor/commands.ts', '/** SOURCE OF TRUTH: EDITOR_COMMANDS.\n * WHAT: editor fixture behavior.\n * WHY: one owner for editor policy.\n * WHERE: consumed by editor panels.\n */\nexport const EDITOR_COMMANDS=[];').some(issue => issue.rule === 'canonical-presence'));
});
