# Phase 02 — Composition Spec, Project Inspection, Assets & Reusable Scenes

## Goal
Give agents **machine-readable composition specifications, project/composition inspection, asset management, and reusable scene components** — so they can plan before generating code. Implements `prompt.md`: *"project and composition inspection, asset management, reusable scene components … machine-readable composition specifications, schema validation."*

## Prerequisites
- Phase 00 audit; Phase 01 envelope + error catalog (all new inspection outputs use them).

## Scope IN
- `velora inspect` family, composition spec schema (`*.composition.json`), asset commands, scene-component catalog, extended `validate`.
- Recipe system evolution (backward-compatible with `SceneRecipeSchema` v1 / scene v3).

## Scope OUT
- No timeline orchestration semantics (Phase 03), no audio/type/3D content (04–05). Inspection reports what exists; it doesn't create motion.

## Tasks

### 02.1 Composition spec (`src/core/composition.ts` NEW)
Define `CompositionSchema` v1 (Zod, strict):
```json
{
  "version": 1, "id": "launch-teaser", "title": "…",
  "width": 1920, "height": 1080, "fps": 30,
  "scenes": [{ "id": "page-survey", "recipe": "page-survey", "startMs": 0, "durationMs": 6000 }],
  "assets": [{ "id": "logo", "path": "assets/logo.png", "type": "image" }],
  "seed": 42
}
```
- Rules: scene IDs unique; `startMs/durationMs` non-negative; total duration derived; `width/height/fps` bounded (fps ∈ {30,60,120} initially — matches `SUPPORTED_EXPORT_FPS`); `seed` uint32 for determinism (consumed in Phase 03).
- Validation errors → `ERR_COMPOSITION_INVALID` (+ field `path`). TS types derive from Zod. Export JSON Schema for agents.

### 02.2 Inspect commands (`src/project/discovery.ts`, `commands.ts`, `src/cli/index.ts`)
| Command | Output (`--json` data) |
|---|---|
| `velora inspect --project DIR` | project kind, entry, React version, integration kind, recipe count, asset count, issues |
| `velora inspect --scene ID` | recipe JSON + binding path + node IDs + registered Surface IDs (when server up) + diagnostics |
| `velora inspect --composition FILE` | parsed spec + resolved scenes/assets + timeline totals + issues |
| `velora list assets \| scenes` (`scenes` exists — extend) | tabular human + envelope JSON (id, title, path, snapshot status) |

- All read-only, non-mutating, `--json` by default for agents. Reuse `loadSceneRecipes` canonical op; never execute TSX during inspect.

### 02.3 Asset management (`src/core/assets.ts` NEW + project services)
- Convention: `assets/` under project root (images, video, audio, fonts). `assets.json` manifest optional; discovery is file-based.
- Commands: `velora assets add <file> --as <id>` (scoped copy + type sniff + size/dimension probe), `velora assets ls --json`, `velora assets rm --id <id> --yes`, `velora assets check --json` (missing/oversize/unsupported-codec diagnostics).
- New codes: `ERR_ASSET_NOT_FOUND, ERR_ASSET_UNSUPPORTED, ERR_ASSET_TOO_LARGE`.
- Guards: path/symlink checks + journaled writes (same ownership model as `portable.ts` generated files); never overwrite unrelated files.

### 02.4 Reusable scene components
- Extend recipe dir `src/velora/scenes/` (keep `SCENE_RECIPE_DIRECTORY`): allow `*.scene.json` + sibling `.{tsx,jsx}` + optional `*.thumb.png` (snapshot-owned).
- Add `velora scene create --id <slug> --from <template>` (templates land in Phase 08; stub with 1 minimal template now) and `velora scene ls --json` (alias of `scenes --json` with richer fields: duration, node count, snapshot freshness).
- Shared-component convention: `src/velora/components/*` for reusable Surface wrappers; `inspect --scene` reports their binding paths. No second validator — all through `loadSceneRecipes`.

### 02.5 `validate` upgrade
- `velora validate [--composition FILE] --json`: validates recipes + bindings + assets + composition in one pass; returns categorized `issues[]` + `advice[]` (reuse `reviewAuthoring` shape + `requiresVisualReview:true`).
- New codes: `ERR_BINDING_MISSING, ERR_COMPOSITION_INVALID, ERR_ASSET_*`. Human mode prints grouped diagnostics (keep current behavior compatible).

## Files to modify
- NEW `src/core/composition.ts`, `src/core/assets.ts`, `src/core/cli-schema.ts` (extend).
- `src/project/discovery.ts` (inspect ops), `commands.ts` (wire), `recipes.ts` (richer listing), `services.ts` (asset IO), `src/cli/index.ts` (parse + help).
- Tests: `tests/project/*`, `tests/cli/*` (inspect/assets/validate/composition fixtures — valid + violating fixtures prove rejection).

## Tests
- `vitest run tests/project tests/cli` green; add negative fixtures (duplicate scene id, negative duration, missing binding, missing asset, bad fps).
- `npm run lint:architecture` green (new core modules pure; services own IO).

## Validation criteria
- [ ] Agent can plan a video from `inspect` + `inspect --composition` JSON alone, without reading source.
- [ ] `validate --composition` catches 6+ failure classes with field-accurate `path` + one-step `hint`.
- [ ] Asset round-trip (`add → ls → check → rm`) works in a disposable host; unrelated files untouched.
- [ ] Old recipes (v1/scene-v3, `local-project/` 10 fixtures) still list/load/open/snapshot.

## Anti-patterns
- Executing TSX during inspection (parse JSON + static binding paths only).
- Inventing a DB or lockfile for the catalog (code-driven: files are the catalog).
- Serializing React elements, credentials, or raw records into composition JSON.

## Definition of Done
Inspection + assets + composition-spec slices merged with schema tests + CLI tests, and Phase 03 can build timeline/determinism on `CompositionSchema` without redefining it.
