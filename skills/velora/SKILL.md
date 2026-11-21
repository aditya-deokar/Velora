---
name: velora
description: Agent entry point for Velora, the CLI-first cinematic renderer for live React UI. Use when starting any Velora task to route by intent (launch film, cinematic page, website hero, vertical teaser, bespoke shot, titles and brand, debugging) to at most four specialized skills, and to follow the director's workflow and the JSON-first verify loop.
license: MIT
version: 0.1.2
when-to-use: Starting any Velora video task, choosing which skills to load for the request's intent, or running the director's workflow and the golden-path verify loop.
prerequisites:
- velora CLI installed (velora doctor --json green)
- A running React dev server for preview and capture
commands:
- skills
- guide
- doctor
- prompts
related-skills:
- velora-launch
- velora-templates
- velora-cinematography
- velora-motion-design
- velora-brand
- velora-looks
- velora-editing
- velora-editor
- velora-init
- velora-composition
- velora-scenes
- velora-render
- velora-export
- velora-debug
- velora-verify
not-for: Deep API details for GSAP easings, Three.js materials, or kinetic presets; load the specialized skill instead of guessing from this index.
---

# Velora — Agent Entry Point

Velora renders cinematic 3D motion from your live React application through a CLI-first workflow. It is not Remotion (config-driven MP4 composition) and not a human GUI editor: the CLI provides capabilities, skills provide the intelligence for using them correctly.

Use Velora when the request is "animate this real page or component in 3D space with camera, focus, and motion, then export frames or video." Do not use it for static screenshots, design mockups disconnected from live UI, or non-React renderers.

## When to Use This Skill

Load this skill first for every Velora request. Routing is progressive: read the intent table, load only the skills in that row (never more than four), and open others only when a step needs them.

### Intent router

| Intent (what the person says) | Skill chain, in order | Start with |
|---|---|---|
| Launch film, announcement, feature drop, changelog, Product Hunt | `velora-launch` → `velora-templates` → `velora-editing` → `velora-render` | `velora prompts show --id launch-film --json` |
| "Make my page / dashboard cinematic", one hero shot of real UI | `velora-templates` → `velora-cinematography` | `velora templates ls --json` |
| Website hero loop, landing-page background video | `velora-launch` → `velora-templates` → `velora-export` | `velora prompts show --id website-hero-loop --json` |
| Vertical or social teaser (Reels, TikTok, Shorts) | `velora-launch` → `velora-templates` → `velora-editing` → `velora-looks` | `velora prompts show --id vertical-teaser --json` |
| A bespoke shot no template makes | `velora-scenes` → `velora-cinematography` | `velora guide --json` |
| Edit visually, continue an existing Studio draft | `velora-editor` | `velora edit --scene <id>` |
| Polish timing or easing | `velora-editor` → `velora-motion-design` | `velora prompts show --id polish-easing --json` |
| Group tracks or stagger an entrance | `velora-editor` → `velora-motion-design` | `velora prompts show --id stagger-entrances --json` |
| Animate a 3D model | `velora-threejs` → `velora-editor` | `velora doctor --json` |
| Recut to the beat | `velora-editing` → `velora-editor` → `velora-audio` | `velora prompts show --id recut-to-beats --json` |
| Titles, stats, end cards, brand colors and fonts, motion feel | `velora-brand` → `velora-typography` → `velora-motion-design` | `velora brand check --json` |
| Grade, grain, film look, flash or banding warnings | `velora-looks` | `velora shot --scene <id> --time 0 --finish --out look.png --json` |
| New project, adapter, `VELORA.md`, `velora sync` | `velora-init` | `velora init --json` |
| A non-React website (Astro, SvelteKit, Rails, static HTML) | `velora-init` → `velora-templates` → `velora-cinematography` | `velora studio --site http://127.0.0.1:4321 --json` |
| No product UI yet; motion graphics and a launch page | `velora-init` → `velora-launch` → `velora-motion-design` | `velora create my-launch --json` |
| Something fails, or proving frames before review | `velora-debug` / `velora-verify` | `velora doctor --json` |

Narrower needs, loaded only when a step calls for them:

