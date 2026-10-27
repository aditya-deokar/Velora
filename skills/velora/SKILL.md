---
name: velora
description: Agent entry point for Velora, the CLI-first cinematic renderer for live React UI. Use when starting any Velora task to route to the right specialized skill and follow the JSON-first verify loop.
license: MIT
version: 0.1.2
when-to-use: Starting any Velora video task, choosing which skill to load, or running the golden-path verify loop.
prerequisites:
- velora CLI installed (velora doctor --json green)
- A running React dev server for preview and capture
commands:
- skills
- guide
- doctor
related-skills:
- velora-templates
- velora-cinematography
- velora-init
- velora-composition
- velora-scenes
- velora-render
not-for: Deep API details for GSAP easings, Three.js materials, or kinetic presets; load the specialized skill instead of guessing from this index.
---

# Velora — Agent Entry Point

Velora renders cinematic 3D motion from your live React application through a CLI-first workflow. It is not Remotion (config-driven MP4 composition) and not a human GUI editor: the CLI provides capabilities, skills provide the intelligence for using them correctly.

Use Velora when the request is "animate this real page or component in 3D space with camera, focus, and motion, then export frames or MP4." Do not use it for static screenshots, design mockups disconnected from live UI, or non-React renderers.

## When to Use This Skill

Load this skill first for every Velora request. It tells you which specialized skill to load next and states the golden path. Progressive discovery: start here, then load only the skills named in the routing table below.

Request type to skill map:

