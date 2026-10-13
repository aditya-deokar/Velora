# Dashboard Data Story (example)

Prompt: tell a quarterly growth story with seeded staggered bars across two
segments joined by a focus pull, with captions.

Skills: `velora` → `velora-scenes` → `velora-transitions` →
`velora-composition` → `velora-render` → `velora-verify`.

```bash
velora validate --composition story.composition.json --json
velora captions check --composition story.composition.json --json
velora frames --composition story.composition.json --out stills --at 1600,1800 --json
velora check --frames stills --json
```

Seed 99 is recorded in `story.composition.json`; the bar stagger is fixed, so
re-renders reproduce identical frames. Gap frames at 1600ms and 1800ms render
black void offline; the recorded 320x200 void SHA is
`12584dd631965ce24404c87f727f96bc1a9e484115e30f355563c8e425ff3851`.
