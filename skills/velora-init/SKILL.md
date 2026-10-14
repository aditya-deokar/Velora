---
name: velora-init
description: Initialize Velora projects, wire framework adapters, and keep the agent handoff healthy. Use when setting up a project, opening previews, or syncing the scene registry.
license: MIT
version: 0.1.2
when-to-use: Initializing a project, opening the preview URL, refreshing the registry after adding scene files, or diagnosing setup with doctor.
prerequisites:
- Node >=22.12.0 in a single-root npm project
- React 18.2+ or 19.x declared and installed
commands:
- init
- open
- sync
- doctor
related-skills:
- velora
- velora-composition
- velora-debug
not-for: Composition authoring, scene motion design, or render tuning; use velora-composition, velora-scenes, or velora-render for those tasks.
---

# Velora Init — Project Setup and Adapters

Owns project connection: `velora init`, `velora open`, `velora sync`, plus `velora doctor` for setup diagnostics.

## When to Use This Skill

Use this skill when the project is new, the preview URL is unknown, files were added or removed outside hot reload, or `velora doctor --json` reports setup failures. It selects the right adapter and preserves existing providers, roots, and configs.

## Commands

- `velora init --json`: create the connection and `VELORA.md` handoff. With `--adapter react` force the portable connection; with `--package <tgz>` install from a local tarball.
- `velora open --no-open --json`: verify the running dev server and print the preview URL without launching a browser.
- `velora sync --json`: refresh the scene registry after adding or removing recipe or component files.
- `velora doctor --json`: check Node, package, React, toolkit, scene catalog, FFmpeg, and Chromium.

All commands accept `--project <dir>` to target another checkout and `--json` for machine output.

## Prerequisites

- An existing npm Vite React project with `package.json`, `index.html`, and a standard dev script, or a Next.js app, or any React DOM renderer for `--adapter react`.
- No conflicting lockfiles or duplicate Vite configs.
- `VELORA.md` either absent or byte-identical to the generated handoff; differing content is a conflict to preserve, not overwrite.

## Workflow

1. Run `velora doctor --json` to record the starting state.
2. Run `velora init --json`. For an unknown host add `--adapter react`; for a local build add `--package <path-to-tgz>`.
3. Read `VELORA.md` and `velora guide --json` before authoring.
4. Start the host dev server with `npm run dev` in the project; Velora never starts it.
5. Run `velora open --no-open --json` with `--url <origin>` to verify the preview URL.
6. After adding or deleting `src/velora/scenes/*` files outside the Vite glob, run `velora sync --json`.
7. Re-run `velora doctor --json` to confirm green.

## Worked Example

```bash
velora doctor --json
velora init --json
velora open --no-open --json
velora sync --json
```

With an explicit project root and portable adapter:

```bash
velora init --adapter react --project ./my-app --json
velora open --url http://127.0.0.1:5173 --no-open --project ./my-app --json
```

Expected: `velora init --json` reports `changed` plus the `VELORA.md` handoff prompt; re-running reports `changed: false` with identical bytes. `velora open --no-open --json` prints a `?velora-preview=1` URL only when the dev server serves this project's identity.

## Anti-Patterns

- Re-running `velora init` to fix content errors; init owns connection, not scene motion.
- Editing the generated catalog or adapter by hand instead of running `velora sync --json`.
- Starting another dev server on a new port; reuse `APP_PORT`, `PORT`, or `5173`.
- Overwriting a differing `VELORA.md`; move or preserve it, then retry.
- Passing `--adapter` or `--package` to non-init commands.

## Troubleshooting

- `unsupported-project`: run inside an npm Vite React package, or retry with `velora init --adapter react --json`.
- `conflict` on `VELORA.md` or the preview adapter: preserve the differing file, then retry.
- `missing-installation`: run `npm install` in the project root, then retry.
- `missing-dev-server` or `wrong-dev-server`: run `npm run dev` and point `--url` at its loopback origin.
- `ERR_TOOLKIT_MISSING`: install the local Velora tarball, then run `velora init --json`.

## Validation

- `velora doctor --json` passes or names the exact missing prerequisite.
- Re-running `velora init --json` is byte-identical (`changed: false`).
- `velora sync --json` reports `changed: false` when nothing was added or removed.
- No unrelated files (`vite.config`, providers, lockfiles) change during init.

## Related Skills

- `velora`: root index and `velora skills install --dir <path> --json`.
- `velora-composition`: scene catalog via `velora scenes --json` once setup passes.
- `velora-debug`: `velora doctor --json` and `velora validate --json` diagnostics.

## When NOT to Use This Skill

- Do not use this skill to author compositions or motion; load `velora-composition` or `velora-scenes`.
- Do not use this skill to render frames or video; load `velora-render` or `velora-export`.
- Do not re-init a healthy project to chase a render failure; run `velora validate --json` and `velora-debug` first.
