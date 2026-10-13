# Kinetic Title Explainer (example)

Prompt: explain one idea in three staggered words, replayed across two
segments joined by a cascade handoff, with captions.

Skills: `velora` → `velora-typography` → `velora-composition` →
`velora-transitions` → `velora-render` → `velora-verify`.

```bash
velora validate --composition explainer.composition.json --json
velora captions check --composition explainer.composition.json --json
velora frames --composition explainer.composition.json --out stills --at 1600,1800 --json
velora check --frames stills --json
```

Word-cascade pattern: one `Surface` per word, staggered opacity tracks. Gap
frames at 1600ms and 1800ms render black void offline; the recorded 320x200
void SHA is `12584dd631965ce24404c87f727f96bc1a9e484115e30f355563c8e425ff3851`.
