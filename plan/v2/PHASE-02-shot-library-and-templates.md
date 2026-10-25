# Phase 02 — Shot Library, Template System & Wave 1

## Goal
Turn cinematography into reusable, certified starting points:

```sh
npx velora templates ls
npx velora new scene --template hero-push --id home-hero --route /
npx velora new scene --template orbit-reveal --id dash-orbit --component src/components/Dashboard.tsx#Dashboard
```

Each command writes plain, editable recipe JSON + TSX that validate, appear in the library
and render deterministically. A template is a **starting point the creator owns**; nothing at
runtime depends on the template system.

## Prerequisites
- Phase 01: easings, smooth paths, lens helpers, noise, channels, `$schema`.

## Scope IN
- Pure shot builders with framing analysis.
- Template manifest format, shipped `templates/` directory, scaffolder, CLI (`templates`, `new`).
- Minimal kit (`RouteFrame`, `SlotPlaceholder`) with async capture settle.
- Contact sheets.
- One-step skills install.
- Wave 1 (12 camera templates + 2 starter blueprints).
- Skills `velora-templates` and `velora-cinematography`; guide workflow update.

## Scope OUT
- Studio gallery and quick shots (03), quality presets and motion blur (04), full kit, brand and motion-graphics templates (05), launch blueprints (06).

## Tasks

### 02.1 Shot builders — `src/core/shots.ts` (owners `ShotKindSchema`, `ShotInputSchema`, `buildShot`, `framingReport`)
- `ShotInputSchema` fields:
  - `kind`, `subject {width,height}`, `frame {width,height}` (output canvas, default 1920×1080), `durationMs`;
  - `intensity: subtle|standard|dramatic` (default `subtle`), `direction` (kind-specific), `lens` (mm, default 50);
  - `focusRegion {x,y,width,height}` (subject px; default = subject center third), `symmetry` (bool), `seed`, `loop`, `scroll {fromY,toY}`.
- `buildShot(input) → PreviewDefinitionInput` with node `subject` (plus kind-specific nodes). The output always passes `presentPreview`.
  - Camera paths use `interpolation: "smooth"` + a track-level `ease`.
  - Orbit and arc keep a target point fixed by compensating camera translation computed with `matrixFor`/`multiply` (`src/core/spatial.ts`).
  - Aspect-aware: the same kind adapts camera distance and crop to `frame`.
- `framingReport(definition, subject, {samples = 24})`: pure sampling through `evaluateScene` + perspective projection, with no DOM. Per sample it reports:
  - `subjectVisible` (fraction of a 9×9 subject grid inside the frame);
  - `focusVisible`;
  - `minDepthMargin` (perspective − max camera-space z, as a fraction of perspective);
  - `focusBlurAtRegion` (via `sampleFocus`).
- Consumers: the certification tests, `velora templates check`, and `reviewAuthoring` advice ("subject leaves frame at t=…").

### 02.2 Template format — `src/core/templates.ts` (owners `TemplateManifestSchema`, `TemplateParamSchema`, `resolveTemplateParams`)
- Manifest `templates/<id>/template.json`, version 1. Fields:
  - identity and grouping: `id`, `version` (semver), `title`, `summary`, `category` (`camera | layered | motion-graphics | blueprint`), `tags[]`;
  - `shot {kind, defaults}` (camera templates);
  - `slots[] {name, kind: component|route|region|text|asset|number|color, required, description}`;
  - `params[]` (typed: number{min,max,step,unit}, enum{options}, boolean, string{maxLength}, color), each with `default` and `description`;
  - `aspects[]` (`16:9 | 9:16 | 1:1 | 4:5 | 21:9`), `durationMs {min,default,max}`;
  - `craft {technique, motivation, lineage, pitfalls, pairsWellWith[]}`;
  - `certification {minSubjectVisible, minFocusVisible, heroTimes[]}`;
  - `files {binding, brief?}`.
- `resolveTemplateParams(manifest, overrides)` validates, coerces `--set` strings and fills defaults, returning stable `ERR_TEMPLATE_PARAM` issues.
- Ship templates in a top-level `templates/` directory, added to package.json `files` and the `scripts/release.mjs` allowlist (`templates/<id>/{template.json,binding.tsx,brief.md}`). The manifest JSON Schema is added to `schemas/`.

### 02.3 Scaffolder — `src/project/templates.ts` (projectAdapter: pure generation) + command layer
- Pure generation:
  - recipe = `buildShot(resolved)` wrapped in `{$schema, version:1, id, title, description, template:{id,version,params}, definition}`;
  - binding = template `binding.tsx` source with slot markers (`/*@velora:imports*/`, `{/*@velora:slot subject*/}`) substituted.
