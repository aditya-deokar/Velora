# Website hero loop (8 s)

One seamless float loop of the landing page for a website hero background.

## Story

Keep motion quieter than the copy above it. Export muted, looping and small; pair with a poster frame.

Structure: Hook, then Problem, Reveal, Proof and a call to action. Emotion and story come first; rhythm and eye-trace serve them.

## Shot list (8.0 s)

| # | Time | Section | Template | Into this shot |
|---|---|---|---|---|
| 1 | 0.0-8.0 s |  | float-loop | cut |

## Next

1. Rewrite the copy (`--set` params in each scene's recipe `template.params`, or the bindings) and `hero.captions.srt` (none in this blueprint).
2. Add licensed music to `assets/`, reference it in `hero.composition.json` (`assets` + `audio` with `"kind": "music"`), then: `velora audio beats --composition hero.composition.json --write-markers --json` and `velora compose snap --composition hero.composition.json --to beats --json` (add `--write` to apply).
3. `velora review --composition hero.composition.json --json`, then `velora frames --composition hero.composition.json --out hero-board --every 30 --contact-sheet --json`.
4. `velora render --composition hero.composition.json --out hero.mp4 --quality draft --json`; the master: `--quality master`.
