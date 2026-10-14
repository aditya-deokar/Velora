# Phase 00 Exit Report — Audit & Baseline (frozen 2026-10-13)

Repo: `velora@0.1.2` (dual name `velora`/`velora`). No `src/` changes in this phase; all Phase 01 work is recorded separately.

## 00.1 Capability inventory

CLI surface (`src/cli/index.ts:runCli`, pre-Phase-01):

| Command | Flags | `--json` | Exit codes | Covering tests |
|---|---|---|---|---|
| `--version` / `-v` | — | n/a (plain) | 0 | `tests/cli/*` |
| `--help` / `-h` / `help` / (none) | — | n/a | 0 | `tests/cli/cli.test.ts`, `terminal.test.ts` |
| `guide [--json]` | `--json` | full guide doc | 0 / 2 (usage) | `tests/cli/cli.test.ts`, `tests/core/authoring.test.ts` |
| `init [--adapter auto\|react] [--project] [--package] [--url] [--no-open] [--json]` | 6 | envelope | 0 / 1 / 2 | `tests/cli/*`, `tests/project/commands.test.ts`, `portable.test.ts` |
| `open [--scene] [--project] [--url] [--no-open]` | 4 (+`--json`) | envelope | 0 / 1 / 2 | same + `refresh-boundary` |
| `sync [--project] [--json]` | 2 | envelope | 0 / 1 / 2 | `portable.test.ts` |
| `scenes [--project] [--json]` | 2 | envelope | 0 / 1 / 2 | `tests/project/recipes.test.ts` |
| `load [--scene] [--project] [--json]` | 3 | envelope | 0 / 1 / 2 | same |
| `validate [--project] [--json]` | 2 | envelope | 0 / 1 / 2 | `tests/project/commands.test.ts` |
| `snapshot --scene --url [--time] [--project] [--json]` | 5 | envelope | 0 / 1 / 2 | `tests/export/snapshot.test.ts` |
| `export --url --output [--fps 30\|60\|120] [--width] [--height] [--project] [--json]` | 7 | envelope | 0 / 1 / 2 | `tests/export/export.test.ts` |

Aliases: `init→init-project`, `sync→sync-project`, `open→open-preview`, `load→load-project`, `validate→validate-project`.
Gaps found (drove Phase 01): no per-command `--help`, no `doctor`, usage errors were free text even with `--json`, issue objects had no stable `code`/`hint` contract, `guide --json` carried no command index.

`RESOURCES` keys (`src/core/resources.ts`): `present-preview`, `resolve-recipes`, `list-scenes`, `load-scene`, `open-scene`, `snapshot-scene`, `authoring-guide`, `review-authoring`, `export-video`, `init-project`, `sync-project`, `load-project`, `validate-project`, `open-preview`, `evaluate-spatial`, `evaluate-motion`, `validate-definition`.
`VELORA_BRAND` consumers: `src/cli/index.ts`, `terminal.ts`, `src/core/authoring.ts` (guide), `src/project/commands.ts` (handoff).

## 00.2 Architecture & purity

- `npm run typecheck` ✅ (clean)
- `npm run lint:architecture` ✅ (`Architecture checks passed.`)
- Core purity confirmed: `src/core/*` imports `zod` only; preview→core-only; effects isolated in `src/project/services.ts` + `src/export/services.ts` behind command boundaries.
- No P0 violations; Phase 01 added `src/core/cli-schema.ts` (zod-only), `runtimeVersion`/`probeExecutable` (project services), `probeFfmpeg`/`probeChromium` (export services), `executeDoctorCommand` (project commands), `probeCapturePrerequisites` (export commands) — all within their layer budgets (`lint:architecture` still green).

## 00.3 Behavior baseline

- `npm run test:launch` (project + preview + cli): **231 passed** pre-Phase-01 → **274 passed** post-Phase-01 (+43: envelope, exit-code matrix, per-command help, doctor, cli-schema).
- Broader regression (`tests/cli` + `tests/core` + `tests/project` + `tests/export`): **456 passed**, 0 failed.
- Environment (this machine, device-specific evidence only): Node satisfies `>=22.12`, FFmpeg present (WinGet, `ffmpeg -version` ~1s cold), Playwright importable (`import-ok-ms 441`), Chromium executable probe real (no browser launch).
- Performance gate (`test:performance`, hardware-timed) not re-run in this slice; baseline rule stands: measured FPS is evidence for the tested device/scene, never a universal promise.

