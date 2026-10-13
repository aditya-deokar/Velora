# Phase 09 Exit — Agent Loop Closure, Examples, Gates & Adoption (2026-10-14)

## 09.0 Local-project dev fix (user-reported)

`npm run dev` in `local-project/` failed with `Failed to resolve import
"velora/preview"`: `node_modules/velora` was absent (stale
`file:../.local-package/velora-0.1.0.tgz` reference, no `.local-package/`
output). Root cause beyond the missing install: every gate script spawned
bare `npm`, which fails on Windows (`ENOENT`/`EINVAL` — `npm.cmd` needs a
shell). Fixed with a shared `scripts/npm-cmd.mjs` (`NPM`, `npmCmd`,
`NPM_SHELL`) wired through `prepack`, `setup-local`, `pack-release`,
`release.mjs`, `verify-mvp.mjs`, `check-installed`, `check-library`, and
`check-portable`. Then `npm run build && npm run setup:local` packed 0.1.2,
installed it, and re-ran init; `npm run dev` serves the preview (HTTP 200)
and the transformed `ProjectPreview.tsx` module resolves `velora/preview`.
A troubleshooting entry was added to `local-project/README.md`.

## 09.1 Demos (real CLI runs, recorded evidence)

- **Demo A** (`tests/agent/demo-a/`, live-UI teaser): init → inspect →
  multi-scene composition (transition + kinetic title + narration + SRT) →
  validate → gap proofs → full 135-frame MP4 → `check --video` green.
  Three genuine detected-and-fixed issues are logged with real excerpts:
  `ERR_CAPTION_TIMING` (span fix), truncated 500ms MP4 from a 0.5s narration
  track (extended to 4.5s; 120/135 frames cache-served on re-render),
  blank sample on the kinetic fade-in (steepened first-word entrance).
  Final MP4 `63c75167…` (24512 bytes, git-ignored, hash recorded).
- **Demo B** (`tests/agent/demo-b/`, procedural/3D): seeded procedural stage
  + time-disciplined canvas leaf + focus-pull → two independent full renders
  (`--no-cache` second capture) diffed identical with
  `compare-renders.mjs` (75/75 SHAs), `check --video` green. One dim-content
  `ERR_VISUAL_BLANK` found and fixed by brightening leaf paint.
- Each demo ships `prompt.md`, `skills-trace.md`, `transcript.json`
  (per-step skill, command, expected code, replayable flag, requires tags),
  `issue-fix-log.md`, `expected-hashes.json`, committed stills + video
  manifests, and one anchor PNG.
- `scripts/check-agent-demos.mjs` (`test:agent-demos`, wired into
  `verify-mvp.mjs` installed group): replays every replayable transcript step
  in disposable hosts (npm install + tarball + init included), re-renders gap
  frames twice for self-determinism against recorded SHAs, re-verifies the
  committed run-manifest agreement, and asserts skill-trace coverage against
  `CLI_COMMANDS` ownership plus front-matter claims. Green.

## Product fix found by the demos

Video `no-blank` sampled gap windows (black void by design) while the frames
suite excludes them. `src/export/commands.ts` now excludes manifest-mapped
gap samples from video blank detection with a `(timeline gaps excluded)`
note. Existing `check.test.ts` stays green.

## 09.2 Examples (decision: `tests/examples/`, no new top-level dir)

`saas-tour`, `kinetic-explainer`, `data-story` — each with README (prompt →
skills → commands), composition, recipes, bindings, and SRT. No new build or
package wiring needed: nothing outside `dist/`, `skills/`, docs, tests, and
`local-project/` ships. `tests/project/examples.test.ts` proves recipes
resolve, transitions fit leaf-owning scenes, captions cover timelines, and
gap frames render deterministically offline (recorded void SHA).

## 09.3 Gates + release

- `release.mjs` was red on the real manifest three times over: scoped-name
  identity vs the public unscoped `velora` (accepted, documented), skills
  files rejected by the allowlist (extended: root + reference + templates +
  scripts + `velora-*/SKILL.md`, still rejecting tests, fixtures, dotfiles,
  traversal), and executable-bit assertion on Windows packs (note + strict on
  POSIX). `release.mjs check` now passes; the 0.1.2 tarball ships 37 skills
  files and zero tests/fixtures. `tests/release.test.mjs` covers the new
  policy (41 tests green).
- `tsconfig.json` excludes disposable fixture hosts (`tests/agent/demo-*/host`,
  `tests/examples`) so root typecheck stays green.
- Chain: `verify:launch` 370/370, `test:core` 250/250, `test:skills`,
  `test:agent-demos`, `test:release` green; `verify:agent`/`verify:release`
  fold in the new gates via `verify-mvp.mjs`.

## 09.4 Adoption

README gained a copy-pasteable five-minute path, a compatibility matrix
(agents × React × Node × FFmpeg/Chromium, BYO subscription), limits, and
migration notes (`flute`/`velora` dual name, recipe v1 / focus v3,
`init`-owned wrapper upgrades); the maintainer release checklist now pins
skill versions and demo gates. `skills/velora/COMPATIBILITY.md` carries the
same matrix plus honest limits. No hosted service, accounts, builder, TTS,
transcription, or quality promises claimed anywhere.

## Validation

- [x] Reviewer with only root `SKILL.md` + `--help` can reproduce Demo A:
  transcript + prompt + trace are the script; replay gate executes it.
- [x] `verify:agent` path (`test:agent-demos`) and `verify:release` path
  (`test:release` + `release.mjs check`) green; tarball + registry flows
  intact (`test:installed` pattern untouched, npm-cmd fix applies).
- [x] Prerequisites, limits, and deferrals stated in README/COMPATIBILITY.
- [x] No mocks: every transcript step, hash, and manifest is a real run;
  browser steps are marked recorded-not-replayed with their requires tags.