- `--component path#Export`:
  - verify the file exists inside the project;
  - verify a matching named/default export via the TypeScript AST, without execution;
  - compute the import path relative to `src/velora/scenes/`;
  - add a `// TODO(velora): wrap with the providers this component needs` comment when the component is not the app root.
- `--route /path`: validated by core `RouteSchema` (must start with `/`, no `//`, no scheme). The slot becomes `<RouteFrame route=… />`.
- No slot given → `<SlotPlaceholder name=… />` with warning `WARN_TEMPLATE_PLACEHOLDER`.
- `SceneRecipeSchema` gains an optional `template` provenance field.
- Commands are wired through `executeProjectCommand` (`src/project/commands.ts`) with core request schemas (`NewSceneSchema`, `NewVideoSchema`, `ListTemplatesSchema`, `ShowTemplateSchema`, `CheckTemplatesSchema`) registered in `RESOURCES`. Writes use the existing journaled, exclusive, create-only services and refuse existing targets (`ERR_SCENE_EXISTS`).
- After writing, discovery validation runs on the new pair through `loadSceneRecipes`. The result returns `next` commands: `velora open --scene`, `velora shot --scene`, and `velora sync` for non-Vite hosts.

### 02.4 CLI — `src/cli/index.ts`, `src/core/cli-schema.ts`
- `velora templates ls [--category C] [--tag T] [--aspect A] [--json]`
- `velora templates show --id ID [--json]`: manifest, slots guide, example commands.
- `velora templates check [--id ID] [--json]`: certification via `framingReport` (pure, no browser).
- `velora new scene --template ID --id SLUG [--component PATH#EXPORT | --route /PATH] [--set KEY=VALUE]... [--aspect A] [--duration MS] [--title T] [--project DIR] [--json]`
- `velora new video --blueprint ID --id SLUG [--set KEY=VALUE]... [--aspect A] [--project DIR] [--json]`: writes the composition plus each scene pair.
- `velora frames … --contact-sheet [--columns N]`: FFmpeg `tile` over the extracted frames, producing a single storyboard PNG (agents read one image instead of thirty).
- The parser allows `--set` to repeat (every other flag keeps `ERR_DUPLICATE_OPTION`).
- New catalog codes: `ERR_TEMPLATE_NOT_FOUND`, `ERR_TEMPLATE_PARAM`, `ERR_TEMPLATE_ASPECT`, `ERR_SLOT_UNRESOLVED`, `ERR_COMPONENT_EXPORT_MISSING`, `ERR_ROUTE_INVALID`, `ERR_ROUTE_FRAME_BLOCKED`, `ERR_SCENE_EXISTS`; warning `WARN_TEMPLATE_PLACEHOLDER`.
- `CLI_COMMANDS` entries name the owning skills.

### 02.5 Minimal kit — new `src/kit/` layer + `./kit` export
- Architecture:
  - `scripts/check-architecture.mjs` adds `kit: {local:['core','react','kit'], external:['react','react-dom']}` with a fixture, and `preview` may depend on `kit`;
  - `vite.lib.config.ts` adds a `kit` entry;
  - package.json `exports["./kit"]`.
- `RouteFrame {route, width, height, scrollChannel?, scrollY?, freezeAnimations = true, hideScrollbars = true, title}`:
  - renders a same-origin iframe of a host route at a fixed viewport size (desktop or phone presets);
  - `freezeAnimations` injects a pause/no-transition stylesheet into the iframe document;
  - scroll is applied from the channel synchronously per seek;
  - a cross-origin or blocked frame reports `ERR_ROUTE_FRAME_BLOCKED`, which blocks capture with a hint.
- `SlotPlaceholder {name, hint}`: neutral labeled panel; `data-velora-placeholder` marker.
- **Async capture settle (v1.1, backward compatible):**
  - `useSceneCapture`'s `seek` may return a Promise;
  - components register settle work via `useCaptureSettle(fn)` (iframe load, fonts and images in view after scroll);
  - export services already `await page.evaluate(...)`;
  - `CaptureManifestSchema` stays version 1, with an optional `asyncSeek: true`.

### 02.6 One-step skills install
- `velora skills install --agent claude` without `--dir` resolves the project's `.claude/skills`.
- `--agent generic` resolves `.agents/skills`, the cross-agent convention used by this repo's `skills-lock.json` tooling.
- Codex and Cursor still require `--dir` until their conventions are verified.
- `velora init --skills claude|generic` performs the same install after setup.
- Existing conflict semantics (`ERR_SKILL_CONFLICT`) are unchanged.

