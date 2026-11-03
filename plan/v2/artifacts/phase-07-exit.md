# Phase 7 Exit — Director Skills v2, Guide v3, Prompt Library, Agent Demos C/D/E

Status: implemented. Date: 2026-11-03.

## Delivered

- **07.1 Root router v2** (`skills/velora/SKILL.md`, 215 lines):
  - an intent table maps nine intents to skill chains of at most four skills;
  - narrower needs are listed separately;
  - `velora-ewmotion` keeps a one-line entry.
- **07.2 Director's workflow:** brief → shot list → storyboard (`frames --contact-sheet`) → scaffold → refine → draft → review and check → taste review → master → deliver. It is documented in the root skill and in `velora-launch`, alongside the inner verify loop.
- **07.3 Skills:**
  - New `velora-launch`: brief; story structures (Hook/Problem/Reveal/Proof/CTA, AIDA, before/after); platform pacing table; deliverables per preset; website hero practice with the embed snippet.
  - Craft Notes sections (descriptive technique lineage; no endorsements or impersonation) in cinematography, editing, motion-design, brand, looks, templates and launch. They are cross-linked in front-matter and in Related Skills.
  - The stale "editorial skill when it ships" line is fixed.
  - The registry (`VELORA_SKILL_NAMES`, `check-skills.mjs`) and `skills-lock.json` hashes are updated; there are now 22 skills.
- **`velora-ewmotion` decision: kept.** It is an honest deferral notice with no claimed commands. Removing it would leave stale copies in users' installed skill directories, and the router gives it one line.
- **07.4 Guide v3:**
  - `AuthoringGuideSchema.version` is 3, with new concepts `templates`, `shot-vocabulary`, `lens`, `editing-rhythm` and `brand-and-looks`.
  - `creativeFreedom` adds "Templates are starting points; vary shot families across scenes; user direction overrides."
  - Capabilities gain pointers (`prompts`, `editorial`, `brandAndLooks`, `presets`) rather than embedded catalogs.
  - VELORA.md records format 3 and lists the featured prompts.
  - `init` upgrades format-2 handoffs (any package name; Vite and portable hosts) and still refuses edited files.
- **07.5 Prompt library** (`src/core/prompts.ts`: `PromptSchema`, `PROMPT_LIBRARY`, `findPrompt`, `promptPlaceholders`, `fillPrompt`, `scaffoldPrompt`):
  - Prompts: `launch-film`, `feature-announcement`, `website-hero-loop`, `vertical-teaser`, `dashboard-cinematic`, `changelog-video`, `product-hunt-assets`, `first-scene`.
  - New command `velora prompts ls|show --id ID [--json]` with `ERR_PROMPT_NOT_FOUND`.
  - The studio's Getting started panel has a goal picker over the library, and the ParamPanel "Copy agent prompt" uses `scaffoldPrompt`: one source of truth.
- **07.6 Agent demos C, D and E** (`tests/agent/demo-{c,d,e}`): host, prompt, skill trace, transcript, issue-fix log, expected hashes, compact manifests and evidence PNGs. `check-agent-demos.mjs` replays all five demos and asserts that replayed steps cover the director commands (prompts, templates, new scene and video, review, captions, compose snap).
  - **C:** launch film from `launch-film-30s` (Claude Code).
  - **D:** website hero loop from `/`, using `float-loop` with the `scroll-through` alternative; WebM, MP4 and poster delivered (Codex-style agent).
  - **E:** 9:16 TikTok teaser with karaoke captions and beat-snapped cuts (any agent).
- **07.7 Skill evals:**
  - `tests/cli/skills-content.test.ts`: every router row resolves to registered skills, at most four; every skill is reachable from the router; both workflow docs cover brief → deliver; front-matter commands exist; Craft Notes are present and not phrased as endorsements; the REFERENCE flag matrix and error catalog match `CLI_COMMANDS` and `CLI_ERROR_CATALOG`.
  - `tests/core/prompts.test.ts`: templates, skills, commands, flags and presets in each prompt are real; CLI envelopes.
  - `tests/core/authoring.test.ts`: v3.
  - `tests/project/*`: handoff upgrades.

## Product bugs the demos found (fixed)

1. **`velora validate --composition` skipped the timeline gate.** An overlap that differed from its transition passed validation and only failed at render. `resolveCompositionSpec` now runs `validateTimeline`, and the demo C draft step expects `ERR_TIMELINE_OVERLAP`.
2. **`social-teaser-9x16` end card was too short to read** (2.6 s against 3.1 s of copy). It now holds 3.2 s, and a regression test requires every Wave 3 blueprint to review clean on its target platform.
3. **Review pacing put LinkedIn and X landscape at TikTok's 4 s maximum.** A new `feed` class (1–7 s) covers x-landscape, x-square, linkedin and instagram-feed-4x5; vertical short-form keeps 0.8–4 s.
4. **Capture failed when a busy dev server never went network-idle** (route-frame scenes, several workers). `networkidle` is now a best-effort 15 s settle. Readiness stays with the capture bridge: `seek` awaits RouteFrame load, fonts, decoded images and video seeks.

## Live evidence (scratch hosts, installed tarball, 2026-11-03)

| Demo | Result |
|---|---|
| C | 120 BPM at confidence 0.988, cuts snapped, review clean. Draft: 895 frames at 1920×1080 in 1140 s, −13.98 LUFS, four transition SFX. `check --video` passes (A/V drift 0 ms, flash ≤ 1 per second, 4/4 caption windows). |
| D | `review --platform website-hero` clean. WebM (VP9): 608,573 bytes, inside the 4 MB budget, no warnings. MP4 fallback: 936,971 bytes. Poster at frame 0 (the loop seam). Both checks pass. |
| E | 120 BPM at confidence 0.981, cuts snapped, `review --platform tiktok` clean with the fixed blueprint. Draft: 295 frames at 1080×1920 in 424 s, −13.99 LUFS. Check passes. |

Hashes are in each `expected-hashes.json`; the videos themselves are git-ignored. Offline gap-frame determinism is replayed by the gate: 320×180 is `2bffac96…`, 180×320 is `06fad442…`.

## Verification

| Gate | Result |
|---|---|
| build, typecheck, lint:architecture | pass |
| test:architecture | 147 pass |
| test:core | 713 pass (prompts, guide v3, feed pacing) |
| test:react | 71 pass |
| test:launch | 505 pass (router coverage, Craft Notes, REFERENCE sync, parser execution of every skill/README/USER_GUIDE command, blueprint review-clean, handoff upgrades) |
| test:export | 330 pass |
| test:browser | 10 pass |
| test:release | 41 pass |
| test:skills | 22 skills green |
| test:installed | pass (guide v3 asserted) |
| test:agent-demos | 5 transcripts replay; gap determinism holds; director-command coverage |

`test:agent-demos` also exposed two expectation updates. Demo A's recorded draft step now expects `ERR_TIMELINE_OVERLAP`, from the stricter validate (noted in its issue-fix log). `check-installed` now asserts guide version 3.

## Deviations and open items

- The demos stop at the draft and the human taste review, as the prompts instruct. Copy and brand tokens keep the blueprint defaults; each issue-fix log records this.
- `velora deliver` (one command for every platform) is still v2 Phase 8. Deliverables are produced per preset.
- `ADV_BANDING` appears on large dark gradients in all three drafts. It is accepted as advisory; the documented remedy is look grain or a 10-bit codec.
