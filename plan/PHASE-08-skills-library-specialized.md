# Phase 08 — Skills Library Specialized (domains, templates, references, scripts)

## Goal
Complete the **Velora Skills library** with specialized domain skills, reusable templates, reference docs, and executable scripts — every skill tied to real Phase 03–06 functionality. Implements `prompt.md`: *"specialized skills for … GSAP animation, Three.js and WebGL scenes, Ewmotion workflows, typography and kinetic text, transitions, audio, rendering and export, debugging, performance optimization, and visual-quality verification … templates, reference documentation, and executable scripts."*

## Prerequisites
- Phases 03–07 (timeline, audio/type, transitions/3D, render/verify, skills core + routing table). Ewmotion status from Phase 05.

## Scope IN
- 9 specialized skills + `REFERENCE.md` + `templates/` + `scripts/` + routing-table update.
- Skill-content contract enforcement (the *"when / which command / which skill / when-not"* rule).

## Scope OUT
- No new core capabilities (document Phases 03–06 as-built; file follow-ups if a gap blocks a skill example).

## Tasks

### 08.1 Specialized skills (each: instructions, command-selection, prereqs, workflow, working example, anti-patterns, troubleshooting, validation, routing)
| Skill | Owns (commands) | Must state |
|---|---|---|
| `velora-gsap` | `validate` (clock check), `render --frame` proof | GSAP→`MotionSchema` mapping, easing table, timeline builder; ScrollTrigger/ticker FORBIDDEN in render; deep API in `gsap-*` installed skills |
| `velora-threejs` | `validate`, `render --frame`, `check --visual` | `WebGLSurface` time-discipline (`update(t)` of `timeMs`+`seed`), capture-safety, budgets; deep API in `threejs-*` skills |
| `velora-ewmotion` | per Phase 05 resolution | adapter workflow OR explicit defer notice (never a stub claiming unbuilt behavior) |
| `velora-typography` | `validate`, `frames` (readability proof) | `TextStyleSchema`, kinetic presets, Surface-leaf rule, per-char budget; readability checked at output size |
| `velora-transitions` | `transitions ls`, `validate`, `render` | boundary-transition catalog, overlap accounting, leaf-opacity rule |
| `velora-audio` | `audio ls/check`, `render`, `check --visual` (av-drift) | track schema, frame-snapping, mix flags, drift budget; no TTS/transcription claims |
| `velora-export` | `render`, `frames`, `shot`, manifests | fps/size choice, cache/parallel flags, progress NDJSON, manifest reading, FFmpeg/Chromium prereqs |
| `velora-debug` | `doctor`, `inspect`, `validate`, logs | error-catalog lookup (`ERR_*` → fix), common failures (bridge missing, binding mismatch, focus v2 rejection, projection-plane crossing), minimal repro recipe |
| `velora-performance` | `check --visual` (fps-budget), `render` flags | surface/filter/draw budgets, memoization + stable wrapper identity, pixelRatio caps, device-evidence discipline (no universal FPS promises) |
| `velora-verify` (quality gate) | `check --visual`, `frames`, `reviewAuthoring` | technical checks only (bridge/no-blank/coverage/focus/caption/drift); `requiresVisualReview:true` always; how to compare preview vs export frames |

### 08.2 Templates (`skills/velora/templates/`)
- `scene-minimal/` (recipe JSON + TSX + snapshot placeholder), `composition-three-act/` (composition JSON + 3 scene stubs), `kinetic-title/`, `product-survey/` (canonical camera-rail example from guide), `audio-captioned/` (SRT + audio wiring), `webgl-stage/` (time-disciplined canvas stub).
- Every template: `velora scene create --from <name>`-compatible + CI-rendered (templates are tested fixtures, not brochures).

### 08.3 Reference + scripts
- `REFERENCE.md`: full flag matrix, envelope + `ERR_*` catalog, JSON schemas, frame math, seed/determinism rule, budgets table, version-compat matrix (Velora ↔ React ↔ skills-lock).
- `scripts/`: `new-scene.mjs` (scaffold), `check-frames.mjs` (manifest vs PNGs), `compare-renders.mjs` (hash diff serial/parallel) — executable, `--help`'d, used by skills' validation sections.

### 08.4 Routing + discovery update
- Root `SKILL.md` routing table extended to all 14 skills; each skill's `related-skills` + `not-for` cross-links verified (lint: no dangling skill refs, no command refs missing from `--help`).

## Files to create/modify
- NEW `skills/velora-*/SKILL.md` ×10, `skills/velora/{REFERENCE.md,templates/*,scripts/*}` (or flat equivalents per 07.1 decision — keep consistent).
- Root `SKILL.md` routing update; `skills-lock.json` versions.
- Tests: skill-content lint (required sections incl. *"when to use / which command / which skill next / when NOT to use"*), example-execution suite (every embedded CLI command + code sample runs green), link/flag-reference check.

## Tests
- `node scripts/check-skills.mjs` (NEW): front-matter, section headers, command refs ⊆ `--help`, skill refs ⊆ existing skills, root line budget, example freshness (examples re-executed, not eyeballed).
- Template render suite: each template `validate → render --frame → check --visual` green in disposable host.

## Validation criteria
- [ ] Each of the 10 skills independently gets an agent from blank to passing validation for its domain.
- [ ] Zero documented commands/flags that don't execute; zero copied GSAP/Three.js bodies (reference check).
- [ ] Templates all render + pass visual checks out of the box.
- [ ] `velora-ewmotion` either works end-to-end or explicitly states deferral with reason.

## Anti-patterns
- Skills that restate core docs without adding selection/workflow/validation intelligence (the principle: *CLI = capabilities, skills = intelligence*).
- Untested examples (every snippet runs in CI).
- Artistic-quality promises in `velora-verify` (technical checks + human review only).

## Definition of Done
Full 14-skill library + templates + reference + scripts merged with content/execution lint green; Phase 09 demos can cite only these skills.
