# Phase 01 — Agent-First CLI Foundation

## Goal
Make the CLI **discoverable, structured, machine-readable, and non-interactive** — the capability substrate every later phase and every skill depends on. Directly implements `prompt.md`: *"discoverable commands, structured JSON outputs, machine-readable errors, predictable exit codes, non-interactive execution."*

## Prerequisites
- Phase 00 baseline (command × JSON × exit-code matrix).

## Scope IN
- Uniform result envelope + error catalog + exit-code contract.
- `help`/`guide --json` upgrades, `--json` everywhere, `--no-interactive` guarantee, `doctor` command.
- JSON Schema files for CLI outputs.

## Scope OUT
- No new render features, no timeline/audio/3D (Phases 03–05). No skills tree yet (Phase 07) — but design the envelope so skills can quote it verbatim.

## Tasks

### 01.1 Uniform envelope (`src/core/project.ts`, `src/project/errors.ts`)
Adopt one `ProjectResult` shape for ALL commands:
```json
{ "success": true, "command": "scenes", "data": { … }, "warnings": [] }
{ "success": false, "command": "export", "issues": [{ "code": "ERR_FFMPEG_MISSING", "path": "export.ffmpeg", "message": "…", "hint": "…" }], "next": ["velora doctor --json"] }
```
- `code`: stable `ERR_*` string (catalog below). `path`: dotted location. `hint`: exactly one fix action. `next`: 0–2 follow-up commands.
- Human (non-`--json`) rendering stays in `src/cli/terminal.ts`; `--json` bypasses ALL presentation (already partially true — make it total, incl. `init` progress).

### 01.2 Error catalog + exit codes (`src/project/errors.ts`, `src/cli/index.ts`)
- Freeze: `0` success · `1` operational failure (validation, render, IO — `issues[]` non-empty) · `2` usage error (unknown command/flag, missing value — usage on stderr).
- Catalog (extend, keep stable — skills will pin these):
  `ERR_UNKNOWN_COMMAND, ERR_UNKNOWN_OPTION, ERR_MISSING_VALUE, ERR_DUPLICATE_OPTION, ERR_INVALID_PROJECT, ERR_SCENE_NOT_FOUND, ERR_SCENE_INVALID, ERR_BINDING_MISSING, ERR_FOCUS_INVALID, ERR_DURATION_INVALID, ERR_FPS_UNSUPPORTED, ERR_SERVER_UNREACHABLE, ERR_CAPTURE_NO_BRIDGE, ERR_FFMPEG_MISSING, ERR_CHROMIUM_MISSING, ERR_OUTPUT_UNWRITABLE, ERR_SNAPSHOT_STALE, ERR_INTERNAL`.
- Every error maps to one catalog code + `hint`. No free-text-only failures. `catch {}` blocks in `runCli` must emit `ERR_INTERNAL` with `next`.

### 01.3 Discoverability
1. `velora --help` / `velora <cmd> --help`: per-command usage (args, flags, examples, exit codes, `--json` shape pointer). Keep top-level `usage` string as the single source in `src/cli/index.ts`.
2. `velora guide --json` stays versioned (`AuthoringGuideSchema.version`); add `cliVersion`, `commands[]` (name, description, flags, example, skill pointer stub for Phase 07).
3. New `velora doctor [--json] [--project DIR]`: checks Node peer deps (React 18.2+/19), FFmpeg, Chromium, dev-server reachability, `src/flute/scenes` health. Emits issues with codes above. This is the agent's first diagnostic (skills will call it before `init`).

### 01.4 Non-interactive guarantee
- No command prompts for input. Ever. TTY-only presentation (Amethyst lettering, progress) is output-only; pipes/`NO_COLOR`/narrow terminals stay plain (extend existing `terminal.ts` tests).
- Add `--yes`/`--no-open` semantics where a future destructive op appears (reserve now; `init`/`open --no-open` already model it).
- Env: respect `APP_PORT/PORT`, `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`. Document in `--help`.

### 01.5 JSON Schemas
- Add `src/core/cli-schema.ts` (or extend `authoring.ts`): Zod schemas for envelope + per-command `data` shapes. Export JSON Schema for `--json` consumers; validate in tests via `safeParse`, not string matching.

## CLI contract changes
| Command | Change |
|---|---|
| ALL | `--json` emits envelope; stderr carries `issues[]` JSON on failure; exit codes frozen |
| `help` / `<cmd> --help` | new per-command help (exit 0) |
| `doctor` | NEW: environment + project health |
| `guide` | add `cliVersion` + `commands[]` index |
| `init/open/sync/scenes/load/validate/snapshot/export` | behavior preserved; errors recoded to catalog |

## Files to modify
- `src/cli/index.ts` (parsing, help, envelope wiring), `src/cli/terminal.ts` (human-only formatting), `src/cli/main.ts` (env plumbing).
- `src/core/project.ts`, `src/project/errors.ts`, NEW `src/core/cli-schema.ts`.
- `src/project/commands.ts` (doctor op), `RESOURCES` binding in `src/core/resources.ts`.
- Tests: `tests/cli/*` (extend: envelope, codes, `--help`, doctor, no-TTY determinism).

## Tests
- `vitest run tests/cli` — new cases: every command `--json` parses against schema; every failure has known `ERR_*`; exit-code matrix; `--help` for each command; piped/non-TTY byte-stability for `init`.
- `npm run lint:architecture` + `typecheck` green.

## Validation criteria
- [ ] An agent with no TTY can run any command with `--json` and parse the result without regex.
- [ ] Unknown flag → exit 2 + `ERR_UNKNOWN_OPTION` + usage; render fail → exit 1 + actionable `hint`.
- [ ] `doctor --json` diagnoses a broken host (missing FFmpeg / bad scene) with correct codes.
- [ ] No command blocks waiting for input when stdin is closed.

## Anti-patterns
- Adding flags without `--help` + `--json` + error-code coverage.
- Pretty-printing inside `--json` (color codes, banners, progress).
- Inventing a second envelope for new commands.

## Definition of Done
`tests/cli` green with envelope/code/help/doctor coverage, architecture checker green, and Phase 02 can assume the envelope without changes.
