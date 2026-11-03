# Phase 08 Exit — Skills Library Specialized (2026-10-13)

## Delivered

- 10 specialized skills each meeting the content contract plus routing (`when / which command / which skill next / when NOT`): `velora-gsap` (easing map, converter, ScrollTrigger and ticker forbidden), `velora-threejs` (time-disciplined `update` from `timeMs` plus `seed`, capture safety, budgets), `velora-ewmotion` (explicit deferral with reason, zero claimed commands), `velora-typography` (`TextStyleSchema`, 4 kinetic presets, Surface-leaf rule, 12-surface budget), `velora-transitions` (8-type catalog, overlap accounting, leaf-opacity rule), `velora-audio` (track schema, frame snapping, mix flags, 40ms drift, no TTS claims), `velora-export` (fps and size choice, cache and parallel flags, NDJSON progress, manifest reading, FFmpeg and Chromium prereqs), `velora-debug` (error-catalog lookup, bridge and binding and focus and plane-crossing fixes, minimal repro), `velora-performance` (surface and filter and draw budgets, memoization, pixelRatio caps, device evidence), `velora-verify` (technical checks only, `requiresVisualReview: true`, preview versus export comparison).
- `skills/velora/REFERENCE.md` full: 20-command flag matrix, envelope plus `ERR_*` catalog, JSON schema shapes, frame math, seed and determinism rule, budgets table, version-compat matrix for CLI `0.1.2` with React `18.2+` or `19.x`.
- `skills/velora/templates/`: `scene-minimal`, `composition-three-act`, `kinetic-title`, `product-survey` (canonical camera rail), `audio-captioned` (SRT plus composition wiring), `webgl-stage` (time-disciplined stub). Every template has a README plus parsing JSON; copy-based workflow documented instead of an aspirational `scene create --from` command.
- `skills/velora/scripts/`: `new-scene.mjs` (scaffold), `check-frames.mjs` (manifest versus PNGs), `compare-renders.mjs` (hash-diff serial versus parallel). All executable with `--help` and referenced by validation sections.
- Root routing table extended to all 14 domain skills; every `related-skills` and `not-for` cross-link verified with no dangling refs.
- `scripts/check-skills.mjs` new: front-matter, section headers, line-segment command and flag refs against `CLI_COMMANDS`, skill refs, root budget, example JSON parsing, lock versions, template and script presence, and docs presence.
- `skills-lock.json` hashes refreshed after content edits; versions pinned to `0.1.2`.

## Validation proof

- Each domain skill independently routes an agent from blank to passing validation for its area (composition, GSAP conversion, WebGL discipline, typography readability, transitions, audio and captions, export manifests, debug repros, performance budgets, verify gates) using only real commands.
- Zero documented commands or flags that do not execute; zero copied GSAP or Three.js bodies.
- Templates all parse (`CompositionSchema`, `SceneRecipeSchema`, SRT) and state the `validate → render --frame → check` path; `audio-captioned` documents asset supply instead of faking audio bytes.
- `velora-ewmotion` states deferral with reason and documents zero Ewmotion commands.

## Deviations (documented)

- No new core capabilities: skills document Phases 03 through 06 as built; template render proofs are schema plus offline evidence rather than browser video in this slice (browser gates remain in `verify:reuse` and later).
- `check --visual` from the plan is documented as `check --frames` and `check --video` to match the real `--help` flags; no aspirational flag is claimed.
- Line-segment flag attribution in `check-skills.mjs` avoids false positives from multi-command lines; top-level help mentions are skipped.

## Gates

typecheck, arch, check-skills, test:core 250/250, test:launch 364/364, built CLI `skills ls --json` and `skills check --json` green.


## Re-verification against v2 (2026-11-03)

v2 Phases 2-7 grew the library from 14 to 22 skills and the CLI from 20 to 26 commands. Each Phase 08
criterion was re-checked against the current tree. Gaps were closed as follows.

| Criterion | Finding | Resolution |
|---|---|---|
| REFERENCE flag matrix covers every command | 20 rows; 6 commands and many v2 flags missing | Regenerated from `CLI_COMMANDS` (26 rows); `skills-content.test.ts` now fails on any missing command or flag |
| REFERENCE `ERR_*` catalog | 19 of 64 codes and 5 warning/advisory codes missing | Rows added for templates, scaffolding, beats, prompts, brand and looks, codecs, flash risk, host prerequisites and warnings; test requires every `ERR_`, `WARN_` and `ADV_` code |
| JSON schema shapes and budgets | Stated fps 30 only, butt-joined segments, parallel 1 to 4, export fps 30/60/120 | Updated: fps 24-120, gaps and overlap windows, overlays, markers, sfx, loudness, look, motion v2 fields, `BrandSchema`, `PromptSchema`, parallel 1-8 |
| Routing table extended to all skills | Root routed by request type | Intent router v2 (v2 Phase 7); test asserts every skill is reachable and each intent loads at most four |
| "Every embedded CLI command runs" | Only static flag checks | New `tests/cli/skills-examples.test.ts`: every CLI line in every skill's fenced blocks, README.md and USER_GUIDE.md runs through the real `runCli` parser with execution stubbed (no usage errors); a negative case proves the gate can fail |
| Templates are tested fixtures | Unchanged | `templates-valid.test.ts` and `skills-content.test.ts` still pass |
| `velora-ewmotion` deferral | Unchanged | Kept as an explicit deferral; documented in the v2 Phase 7 exit |

Gates: see `plan/v2/artifacts/phase-07-exit.md` and the PR description.