- Composition fields, assets, the scene catalog: `velora-composition`.
- One exact frame, PNG sequences, contact sheets: `velora-render`; codecs, presets and alpha: `velora-export`.
- GSAP easing conversion: `velora-gsap`. Time-disciplined WebGL: `velora-threejs`.
- Entering transitions inside a scene: `velora-transitions`. Audio tracks and caption files: `velora-audio`.
- Budgets and pixel ratio: `velora-performance`.
- A request naming Ewmotion: `velora-ewmotion` (an honest deferral; no adapter ships).

`velora prompts ls --json` lists ready-made agent prompts for these intents; the person can also copy them from the studio.

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
| `velora prompts ls --json` | `velora-launch` | `velora prompts show --id launch-film --json` |
| `velora new video --blueprint launch-film-30s --id launch --route / --json` | `velora-templates` | `velora new video --blueprint launch-film-30s --id launch --route / --json` |
| `velora edit key --scene home-hero --track camera.z --at 1200 --value 400 --json` | `velora-editor` | `velora edit apply --scene home-hero --ops ops.json --expect-sha <sha> --write --json` |
| `velora review --composition launch.composition.json --json` | `velora-editing` | `velora review --composition launch.composition.json --platform youtube-1080p --json` |
| `velora compose snap --composition launch.composition.json --to beats --json` | `velora-editing` | `velora compose snap --composition launch.composition.json --to beats --write --json` |
| `velora audio beats --composition launch.composition.json --json` | `velora-audio` | `velora audio beats --composition launch.composition.json --write-markers --json` |
| `velora brand check --json` | `velora-brand` | `velora brand init --from-css src/index.css --json` |
| `velora transitions ls --json` | `velora-transitions` | `velora transitions ls --json` |
| `velora skills ls --json` | `velora` | `velora skills ls --json` |
| `velora skills check --json` | `velora` | `velora skills check --json` |

Run `velora skills install --dir <path> --json` to copy this library into an agent skill directory. Re-running is byte-identical; differing targets fail with `ERR_SKILL_CONFLICT`.

## Prerequisites

- Node `>=22.12.0`, FFmpeg on `PATH`, Playwright Chromium installed.
- Velora installed in the host project; `velora doctor --json` passes.
- The app dev server running on a loopback origin for preview and capture.

## Workflow

### The director's workflow

Every film, from a 6 s hero loop to a 30 s launch, moves through the same gates. Do not skip ahead: each exit is what makes the next step cheap.

1. **Brief.** Product, audience, the single message, platforms, duration, motion personality, must-show features, call to action (`velora-launch`).
2. **Shot list.** One template per beat, or a bespoke shot. A blueprint writes the list into `<id>.brief.md`.
3. **Storyboard.** `velora frames --composition <file> --out board --every 30 --contact-sheet --json`; read the image as a sequence.
4. **Scaffold.** `velora new video --blueprint <id>` or `velora new scene --template <id>`.
5. **Refine.** Real components replace placeholders; copy, brand and focus are set by hand.
6. **Draft render.** `velora render --composition <file> --out draft.mp4 --quality draft --json`.
7. **Review and check.** `velora review --composition <file> --platform <preset> --json`, then `velora check --video draft.mp4 --manifest draft.manifest.json --json`.
8. **Taste review.** A person watches the draft with sound. Automated checks never claim artistic quality.
9. **Master.** `--quality master` or `--preset <platform>`.
10. **Deliver.** `velora deliver --composition <file> --targets youtube,reels,website-hero --json`, then `velora check --video` on each file (`velora-launch` lists the targets).

### The verify loop inside each step

1. Run `velora doctor --json` and `velora inspect --json` to read project state.
2. Generate or modify recipe JSON plus TSX bindings; keep providers intact.
3. Run `velora validate --composition <file> --json` (timeline, assets, captions, transitions) before any render.
4. Prove frames: `velora render --composition <file> --frame 0 --out proof.png --json`, or `velora shot --scene <id> --time 500 --out shot.png --json` for one scene.
5. Read the PNG evidence at output size; fix issues and repeat until `velora check --frames <dir> --json` passes.

