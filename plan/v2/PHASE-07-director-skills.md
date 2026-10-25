# Phase 07 — Director Skills v2, Guide v3, Prompt Library & Agent Demos

## Goal
Make coding agents think like a director, cinematographer and editor:
1. Route by **intent** ("launch film", "make my dashboard cinematic", "website hero loop", "vertical teaser").
2. Load only the craft knowledge each intent needs.
3. Follow a director's workflow from brief to delivery.
4. Prove it with replayable agent demos.

Phases 02–06 each shipped their own operational skill updates. This phase consolidates
them into one cohesive creative system.

## Prerequisites
- Phases 02–06 complete (templates, studio, render quality, kit/brand/looks, editorial).

## Scope IN
- Root router v2, director's workflow, skill consolidation, guide v3, prompt library, agent demos C/D/E, skill evals.

## Scope OUT
- New engine capabilities. This phase documents and proves, it does not build features.

## Tasks

### 07.1 Root router v2 — `skills/velora/SKILL.md`
- An intent-first routing table:

  | Intent | Skill chain |
  |---|---|
  | launch film / announcement | `velora-launch` → `velora-templates` (blueprint) → `velora-editing` → `velora-render` |
  | "make my page/dashboard cinematic" | `velora-templates` → `velora-cinematography` |
  | website hero loop | `velora-templates` (`float-loop`, `scroll-through`) → `velora-export` (webm + poster) |
  | vertical/social teaser | `velora-templates` (`social-teaser-9x16`) → `velora-editing` (pacing) → `velora-looks` |
  | bespoke shot | `velora-scenes` → `velora-cinematography` |
  | titles/brand | `velora-brand` → `velora-typography` → `velora-motion-design` |
  | debugging/verification | `velora-debug` / `velora-verify` (unchanged) |

- The root skill stays under 500 lines. Progressive discovery is preserved.

### 07.2 Director's workflow (documented in the root skill and in `velora-launch`)
1. **Brief:** product, audience, single message, platforms, duration, motion personality, must-show features, CTA.
2. **Shot list:** a template per beat, or bespoke shots.
3. **Storyboard:** `velora frames --contact-sheet`.
4. Scaffold.
5. Refine with real components.
6. Draft render (`--quality draft`).
7. `velora review` + `velora check`.
8. Human taste review.
9. Master render.
10. `velora deliver` (Phase 08; until then, per-preset renders).

### 07.3 Skills — consolidation and new craft skills
- New `velora-launch`:
  - story structures (Hook → Problem → Reveal → Proof → CTA; AIDA);
  - platform pacing tables;
  - deliverables per platform (preset references);
  - website hero best practices (size budget, poster, reduced motion, `playsinline muted loop`).
- Cross-links between `velora-cinematography`, `velora-editing`, `velora-motion-design`, `velora-brand` and `velora-looks`, with explicit "when NOT to use".
- Each craft skill includes a **Craft Notes** section that describes technique lineage descriptively (no impersonation, no endorsement claims).
- Decide the fate of `velora-ewmotion` (deferral notice for a nonexistent integration): remove it, or keep it with a one-line router entry.
- Update `VELORA_SKILL_NAMES`, `skills-lock.json` and the release allowlist. `REQUIRED_SKILL_SECTIONS` stays.

### 07.4 Guide v3 — `src/core/authoring.ts`
- `AuthoringGuideSchema.version` → 3. The `VELORA.md` handoff and `check-installed` field comparisons are updated in lockstep.
- New concepts: `templates` (starting points you own), `shot-vocabulary`, `lens`, `editing-rhythm`, `brand-and-looks`.
- Keep `creativeFreedom`, and add: "Templates are starting points; vary shot families across scenes; user direction overrides."
- `capabilities` gains pointers (commands for templates, prompts, presets) rather than embedding catalogs.

### 07.5 Prompt library — `src/core/prompts.ts` (owner `PromptSchema`, `PROMPT_LIBRARY`)
- Each prompt has `{id, title, intent, text (with <placeholders>), templates[], skills[]}`. Examples:
  - `launch-film`
  - `feature-announcement`
  - `website-hero-loop`
  - `vertical-teaser`
  - `dashboard-cinematic`
  - `changelog-video`
  - `product-hunt-assets`
- `velora prompts ls|show --id ID [--json]`.
- `VELORA.md` lists the top prompts.
- The studio "Copy agent prompt" uses the same library (one source of truth).

### 07.6 Agent demos — `tests/agent/demo-{c,d,e}/`, same format as demo A/B
- Each demo has `prompt.md`, `skills-trace.md`, `transcript.json`, `issue-fix-log.md`, `expected-hashes.json`, manifests and an anchor PNG.
  - **C:** launch film from `launch-film-30s` on a fixture SaaS host (Claude Code).
  - **D:** website hero loop from a route (`float-loop` + `scroll-through`), delivered as webm + mp4 + poster (Codex-style generic agent).
  - **E:** 9:16 vertical teaser with karaoke captions and beat-snapped cuts (any skill-compatible agent).
- `scripts/check-agent-demos.mjs` replays the replayable steps and asserts skill-trace coverage of the new commands.

### 07.7 Skill evals
- `velora skills check` validates the new skills (front-matter, sections, cross-links, command/flag references through `extractCommandRefs`).
- Content tests assert each intent in the router resolves to installed skills, and each skill's commands exist in `CLI_COMMANDS`.

## Files
- Skills:
  - `skills/velora/SKILL.md`, `skills/velora/REFERENCE.md`, `skills/velora/COMPATIBILITY.md`
  - new `skills/velora-launch/SKILL.md`
  - all craft skills
- `src/core/{authoring,prompts,cli-schema,resources}.ts`, `src/project/{commands,skills}.ts`, `src/cli/index.ts`
- `tests/agent/demo-{c,d,e}/**`, `scripts/check-agent-demos.mjs`, `scripts/check-installed.mjs`

## Tests
- `tests/cli/skills-content.test.ts` (router coverage).
- `tests/core/prompts.test.ts`.
- `tests/core/authoring.test.ts` (v3 schema).
- `test:agent-demos` (C/D/E replay).

## Validation criteria
- [ ] An agent given only root `SKILL.md` + `--help` reproduces demo C.
- [ ] Every routed intent loads ≤ 4 skills.
- [ ] `velora skills check --json` is clean; no skill references an unbuilt command or flag.

## Anti-patterns
- Encyclopedic skills that agents must read in full.
- Copying GSAP/Three.js API docs (reference the installed skills instead).
- Craft notes phrased as endorsements or impersonations of real people.

## Definition of Done
All validation green. Demos recorded. `plan/v2/artifacts/phase-07-exit.md` written.