- A known shot or a fast first result ("hero shot of our dashboard", "show the whole landing page", "website hero loop", "20-second product reel"): load `velora-templates` and scaffold with `velora new scene` or `velora new video`.
- Designing or refining how a shot looks and moves (shot size, angle, lens, focus, a director's note): load `velora-cinematography`.
- New project, VELORA.md handoff, dev-server wiring, Next or Vite adapter, `velora sync` after adding files: load `velora-init`.
- Composition file authoring, `velora inspect --json`, `velora assets ls --json`, reusable scene catalog: load `velora-composition`.
- Scene recipe plus TSX binding, `ScenePreview` and `Surface` rules, camera rails, shot families: load `velora-scenes`.
- One exact frame, PNG sequences, MP4 export, manifests, cache and parallel flags: load `velora-render` and `velora-export`.
- GSAP easing conversion or ScrollTrigger rejection: load `velora-gsap`.
- Time-disciplined WebGL canvas: load `velora-threejs`.
- Kinetic titles and `TextStyleSchema`: load `velora-typography`.
- Entering-side transitions: load `velora-transitions`.
- Audio tracks, SRT or VTT captions: load `velora-audio`.
- Error catalog lookup and minimal repros: load `velora-debug`.
- Budgets, memoization, pixelRatio caps: load `velora-performance`.
- Frame evidence gates before human review: load `velora-verify`.

## Commands

Every CLI command supports `--help` and `--json`. Exit 0 on success, 1 on operational failure with `issues[].code`, 2 on usage errors. Never prompt; pipes and `NO_COLOR` stay plain.

| Command | Owns | Example |
|---|---|---|
| `velora guide --json` | `velora-scenes` | `velora guide --json` |
| `velora init --json` | `velora-init` | `velora init --json` |
| `velora open --no-open --json` | `velora-init` | `velora open --no-open --json` |
| `velora sync --json` | `velora-init` | `velora sync --json` |
| `velora scenes --json` | `velora-composition` | `velora scenes --json` |
| `velora load --scene demo --json` | `velora-composition` | `velora load --scene demo --json` |
| `velora validate --json` | `velora-debug` | `velora validate --json` |
| `velora validate --composition teaser.composition.json --json` | `velora-debug` | `velora validate --composition teaser.composition.json --json` |
| `velora inspect --json` | `velora-composition` | `velora inspect --json` |
| `velora inspect --scene demo --json` | `velora-composition` | `velora inspect --scene demo --json` |
| `velora assets ls --json` | `velora-composition` | `velora assets ls --json` |
| `velora snapshot --scene demo --url http://127.0.0.1:5173 --json` | `velora-render` | `velora snapshot --scene demo --url http://127.0.0.1:5173 --json` |
| `velora export --url http://127.0.0.1:5173/?velora-preview=1 --output clip.mp4 --json` | `velora-export` | `velora export --url http://127.0.0.1:5173/?velora-preview=1 --output clip.mp4 --json` |
| `velora doctor --json` | `velora-debug` | `velora doctor --json` |
| `velora render --composition teaser.composition.json --out teaser.mp4 --json` | `velora-export` | `velora render --composition teaser.composition.json --out teaser.mp4 --json` |
| `velora render --composition teaser.composition.json --frame 30 --out frame.png --json` | `velora-export` | `velora render --composition teaser.composition.json --frame 30 --out frame.png --json` |
| `velora frames --composition teaser.composition.json --out stills --every 30 --json` | `velora-render` | `velora frames --composition teaser.composition.json --out stills --every 30 --json` |
| `velora shot --scene demo --time 500 --out shot.png --json` | `velora-render` | `velora shot --scene demo --time 500 --out shot.png --json` |
| `velora check --frames stills --json` | `velora-verify` | `velora check --frames stills --json` |
| `velora audio check --composition teaser.composition.json --json` | `velora-audio` | `velora audio check --composition teaser.composition.json --json` |
| `velora captions validate --file subs.srt --json` | `velora-audio` | `velora captions validate --file subs.srt --json` |
| `velora templates ls --json` | `velora-templates` | `velora templates ls --json` |
| `velora new scene --template hero-push --id home-hero --route / --json` | `velora-templates` | `velora new scene --template hero-push --id home-hero --route / --json` |
| `velora transitions ls --json` | `velora-transitions` | `velora transitions ls --json` |
| `velora skills ls --json` | `velora` | `velora skills ls --json` |
| `velora skills check --json` | `velora` | `velora skills check --json` |

Run `velora skills install --dir <path> --json` to copy this library into an agent skill directory. Re-running is byte-identical; differing targets fail with `ERR_SKILL_CONFLICT`.

## Prerequisites

- Node `>=22.12.0`, FFmpeg on `PATH`, Playwright Chromium installed.
- Velora installed in the host project; `velora doctor --json` passes.
- The app dev server running on a loopback origin for preview and capture.

## Workflow

The agent execution loop for every Velora task:

1. Interpret the request and load this root skill.
2. Load only the specialized skills named above for this request type.
3. Run `velora doctor --json` and `velora inspect --json` to read project state.
4. Plan the composition: scenes, segments, assets, audio, captions.
5. Generate or modify recipe JSON plus TSX bindings; keep providers intact.
6. Run `velora validate --json`, then `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`.
7. Run `velora frames --composition teaser.composition.json --out stills --json` and `velora check --frames stills --json`.
8. Read the PNG evidence at output size; fix issues and repeat until `velora check` passes.

Golden path with `--json` throughout:

```
velora doctor --json
velora inspect --json
velora validate --composition teaser.composition.json --json
velora render --composition teaser.composition.json --out teaser.mp4 --json
velora frames --composition teaser.composition.json --out stills --json
velora check --frames stills --json
```

## Worked Example

Goal: prove a fresh checkout can reach a first validated frame.

```bash
velora doctor --json
velora inspect --json
velora validate --json
velora scenes --json
velora guide --json
```

Expected: `velora doctor --json` reports every check passing or names the missing prerequisite with `ERR_FFMPEG_MISSING` or `ERR_CHROMIUM_MISSING`. `velora validate --json` reports scene and asset counts. If a composition exists, `velora validate --composition teaser.composition.json --json` gates the timeline before any render.

For a full render proof once a composition exists:

```bash
velora render --composition teaser.composition.json --frame 0 --out proof.png --json
velora check --frames proof-frames --json
```

## Anti-Patterns

- Loading every skill up front instead of routing progressively from this index.
- Teaching GSAP easing internals or Three.js material APIs here; link to the installed `gsap-*` and `threejs-*` skills instead.
- Documenting a command or flag that `velora <command> --help` does not list.
- Rendering video before `velora validate --json` passes.
- Claiming artistic quality from `velora check --json`; it runs technical checks only.

## Troubleshooting

- `ERR_SKILL_MISSING` from `velora skills check --json`: re-run `velora skills install --dir <path> --json`.
- `ERR_SKILL_VERSION` drift: the installed skill pins an older CLI; re-install to refresh.
- `ERR_SKILL_INVALID` broken front-matter: run `velora skills check --dir <path> --json` for the field path, fix the header, re-check.
- `ERR_SKILL_CONFLICT` on install: preserve or move the differing file, then retry.
- `ERR_SERVER_UNREACHABLE`: start the app with `npm run dev`, then retry with its loopback origin.

## Validation

- `velora skills ls --json` lists this root plus all `velora-*` skills with versions.
- `velora skills check --json` passes with zero issues.
- A fresh agent with only this file loaded can reach `velora validate --json` green by following the routing table.
- No command above fails with `ERR_UNKNOWN_COMMAND`; every flag appears in `velora <command> --help`.

## Related Skills

- `velora-init`: project setup and `velora sync --json`.
- `velora-composition`: composition files, `velora inspect --json`, `velora assets ls --json`.
- `velora-scenes`: recipes, `ScenePreview`, camera rails.
- `velora-render`: `velora render --json`, `velora frames --json`, `velora shot --json`.
- `velora-debug`: `velora doctor --json`, `velora validate --json`, error catalog.
- `velora-verify`: `velora check --frames stills --json` gates.
- Installed `gsap-*` skills: deep GSAP API referenced, never copied here.
- Installed `threejs-*` skills: deep Three.js API referenced, never copied here.

## When NOT to Use This Skill

- Do not stay in this index when the task is domain-specific; load `velora-gsap`, `velora-threejs`, `velora-typography`, `velora-transitions`, `velora-audio`, `velora-export`, `velora-debug`, `velora-performance`, or `velora-verify` next.
- Do not use this skill for non-React renderers, static mockups, or GUI-operator workflows; Velora is CLI-first for live React DOM.
- Do not use this skill to bypass `velora validate --json` and frame evidence; the verify loop is mandatory.