## 00.4 Installed-skills survey

22 skills under `skills/` (front-matter `name/description/license` or `name/description`):

| Group | Skills | Teaches (Velora-relevant) |
|---|---|---|
| GSAP (11) | `gsap-core`, `gsap-timeline`, `gsap-plugins`, `gsap-react`, `gsap-frameworks`, `gsap-scrolltrigger`, `gsap-debugger`, `gsap-performance`, `gsap-production-patterns`, `gsap-motion-engineer`, `gsap-utils` | tweens/easing catalog, timeline choreography + position params, plugins (SplitText/Flip/Draggable/MotionPath), React `useGSAP` lifecycle, 60fps compositor discipline, staggers |
| Three.js (10) | `threejs-fundamentals`, `threejs-animation`, `threejs-geometry`, `threejs-interaction`, `threejs-lighting`, `threejs-loaders`, `threejs-materials`, `threejs-postprocessing`, `threejs-shaders`, `threejs-textures` | scene/camera/renderer setup, GLTF/texture loading, PBR materials, IBL/shadows, EffectComposer, GLSL, raycast/controls |
| Motion intent (1) | `understand-and-create-animation` | NL-prompt → GSAP code synthesis, kinetic typography masking, organic easings |

Integration pattern (locked for Phases 05/08): **reference, don't copy** — Velora skills link to these for deep API and own only the video-time mapping (GSAP easing → `MotionKeyframe.easing`; ScrollTrigger/ticker forbidden in render; Three.js scenes behind a capture-safe time-disciplined bridge).

**Ewmotion: DEFERRED.** The string `ewmotion` appears only in `prompt.md`; zero hits in `src/`, `tests/`, `scripts/`, `skills/`, `skills-lock.json`, `package.json`. No installed skill, no dependency, no spec. Resolution is a Phase 05 entry task (research → integrate as a `MotionSchema` adapter, or drop with reason). No `velora-ewmotion` skill may claim unbuilt behavior.

## 00.5 Priority stack (confirmed)

Agent-unblock × effort order stands as planned: 01 CLI envelope → 02 composition/inspect → 03 determinism/frames → 07 skills core → 06 render/verify → 04 audio/type → 05 transitions/3D → 08–09 specialized skills + demos.

## Phase 01 delivery summary (for the record)

- `src/core/cli-schema.ts` (new): `CliIssue`/`CliEnvelope`/`DoctorResult` schemas, `CLI_ERROR_CATALOG` (18 `ERR_*` + 30 legacy codes, each with hint + next), `CLI_COMMANDS` index, `normalizeIssue`/`hintForCode`/`nextForCode`/`nextForIssues`.
- Envelope: every operation `--json` emits `{success, command, data|issues, warnings?, next?}`; failures always carry `code+path+message+hint`; exit codes frozen 0/1/2 (usage errors emit JSON envelopes when `--json` is present).
- `velora doctor [--project] [--url] [--json]` (new): project checks (scope/node/package/react/toolkit/scenes/dev-server) + real FFmpeg/Chromium probes; exit 0 all-pass, 1 otherwise; fully injected for tests.
- Discoverability: `<cmd> --help` + `help <cmd>` for all 10 commands; `guide --json` gains `cliVersion` + `commands[]`; top-level help documents doctor, non-interactive guarantee, exit codes.
- Non-interactive: no stdin reads anywhere (verified by construction); `--json` bypasses all presentation incl. init progress; pipes/`NO_COLOR`/narrow terminals stay plain (byte-stability test).
- Backward compatibility: legacy kebab-case operation codes preserved (tests assert them); `ProjectResultSchema`/`ExportVideoResultSchema` extended with optional `command/warnings/next/hint/path` (old payloads still parse); `getAuthoringGuide()` defaults `cliVersion: "development"`; `scripts/check-installed.mjs` compares canonical guide fields and asserts the new ones separately.
- Known exception (documented): `guide --json` returns the versioned guide document (flat, with `command:"guide"`), not the operation envelope — changing it would break the `VELORA.md` handoff contract.
