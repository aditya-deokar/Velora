# Phase 11 — Agent parity, skills, quality gates and release (1.1.0)

## Goal
Ship v2.1 as a coherent, honest release: everything the editor does is reachable and documented
for agents, the guide and skills teach the new hand-and-agent workflow, performance, accessibility
and security are pinned by tests on every supported host, and the docs describe exactly what was
built.

## Prerequisites
- Phases 00–10 and the cinematic track 12–16 complete (or explicitly descoped in their exit
  reports — descoped features must not appear in docs or skills).

## Scope IN
- Parity audit tests; editor ↔ agent handoff; guide v4 and `VELORA.md` format 4 (D5); skills;
  docs; performance, accessibility and security gates; cross-host matrix; package budget;
  changelog and version.

## Scope OUT
- New editing features (follow-ups list at the end).

## Tasks

### 11.1 Parity audit (tests, not prose)
- `tests/core/parity.test.ts`: enumerate every `EditOpSchema` variant and assert (a) a CLI path
  exists (`velora edit apply` accepts it; ergonomic subcommands listed where they exist), (b) the
  `velora-editor` skill documents it (parsed table), (c) `describeOp` has a label.
- Every `EDITOR_COMMANDS` entry maps to an op family or is tagged `ui-only` (selection, view,
  panels) — test fails on untagged commands.

### 11.2 Editor ↔ agent handoff
- "Ask agent" (top bar and context menus): copies a prompt with scene/composition id, selection
  (track refs, clip ids, time range), playhead, recent history labels and the user's intent text;
  prompts come from `PROMPT_LIBRARY` (`src/core/prompts.ts`) — new entries: `edit-with-agent`,
  `polish-easing`, `stagger-entrances`, `rack-focus`, `promote-layer`, `recut-to-beats`, and for
  the cinematic track `laptop-product-film`, `telephoto-hero`, `drone-flyover`, `whip-to-cta`;
  existing tests check every named command/flag/skill against the catalogs.
- History "Copy as command" (04.7) and the read-only "Copy as command" produce runnable
  `velora edit apply` invocations (tests run them).
- Agent etiquette in skills: when `velora edit` is running, agents use `--expect-sha` and re-read
  after `ERR_EDIT_CONFLICT`; the editor shows agent writes as external changes (rebase).

### 11.3 Guide v4 and handoff format 4 (D5)
- `AuthoringGuideSchema.version` 4: concepts *editor* (Edit mode, bridge, ops), *clips & groups*,
  *paths & constraints*, *animatables*, *style vars & color*, *three entry*, and for the cinematic
  track *app stage*, *depth layers & light*, *optics & rack focus*, *element targets*, *rigs*;
  capabilities point at commands (`velora edit …`, `velora anchors`) rather than embedding catalogs
  (v3 rule). `capabilities.stages`, `lensPresets` and `rigs` are data tables generated from the
  owners.
- `VELORA.md` format 4; `init` recognizes format-3 bytes (any package name, Vite and portable
  hosts) and upgrades in place; edited files refused (same policy as the v2 upgrade).

### 11.4 Skills
- New/complete: `velora-editor` (ops table, shorthand, dry-run loop, bridge etiquette,
  codemods, composition ops).
- Updated: `velora` router (intents "edit visually", "polish timing", "group/stagger",
  "animate a 3D model", "recut to the beat"), `velora-motion-design` (graph-editor craft: easy
  ease as default for UI, overshoot only for intentional pop, spring vocabulary, OKLab color
  moves), `velora-cinematography` (look-at, follow focus, rigs, director view, dolly-zoom tool),
  `velora-threejs`, `velora-typography` (`TextAnimator`), `velora-editing` (lanes, trim tools),
  `velora-scenes` (animatables, promote to layer). `velora skills check` clean; parser executes
  every command in skills/README/USER_GUIDE (v2 practice).
- Cinematic track: one **house style** that coding agents follow by default, stated in the
  `velora` router and enforced by a skills test that rejects contradicting examples:
  1. **Stage:** always render app UI inside a laptop stage: `--stage laptop-14` (1512×982 @2×), `laptop-13` (1440×900 @2×), or the user's detected stage (ask them to click "Use my laptop" in the studio). Never a 1920×1080 @1× app stage unless asked.
  2. **Lens:** pick from `lensPresets`. The hero and close-up default is `200mm-telephoto` with framing hold; `24mm-drone` is for fly-throughs; `85mm-portrait` for whips and racks. Never hand-tuned `perspective`.
  3. **Depth:** turn on `depth: auto` (or `resolved` for final renders) on the app Surface; mark key elements with `data-velora-tier` and `data-velora-anchor`.
  4. **Targets:** run `velora anchors --scene <id> --json` before writing any aim, focus or rack. Use `lookAt`/`focusFollow`/`frame` on anchors, never pixel guesses.
  5. **Movement:** use rigs (`velora edit rig …`) for camera travel, and `buildRackFocus` (breathing on) for attention shifts. Keep `subtle` as the default intensity.
  6. **Verify:** `velora inspect --scene <id> --json` (stage, resolution budget, per-layer focus), `velora shot` at the landing times, then export.
- Per-skill updates for the cinematic track:

  | Skill | Covers |
  |---|---|
  | `velora-scenes` | Stage, `AppStage`, depth config, anchors and tiers markup |
  | `velora-cinematography` | Lens presets and telephoto compression (what parallax really comes from), rack with breathing, rigs, element targets, physical depth-of-field numbers |
  | `velora-templates` | `--stage`, `--focus <anchor>` |
  | `velora-export` | Stage DPR, `effectiveDpr`, capture cost, velocity blur vs `--motion-blur` |
  | `velora-performance` | Layer caps, DPR cost |
  | `velora-verify` | `velora anchors`, cleanliness, rack and rig reports |
  | `velora-debug` | `depth-flattened`, `depth-contested`, `ERR_TARGET_MISSING`, `stage-undersampled` |
  | `velora-motion-design` | Mass vocabulary, banking restraint |

  Every example in these skills uses `laptop-14` or a detected stage.