Golden path with `--json` throughout:

```
velora doctor --json
velora inspect --json
velora validate --composition teaser.composition.json --json
velora frames --composition teaser.composition.json --out stills --json
velora check --frames stills --json
velora render --composition teaser.composition.json --out teaser.mp4 --json
```

## Worked Example

Goal: "Make a launch film for our dashboard." The router picks `velora-launch` → `velora-templates` → `velora-editing` → `velora-render`.

```bash
velora doctor --json
velora prompts show --id launch-film --json
velora new video --blueprint launch-film-30s --id launch --route / --json
velora validate --composition launch.composition.json --json
velora review --composition launch.composition.json --platform youtube-1080p --json
velora frames --composition launch.composition.json --out board --every 30 --contact-sheet --json
velora render --composition launch.composition.json --out launch.mp4 --quality draft --json
```

Expected:
- `velora doctor --json` reports every check passing, or names the missing prerequisite (`ERR_FFMPEG_MISSING`, `ERR_CHROMIUM_MISSING`).
- `new video` writes the shots, `launch.composition.json`, `launch.brief.md` and a caption skeleton.
- `validate` and `review` pass, or report codes to fix before the storyboard.
- The contact sheet is the storyboard; the draft render is ready for the taste review.

## Anti-Patterns

- Loading every skill up front instead of routing by intent; a row needing more than four skills is two tasks.
- Making shots before the brief has a single message.
- Repeating one template for every shot, or adding a move without a motivation.
- Teaching GSAP easing internals or Three.js material APIs here; link to the installed `gsap-*` and `threejs-*` skills instead.
- Documenting a command or flag that `velora <command> --help` does not list.
- Rendering video before `velora validate --json` passes.
- Claiming artistic quality from `velora check --json` or `velora review --json`; they run technical and advisory checks only.

## Troubleshooting

- `ERR_SKILL_MISSING` from `velora skills check --json`: re-run `velora skills install --dir <path> --json`.
- `ERR_SKILL_VERSION` drift: the installed skill pins an older CLI; re-install to refresh.
- `ERR_SKILL_INVALID` broken front-matter: run `velora skills check --dir <path> --json` for the field path, fix the header, re-check.
- `ERR_SKILL_CONFLICT` on install: preserve or move the differing file, then retry.
- `ERR_PROMPT_NOT_FOUND`: run `velora prompts ls --json` for the IDs.
- `ERR_TIMELINE_OVERLAP` from validate: an overlap must equal its overlap transition's `durationMs` (`velora-editing`).
- `ERR_SERVER_UNREACHABLE`: start the app with `npm run dev`, then retry with its loopback origin.

## Validation

- `velora skills ls --json` lists this root plus all `velora-*` skills with versions.
- `velora skills check --json` passes with zero issues.
- Every intent row names skills that `velora skills ls --json` lists, at most four per row.
- A fresh agent with only this file and `--help` can scaffold, validate, review and draft-render a launch film.
- No command above fails with `ERR_UNKNOWN_COMMAND`; every flag appears in `velora <command> --help`.

## Related Skills

- `velora-launch`: brief, story structure, platform pacing and deliverables.
- `velora-templates` and `velora-cinematography`: starting shots and how to refine them.
- `velora-editing`: transitions, overlays, rhythm, sound, captions and review.
- `velora-brand`, `velora-looks`, `velora-motion-design`: brand tokens, grade and graphics.
- `velora-init`, `velora-composition`, `velora-scenes`: setup, compositions and bespoke recipes.
- `velora-render`, `velora-export`: frames, contact sheets, codecs and presets.
- `velora-debug`, `velora-verify`: error catalog and evidence gates.
- Installed `gsap-*` and `threejs-*` skills: deep API references, never copied here.

## When NOT to Use This Skill

- Do not stay in this index once the intent is clear; load that row's skills.
- Do not use this skill for non-React renderers, static mockups, or GUI-operator workflows; Velora is CLI-first for live React DOM.
- Do not use this skill to bypass `velora validate --json` and frame evidence; the verify loop is mandatory.
