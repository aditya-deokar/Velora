# Phase 00 — Stabilize

## Goal
Make the published package installable and the render loop trustworthy before any new
capability lands. A fresh `npm install @adityadeokar/velora && npx velora init` must work end
to end. Re-renders must reflect host edits. Realistic launch-film lengths must render
without exhausting memory. Shipped templates must be valid. CI must catch regressions on
every push.

## Prerequisites
- v1 gates green at commit `4b67a68` (`plan/artifacts/phase-09-exit.md`).

## Scope IN
- One package-identity source of truth, used by every generator, detector, guide, skill and script.
- Frame-cache invalidation on host source edits.
- Bounded-memory video rendering.
- Repairing the two broken shipped templates, plus a template validity test.
- A CI test workflow (fast tier on 3 OSes, browser tier on Linux).
- Docs honesty fixes, a docs-example validation test and a CHANGELOG.

## Scope OUT
- New authoring features (Phase 01+), the template system (Phase 02), render-quality changes (Phase 04).
- Publishing. The version bump to `0.1.3` and `npm publish` remain the maintainer's step.

## Tasks

### 00.1 Package identity — single source of truth
1. `src/core/branding.ts`: add
   `VELORA_PACKAGE = Object.freeze({name:'@adityadeokar/velora', preview:'@adityadeokar/velora/preview', legacyNames:Object.freeze(['velora','@webprodigies/velora'])})`.
   - Register it as a canonical owner in `scripts/check-architecture.mjs`, and generalize the `VELORA_BRAND` frozen-object special case (lines 137, 161) to both symbols.
   - Add a competing-owner fixture to `tests/architecture.test.mjs`.
   - Surface it in the guide as `capabilities.package`.
2. Route every consumer through it:
   - `src/project/vite.ts`: generated `ProjectPreview` imports `VELORA_PACKAGE.preview`; entry detection still recognizes legacy specifiers.
   - `src/project/portable.ts`: generated wrapper imports `VELORA_PACKAGE.preview`.
   - `src/project/commands.ts`:
     - `packageAt` dependency regex
     - toolkit lookup across `[name, ...legacyNames]`
     - name allowlist
     - transformed-module detection
     - VELORA.md text
     - install hint
   - `src/project/services.ts`: `readDependency` allowlist.
   - `src/core/authoring.ts`: example `componentSource`, `hostIntegration` and `ScenePreview` text.
3. **Legacy upgrade.** Re-running `init` treats adapter bytes produced by the previous generator (legacy specifier) as Velora-owned and rewrites them. User-edited adapters are still refused by the existing ownership/journal logic. Test both.
4. Scripts:
   - `scripts/check-installed.mjs`, `check-agent-trial.mjs` (normalize the scoped specifier) and `verify-iteration.mjs` read the package name from `package.json`.
   - Update the `release.mjs` comment.
5. Fixtures and dogfood host:
   - `local-project/package.json` drops the stale `velora` file dependency.
   - Imports in `local-project/`, `tests/examples/**`, `tests/agent/demo-*/host/**` and `tests/fixtures/**` use the scoped name.
   - Assertions in `tests/project/commands.test.ts`, `tests/project/portable.test.ts` and `tests/core/gsap.test.ts` are updated.
6. Docs and skills:
   - USER_GUIDE.md
   - README maintainer section
   - `docs/product.md`, `docs/architecture.md`
   - `skills/velora-scenes/SKILL.md`, `skills/velora/templates/**`, `skills/velora/scripts/new-scene.mjs`

### 00.2 Frame cache sees host edits
- `src/export/services.ts`: add `hostFingerprint(root)`.
  - Takes a stat-only walk: a SHA-256 over sorted `relPath|size|mtimeMs` for source and asset extensions, plus the lockfile.
  - Skips `node_modules`, `.git`, `dist`, `build`, `.next`, `.release`, `.test-dist`, `test-results`, `.velora` and dot-dirs.
  - Above a 20k-file cap it returns `undefined`, and caching is disabled for that command with a warning instead of serving stale frames.
- `frameCacheKey` gains `hostSha`. `renderTimelineFrames` computes the fingerprint once per command.

### 00.3 Bounded-memory video render
- `renderTimelineFrames` gains an optional `onFrame(entry)` sink. When a sink is supplied, results keep metadata only (no PNG buffers).
- `executeVideoRender` writes each frame to `<tmp>/frames/%06d.png` and encodes with the FFmpeg image2 demuxer via a new `encodeFrameSequence()`. The new function reuses the same `videoEncodeArgs` codec settings, so the output stays byte-equivalent in content.
- `frame` and `frames` modes are unchanged.

### 00.4 Repair shipped templates
- `product-survey/survey.tsx`: valid default export with a labeled placeholder panel, plus a comment to replace it with the real component and providers.
- `webgl-stage/stage.tsx`: default export using `WebGLSurface` with a real time-driven clear/gradient from `useSceneTime()`.
- All templates import from `@adityadeokar/velora`. READMEs are updated.