### 11.5 Docs (two-file rule in `docs/`)
- `docs/architecture.md`: sections *Motion model v3*, *Clips, paths and constraints*, *Edit
  operations and the bridge*, *Editor*, *Source codemods*, *Three entry*, *Composition editing*,
  *App stage and output frame*, *Depth layers and the host-style ledger* (D11 boundary), *Optics*,
  *Element targets*, *Rigs*; boundaries and security list updated.
- `docs/product.md`: four paths (zero code, scaffold, direct by hand, direct by agent); studio
  Edit mode; boundaries (local bridge, opt-in codemods, React 19 for `/three`).
- `README.md` editor section with a Velora-rendered demo; `USER_GUIDE.md` Edit-mode walkthrough
  (first keyframe, graph editor, group and stagger, camera tools, promote a layer, 3D, recut);
  `website/` showcase page.

### 11.6 Quality gates
- **Performance** (`playwright.performance.config.ts`, device-specific evidence in the exit
  report): scrub ≥ 55 fps median (60 surfaces / 300 tracks); timeline 200 rows × 1,000 keys
  without long tasks > 50 ms; gizmo drag repaint ≤ 16 ms p95; commit → HMR visible ≤ 300 ms
  (Vite) and ≤ 1 s (Next dev); editor chunk load ≤ 1 s on the reference machine.
- **Accessibility**: `axe-core` (devDependency, MPL-2.0, never packed — confirm in license
  review) on every editor panel in browser tests; keyboard-only journey (first keyframe, easing,
  group) passes.
- **Security** (`tests/project/security.test.ts`): bridge suite (token, origin, host, size,
  paths, symlinks, read-only, loopback), source endpoints, journal recovery, no token in URLs
  after load, `open` disabled by default; architecture fixtures (no gsap; editor ↛ services;
  preview → editor only dynamically; editor ↛ three).
- **Cross-host matrix** (local + CI tiers as in v2): Vite React 19, Next App Router React 19,
  Next Pages React 18 (no `/three`), esbuild React 18 portable host, any-site mode — editor
  journeys from Phases 04–08 (and 09 where React 19), export parity.
- **Goldens**: Phase 00 goldens unchanged (motion, spatial, optics, shot and capture); formatter
  corpus no-op identity.
- **Cinematic gates**:
  - stage parity and close-up sharpness (12);
  - host cleanliness on every host in the cross-host matrix, in-tree and RouteFrame (13);
  - optics, rack and target-lock suites (14, 15);
  - rig determinism (16);
  - capture cost at DPR 2 within the S7 budget, with device evidence in the exit report.
- **Contract check**: a CLI snapshot test diffs every `CLI_COMMANDS` entry, flag, default and JSON
  envelope against 1.0. Only additions are allowed.
- **Package budget**: within `PACKAGE_BUDGET` (6 MB unpacked, 2 MB/file); editor and three chunks
  absent from installed hosts' production assets.

### 11.7 Release
- `CHANGELOG.md` 1.1.0 (additive: recipe v1 / scene v3 unchanged; new optional fields require
  ≥ 1.1 to read), deprecations none; version bump and tag by the maintainer; exit reports
  `plan/v2.1/artifacts/phase-11-exit.md` and README §10 "Final status" filled in.

## Follow-ups (not in v2.1; recorded so they are not silently promised)
- Audio gain/pan automation curves on lanes; per-track audio effects.
- Shape path morphing (SVG `d` interpolation) and mask paths drawn with a pen.
- Expression-like math beyond declarative links (deliberately excluded for determinism/safety).
- Multi-user collaboration and comments; cloud anything (out of product scope).
- Theatre.js state import (only if Theatre 1.0 ships under compatible terms; converter into
  recipes, never a runtime dependency).
- Animated lights (light tracks) and multiple light sources for depth layers.
- Radial (zoom) velocity blur; anamorphic squeeze, bokeh shapes, chromatic aberration.
- Per-pixel depth for iframe content beyond rectangular layers.

## Contracts
- Guide v4, handoff format 4, prompt library entries, parity test as the living contract.

## Files
- Modified: `src/core/{authoring,prompts,cli-schema}.ts`, `src/project/{commands,services}.ts`
  (handoff upgrade), skills (listed), `docs/{architecture,product}.md`, `README.md`,
  `USER_GUIDE.md`, `CHANGELOG.md`, `package.json`, `website/**`, `tests/**`,
  `playwright.performance.config.ts`, `scripts/release.mjs`

## Tests
- Parity, prompts, guide v4 schema, handoff upgrade (format 3 → 4, edited refusal), skills check
  and command execution, performance/accessibility/security suites, cross-host matrix, package
  checks.

## Validation criteria
- [ ] All README §8 success metrics met with evidence in the exit report.
- [ ] `npm run verify:release` green locally; CI green on Linux, Windows and macOS.
- [ ] No doc or skill mentions a descoped feature (honesty check).

## Anti-patterns
- Documenting follow-ups as available; skill text not backed by executed commands.
- Performance claims without device evidence.

## Definition of Done
Release-ready 1.1.0 with all gates green, docs and skills honest, and v2.1 README §10 "Final
status" written.
