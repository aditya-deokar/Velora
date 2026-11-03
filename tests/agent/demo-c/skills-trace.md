# Demo C — Skill-Load Trace (in order)

1. `velora` (root): the intent router matched "launch film" and named the chain
   `velora-launch` → `velora-templates` → `velora-editing` → `velora-render` (four skills).
2. `velora-launch`: `velora prompts show --id launch-film`, the brief, Hook/Problem/Reveal/Proof/CTA,
   YouTube pacing; `velora templates ls --category blueprint`.
3. `velora-init`: `velora init --json` (not in the chain; loaded because doctor/inspect needed setup).
4. `velora-templates`: `velora new video --blueprint launch-film-30s --id launch --route /`.
5. `velora-composition` / `velora-debug`: `inspect` and `validate` of the scaffolded composition and of
   the agent's first draft (overlap mistake, see issue-fix-log.md).
6. `velora-editing`: `transitions ls`, `review --platform youtube-1080p`, `audio beats --write-markers`,
   `compose snap` (dry run, then `--write`).
7. `velora-audio`: `captions check` for the karaoke skeleton.
8. `velora-render`: `frames --contact-sheet` storyboard.
9. `velora-verify`: `check --frames` on the gap stills and `check --video` on the draft.