### 00.5 CI workflow — `.github/workflows/ci.yml`
- **Triggers:** `pull_request` and `push`, with concurrency cancel-in-progress and action SHAs pinned like `publish.yml`.
- **fast job:** matrix `{ubuntu-latest, windows-latest, macos-latest} × Node {22.12.0, 24}`. Runs `npm ci`, `typecheck`, `lint:architecture`, `test:architecture`, `test:core`, `test:react`, `test:skills`, `test:release`.
- **browser job:** ubuntu, Node 24. Installs Playwright Chromium (`--with-deps`) and apt `ffmpeg`, then runs `build`, `test:browser`, `test:launch`, `test:export`, `test:installed`.
- Hardware timing (`test:performance`) and `verify:release` stay local.
- README maintainer section now describes CI.

### 00.6 Docs honesty and release hygiene
- USER_GUIDE.md:
  - Replace the invalid composition example with a schema-valid one. The old example used `assets[].kind/volume`; the real `CompositionAssetSchema` is `{id,path,type}` with audio under `audio[]`.
  - Correct the "uncompressed frame from the GPU buffer" claim: capture uses Playwright PNG screenshots.
  - Use the scoped install command.
- New `tests/docs/examples.test.ts`: JSON code blocks in README.md and USER_GUIDE.md that declare a recipe or composition validate against the canonical schemas.
- New `CHANGELOG.md` (Keep a Changelog) with an `Unreleased` section listing these fixes.

## Contracts
| Surface | Change |
|---|---|
| `VELORA_PACKAGE` | New canonical owner in `src/core/branding.ts`; guide `capabilities.package` |
| Generated adapters | Import `@adityadeokar/velora/preview`; legacy bytes upgraded by `init` |
| Frame cache | Key includes host fingerprint; above the cap, cache disabled with warning `cache-disabled` |
| `render --out *.mp4` | Same output contract; frames spill to a temp dir instead of memory |
| Templates | Every shipped template pair validates and binds a default export |

## Files
- `src/core/branding.ts`, `src/core/authoring.ts`
- `src/project/{vite,portable,commands,services}.ts`
- `src/export/{commands,services}.ts`
- `scripts/check-architecture.mjs`, `scripts/{check-installed,check-agent-trial,verify-iteration,release}.mjs`
- `skills/velora/templates/**`, `skills/velora/scripts/new-scene.mjs`, `skills/velora-scenes/SKILL.md`
- `local-project/**`, `tests/**` fixtures
- New: `.github/workflows/ci.yml`, `CHANGELOG.md`
- README.md, USER_GUIDE.md, `docs/product.md`, `docs/architecture.md`

## Tests
- `tests/project/package-identity.test.ts` (new):
  - name equality with package.json;
  - generated Vite and portable adapters import `VELORA_PACKAGE.preview`;
  - guide example imports `VELORA_PACKAGE.name`;
  - regression scan of skills, docs and templates for bare `'velora'` / `velora/preview` imports.
- `tests/export/cache-invalidation.test.ts` (new): fingerprint changes on an imported-component edit, stays stable when nothing changes, and respects exclusions and the cap.
- `tests/export/video-memory.test.ts` (new): video mode keeps no PNG buffers in its result map; frames are encoded from a sequence.
- `tests/cli/templates-valid.test.ts` (new):
  - every template recipe validates through `loadSceneRecipes`;
  - every binding has a default export (TypeScript AST);
  - binding `Surface` id literals ⊇ recipe node ids.
- `tests/docs/examples.test.ts` (new).
- `tests/architecture.test.mjs`: `VELORA_PACKAGE` competing-owner fixture.

## Validation criteria
- [ ] `npm run typecheck && npm run lint:architecture && npm run test:architecture && npm run test:core && npm run test:react && npm run test:skills && npm run test:release` green.
- [ ] `npm run test:launch && npm run test:export` green.
- [ ] `npm run release:local && npm run test:installed` green: the tarball installs as `node_modules/@adityadeokar/velora`, and init, studio, snapshot and MP4 all pass.
- [ ] `npm run test:agent-demos` green with recorded pixel SHAs unchanged.
- [ ] Manual Windows smoke:
  1. Create a fresh Vite React app and install the scoped tarball.
  2. `npx velora init --json` succeeds.
  3. `npx velora doctor --url <origin> --json` passes every check.
  4. `/?velora-preview=1` renders the library.
  5. `velora shot` writes a PNG.
- [ ] Peak RSS of a 20 s 1080p60 render recorded; it is bounded and independent of frame count.

## Anti-patterns
- Hard-coding the package name anywhere except `VELORA_PACKAGE` (src) or `package.json` (scripts/tests).
- "Fixing" stale caches by disabling the cache globally.
- Changing encoder settings while moving frames to disk (that is Phase 04).
- Rewriting user-edited adapters during the legacy upgrade.

## Definition of Done
All validation boxes checked. `plan/v2/artifacts/phase-00-exit.md` records the command output,
the RSS evidence and the fresh-install smoke transcript. Changes are reviewed by the
maintainer before any commit or release.
