# Phase 07 — Skills Library Core (root SKILL.md, install, progressive discovery)

## Goal
Ship the **installable Velora Skills library skeleton** with the root entry point, installation workflow, and first skill batch — so agents can discover what exists and load only what's relevant. Implements `prompt.md`: *"root `SKILL.md` that acts as the agent's entry point … progressive skill discovery … standard skills installation workflow."*

## Prerequisites
- Phases 01 (envelope/codes/doctor), 02 (composition/inspect). Read installed-skill front-matter conventions from `skills/*/SKILL.md` + `skills-lock.json` before writing (match the loader agents expect).

## Scope IN
- `skills/velora/` tree (or top-level `velora-*` per repo convention decision below), root `SKILL.md`, `install` command, routing table, 4 core skills.
- Compatibility doc + agent-specific config (Claude Code / Codex / Cursor) without coupling core to one agent.

## Scope OUT
- Specialized domain skills (Phase 08). No new render capabilities — skills document Phases 01–03 + existing authoring guide only.

## Tasks

### 07.1 Layout decision + root SKILL.md
- Decide: `skills/velora/SKILL.md` + siblings vs flat `skills/velora-*/SKILL.md` alongside `gsap-*`/`threejs-*`. Recommendation: **flat `velora-*`** (matches installed convention, lets existing loaders discover them, avoids nesting surprises). Record decision in exit note.
- Root `skills/velora/SKILL.md` (<500 lines) MUST contain:
  1. What Velora is / when to use it (agent-native video from live React UI) vs Remotion/human editors.
  2. Command↔skill routing table (every CLI command → owning skill).
  3. Progressive-discovery map (request type → skills to load, e.g. "3D scene → `velora-threejs` + `threejs-fundamentals`").
  4. The agent execution loop (interpret → load → inspect → plan → generate → CLI → preview → frames → fix → repeat).
  5. `doctor → inspect → validate → render → frames → check` golden path with `--json` throughout.
  6. Links (not copies) to installed GSAP/Three.js skills for deep API.
- Every skill file front-matter: `name, version (pins CLI version), when-to-use, prerequisites, commands, related-skills, not-for`.

### 07.2 Install flow
- `velora skills install [--agent claude|codex|cursor|generic] [--dir PATH] --json`: copies/links the Velora skill tree into the agent's skill path (or prints the copy block for managed agents); verifies versions (`skills-lock.json` extended); idempotent (same bytes on re-run, like `init-project`).
- `velora skills ls --json` (installed + available + version drift), `velora skills check --json` (missing/outdated/broken front-matter → `ERR_SKILL_*`).
- No `AGENTS.md`/`CLAUDE.md`/provider-config overwrite (same guard as `init-project`'s unrelated-file refusal).

### 07.3 First skill batch (4, each with: instructions, command-selection, prerequisites, workflow, working example, anti-patterns, troubleshooting, validation)
1. `velora-init` — project init, `FLUTE.md`/`VELORA.md` handoff, `doctor`, framework adapters (Next/Vite/portable/Electron), `sync`. When NOT: don't re-init healthy projects.
2. `velora-composition` — composition spec authoring, `inspect`, `validate`, assets, reusable scenes. Includes JSON example (from Phase 02 schema) + negative examples.
3. `velora-scenes` — scene/timeline creation via recipes + `ScenePreview`/`Surface` rules (distills `getAuthoringGuide` + Phase 03 clock: one cursor, frame math, seed). States shot families (travel/plating/micro/floating) as options, not mandates.
4. `velora-render` — `render/frames/shot/check --visual`, progress NDJSON, cache/parallel flags, manifest reading, fix-loop.

### 07.4 Compatibility + agent config
- `docs`-side (NOT `docs/` — checker-limited; use `skills/velora/COMPATIBILITY.md` or package README section): Claude Code / Codex / Cursor / generic skill-agent setup, skill-path conventions, `--json`-first prompting snippet, version pinning.
- Optional per-agent snippet behind `skills install --agent` (prints config, never writes outside its scope without consent).

## Files to create/modify
- NEW `skills/velora*/SKILL.md` ×5 (root + 4), `skills/velora/REFERENCE.md` stub (grows in 08).
- `src/project/commands.ts` + services (skills ops), `src/cli/index.ts` (`skills` subcommand + help), `skills-lock.json` (extend), `RESOURCES` bindings.
- `src/core/authoring.ts`: expose `commands[]` index for `guide --json` (skill pointers) — additive only.
- Tests: `tests/cli/*` (install/ls/check idempotency + guards), front-matter lint script (every skill parses, required fields present, line budget on root), `verify:agent` extended with installed-skills path.

## Tests
- Skills install round-trip in disposable dir (install → ls → check green; re-install byte-identical; unrelated-file refusal).
- Every code example in the 4 skills typechecks and its CLI commands run against fixtures (no mock commands — CI executes them).
- Root `SKILL.md` line/length budget enforced by lint.

## Validation criteria
- [ ] A fresh agent with only the root `SKILL.md` loaded can reach a first validated render by following its routing table.
- [ ] `skills check` catches a deliberately broken skill (bad front-matter) with `ERR_SKILL_*`.
- [ ] No skill documents a command/flag that doesn't exist (grep-tested against `--help` outputs).
- [ ] GSAP/Three.js deep API is linked, not duplicated (similarity spot-check).

## Anti-patterns
- Mega-skill (root teaching everything — enforce progressive loading).
- Documenting aspirational commands (only Phases 01–03 + current guide surface).
- Agent lock-in (core works with `--json` for any agent; snippets are additive).

## Definition of Done
Installable skills core merged, `skills install/ls/check` green, 4 skills each meeting the content contract (instructions, selection guidance, prereqs, workflow, example, anti-patterns, troubleshooting, validation + when/when-not), and Phase 08 can add domain skills without restructuring.
