# Phase 2 Exit — Shot Library, Templates, Wave 1

Status: implemented, uncommitted. Date: 2026-10-27.

## Delivered

- **Shot library** (`src/core/shots.ts`):
  - `buildShot` covers 12 shot kinds.
  - `ASPECT_FRAMES` covers 16:9, 21:9, 1:1, 4:5 and 9:16.
  - `framingReport` checks that the subject is visible, stays clear of the camera plane and is in focus at hero frames.
- **Template catalog** (`src/core/templates.ts`):
  - 12 Wave 1 camera templates and 2 blueprints (`product-reel-20s`, `website-hero-loop-8s`).
  - Typed params, `resolveTemplateParams` and `certifyTemplate`.
- **Recipe provenance:** recipes gain an optional `template` field, and the JSON Schemas were regenerated.
- **Scaffolder** (`src/project/templates.ts`, `executeTemplateCommand`):
  - Writes are create-only.
  - It checks with the TypeScript AST that the named component export exists.
  - Three slot kinds: `--component`, `--route` and placeholder.
- **CLI:**
  - `velora templates ls|show|check`
  - `velora new scene`
  - `velora new video`
  - `velora frames --contact-sheet [--columns N]`
  - `velora skills install --agent claude|generic`
  - New error codes `ERR_TEMPLATE_*`, `ERR_COMPONENT_EXPORT_MISSING`, `ERR_ROUTE_*` and `ERR_SCENE_EXISTS`, plus the warning `WARN_TEMPLATE_PLACEHOLDER`.
- **Kit layer** (`./kit` export): `RouteFrame`, `ScrollFrame` and `SlotPlaceholder`. The layer is registered in the architecture checker with fixtures.
- **Async capture settle:** `useCaptureSettle`. `CaptureBridge.seek` may now return a Promise.
- **Skills:** new `velora-templates` and `velora-cinematography`. The root `velora` and `velora-scenes` skills now route to them, and the lock was refreshed (17 skills).

## Verification

| Gate | Result |
|---|---|
| typecheck, lint:architecture | pass |
| test:architecture | 147 pass |
| test:core | 527 pass (all 180 template × aspect × intensity configurations certified) |
| test:react | 51 pass |
| test:skills | 17 green |
| test:release | 41 pass |
| test:launch | 427 pass |
| test:export | 238 pass |
| test:browser | 10 pass |
| check-installed (agent verify) | pass |
| agent-demos | pass |
| release check | pass |
| Rerun after the final edits (templates, skills, contact-sheet tests) | 34 pass |

## Installed-tarball smoke (fresh Vite React app, Windows)

- `templates ls` worked.
- `new scene` worked in two forms: `--component src/App.tsx` (orbit) and `--route /` (run from PowerShell).
- `new video --blueprint product-reel-20s` worked, and `validate --composition` passed.
- `shot` succeeded for every reel scene.
- `frames --every 30 --contact-sheet --columns 5` produced 20 frames and a 5×4 storyboard.
- An earlier `export-failed` on `frames` did not reproduce. It coincided with Vite's `--force` dependency re-optimization on the first request.

## Deviations from the plan

- **Catalog location.** The catalog is core data in TypeScript, not a top-level `templates/<id>/` directory. This keeps it pure, typed and certifiable in unit tests, with no extra package files.
- **Blueprint scope.** Blueprints scaffold one placeholder-or-slot scene per shot. They declare no transitions; true A/B transitions are Phase 6.
- **Contact sheet method.** Contact sheets are composed in Node with the existing PNG helpers, not with FFmpeg `tile`. This removes the FFmpeg dependency for storyboards.

## Known limitations and findings

- **Git Bash path rewriting.** Git Bash (MSYS) rewrites `--route /x` into a Windows path. Velora now detects this and suggests `MSYS_NO_PATHCONV=1`, and the `velora-templates` skill documents it.
- **Component-mode styling.** Component mode renders the component only. Global CSS such as `index.css` and providers are not applied unless the binding imports or wraps them, as the `TODO(velora)` comment indicates. Route mode avoids this.
- **Short pages.** `scroll-through` on a page no taller than the viewport shows little motion. Prefer long landing pages.
