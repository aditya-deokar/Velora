# Demo E — Skill-Load Trace (in order)

1. `velora` (root): "vertical teaser" → `velora-launch` → `velora-templates` → `velora-editing` →
   `velora-looks` (four skills; `velora-looks` was read but the default clean look was kept).
2. `velora-launch`: `velora prompts show --id vertical-teaser`; vertical short-form pacing (0.8-4 s),
   muted-first hook, safe zones, `tiktok` preset.
3. `velora-init`: `velora init --json`.
4. `velora-templates`: `new video --blueprint social-teaser-9x16 --aspect 9:16`.
5. `velora-debug`: `validate --composition teaser.composition.json`.
6. `velora-audio`: `captions validate` and `captions check` (karaoke style, clear of the bottom fifth).
7. `velora-editing`: `review --platform tiktok`; `compose snap` before beats (ERR_MARKERS_MISSING,
   the expected next step), `audio beats --write-markers`, `compose snap --write`.
8. `velora-render`: `frames --contact-sheet --columns 5` storyboard.
9. `velora-verify`: `check --frames` on the gap stills and `check --video` on the draft.
