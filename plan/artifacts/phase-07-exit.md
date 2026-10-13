# Phase 07 Exit — Skills Library Core (2026-10-13)

## Layout decision

Flat `velora-*` alongside `gsap-*` and `threejs-*`, with root at `skills/velora/SKILL.md`. Rationale: matches installed convention, lets existing loaders discover siblings without nesting surprises, and keeps `SKILLS_ROOT_MARKER = velora/SKILL.md` working for both dev checkouts and packed artifacts. Reference, compatibility, templates, and scripts live under `skills/velora/` and install with the same tree.

## Delivered

- `skills/velora/SKILL.md` root (<500 lines) with what/when, full command-to-skill routing table (20 commands), progressive-discovery map, agent execution loop, `doctor → inspect → validate → render → frames → check` golden path with `--json`, and links to installed `gsap-*` and `threejs-*` skills.
- 4 core skills each meeting the content contract (instructions, selection, prereqs, workflow, worked example, anti-patterns, troubleshooting, validation, related, when-not): `velora-init`, `velora-composition`, `velora-scenes`, `velora-render`.
- `skills/velora/REFERENCE.md` stub plus `COMPATIBILITY.md` for Claude Code, Codex, Cursor, and generic agents with `--json`-first snippet and version pinning.
- `src/project/services.ts`: absolute skills transports (`readAbsoluteText`, `listAbsoluteTree`, `ensureAbsoluteDir`, `writeAbsoluteText`, `resolveSkillsDir`, `resolveSkillsSource`, `isVeloraSkillFile`, `skillNameFromRel`) sharing one discovery policy for dev and packed layouts.
- `src/project/commands.ts`: `executeSkillsCommand` with `install-skills` (idempotent, `ERR_SKILL_CONFLICT` on differing targets, `--agent` snippet without config writes, `AGENTS.md`/`CLAUDE.md` refusal), `list-skills` (available plus installed plus drift), and `check-skills` (`ERR_SKILL_MISSING`, `ERR_SKILL_VERSION`, `ERR_SKILL_INVALID`).
- `src/cli/index.ts`: `skills install|ls|check`, plus `inspect`, `assets ls|check|add|rm`, and `validate --composition` wiring so composition skills document only real commands. Usage and per-command help updated; `skills --help` side-effect free.
- `src/core/cli-schema.ts` already carried `skills`, `inspect`, `assets`, and `ERR_SKILL_*`; `authoring.ts` `commands[]` index flows through `guide --json` unchanged.
- `skills-lock.json` extended with 15 local `velora-*` entries (version `0.1.2` plus SHA256).
- `package.json` `files` includes `skills/velora` and `skills/velora-*/SKILL.md` so packed installs resolve `locatePackagedSkills`.
- Tests: `tests/cli/skills.test.ts` (install round-trip, idempotency, unrelated-file refusal, broken-skill gate, agent snippet, inspect and assets wiring), `tests/cli/skills-content.test.ts` (content contract for all 15 plus template fixtures), `tests/core/cli-schema.test.ts` extended to `inspect`, `assets`, and `skills`.

## Validation proof

- `node scripts/check-skills.mjs` green: front-matter, 10 required sections, command refs against `CLI_COMMANDS`, skill refs against known skills, root line budget, lock versions, templates, scripts, and docs.
- `velora skills install --dir <tmp> --json` then `ls` then `check` green; reinstall reports `changed: false` with identical bytes; corrupted target fails with `ERR_SKILL_CONFLICT`; broken front-matter fails with `ERR_SKILL_*`.
- No skill documents a non-existent command or flag (line-segment check against `--help` matrix).
- GSAP and Three.js deep API linked, not copied (spot check for `gsap.to(` outside `velora-gsap`).

## Deviations (documented)

- Wired `inspect` and `assets` plus `validate --composition` in the CLI as bug fixes: backends existed but had no adapter, and composition skills require them to stay truthful. No new core capabilities; all schemas pre-existed.
- `assets rm --yes` parsed as a boolean confirmation (deviation from value-taking `parseMediaArgs`) to match the documented UX.
- `skills check` failure without `data` returns only `issues`; success carries per-skill `ok` plus version drift against running CLI version.

## Gates

typecheck, arch, check-skills, test:core 250/250, test:launch 364/364 (was 330 plus 34 new skills tests).