### 02.7 Wave 1 content (details in `TEMPLATE-CATALOG.md`)
- Camera templates: `hero-push`, `monumental-survey`, `orbit-reveal`, `crane-down`, `tilt-up-reveal`, `dolly-zoom`, `rack-focus`, `scroll-through`, `macro-detail`, `float-loop`, `handheld-push`, `whip-pan`.
  - The full whip feel needs Phase 04 motion blur; until then the template documents the reduced effect.
- Starter blueprints:
  - `product-reel-20s` (four camera shots with entering transitions);
  - `website-hero-loop-8s` (`float-loop`, seamless).
- `skills/velora/templates/*` stubs become pointers to `velora templates`; `scene-minimal` stays as the wiring reference.

### 02.8 Skills and guide
- New `velora-templates`:
  - intent → template decision table;
  - scaffold, fill slots, tune params, re-scaffold;
  - when NOT to use a template (a request for a unique, bespoke shot).
- New `velora-cinematography`:
  - shot sizes ↔ camera distance/subject fraction;
  - angles (eye, high, low, overhead, Dutch);
  - movements (push, pull, truck, pedestal, pan, tilt, arc, crane, dolly-zoom, whip, rack focus, handheld);
  - lens mm ↔ perspective;
  - aperture choices;
  - composition (thirds, leading lines, negative space, symmetry, lead room);
  - motivated movement and restraint;
  - craft lineage as technique references.
- Update the `velora` router and `velora-scenes`; extend `VELORA_SKILL_NAMES` (`src/project/skills.ts:13`) and `skills-lock.json`.
- Guide:
  - remove "No builder, template loader…" (`src/core/authoring.ts:93`);
  - add the workflow step "if a template matches the intent, scaffold it, then refine";
  - add `capabilities.templates` (count + discovery command, not the catalog).

## Contracts
| Command / schema | Contract |
|---|---|
| `templates ls/show/check --json` | Envelope `{success, command, data}`; `check` returns per-template framing reports |
| `new scene/video --json` | `data: {files[], recipe, warnings[]}`; `next` commands; create-only |
| `SceneRecipeSchema.template` | Optional `{id, version, params}` |
| `TemplateManifestSchema` v1 | As 02.2; JSON Schema shipped |
| Capture bridge | `seek` may return a Promise; manifest v1 + optional `asyncSeek` |

## Files
- New:
  - `src/core/{shots,templates}.ts`, `src/project/templates.ts`
  - `src/kit/{index,RouteFrame,SlotPlaceholder}.tsx`
  - `templates/**`
  - `skills/velora-templates/SKILL.md`, `skills/velora-cinematography/SKILL.md`
- Modified:
  - `src/core/{recipes,cli-schema,resources,authoring,index}.ts`, `src/project/{commands,services,skills}.ts`
  - `src/cli/index.ts`, `src/react/capture.ts`, `src/export/{commands,services}.ts` (contact sheet, async seek)
  - `vite.lib.config.ts`, `tsconfig.lib.json`, package.json, `scripts/{check-architecture,release}.mjs`

## Tests
- `tests/templates/certification.test.ts`: every template × every declared aspect × each intensity gives a valid definition, framing thresholds met at hero times and every sample, and determinism (same input → identical JSON).
- `tests/templates/render-determinism.test.ts` (browser tier): a fixture host renders each template's hero frames twice with identical SHAs.
- `tests/project/templates.test.ts`:
  - scaffold create-only;
  - conflict refusal;
  - component export detection (named and default);
  - route validation;
  - placeholder warning;
  - provenance;
  - binding Surface ids ⊇ recipe nodes.
- `tests/cli/templates.test.ts`: envelopes, help, exit codes, repeated `--set`.
- `tests/react/kit.test.tsx`: RouteFrame same-origin rendering, scroll channel, freeze stylesheet, blocked diagnostic; async seek awaited.

## Validation criteria
- [ ] Fresh Vite host: `velora new scene --template hero-push --id home-hero --route /`, then `velora shot --scene home-hero --time 3000` shows the real home page in a 3/4 push-in with focus on the hero region.
- [ ] Same with `--component` for a provider-free component.
- [ ] `velora templates check --json` passes all Wave 1 templates.
- [ ] `velora new video --blueprint product-reel-20s` → `velora render` produces a valid MP4 → `velora check --video` green.
- [ ] A contact sheet of a 20 s composition is a single readable PNG.

## Anti-patterns
- Runtime template engines, or bindings that import from `templates/`.
- Templates that recreate host UI instead of slotting real components or routes.
- Hidden magic numbers: every tunable is a declared param with a range.
- Templates that pass validation but fail framing (the subject lost off-frame).
- Cross-origin RouteFrame targets.

## Definition of Done
All tests and validation green; Wave 1 certified; skills checked; guide updated;
`plan/v2/artifacts/phase-02-exit.md` includes a contact sheet per template.
