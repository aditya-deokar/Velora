# SaaS Product Tour (example)

Prompt: tour a SaaS dashboard in three acts — camera survey, feature plating
with a slide-push entrance, closing title — with captions throughout.

Skills: `velora` → `velora-composition` → `velora-scenes` →
`velora-transitions` → `velora-audio` → `velora-render` → `velora-verify`.

```bash
velora scenes --json
velora validate --composition tour.composition.json --json
velora inspect --composition tour.composition.json --json
velora captions check --composition tour.composition.json --json
velora frames --composition tour.composition.json --out stills --at 1600,1800 --json
velora check --frames stills --json
```

Copy this directory's `src/velora/scenes/*` into a Velora host, keep the
composition at the project root, and run the commands above. Gap frames at
1600ms and 1800ms render black void offline; the recorded 320x200 void SHA is
`12584dd631965ce24404c87f727f96bc1a9e484115e30f355563c8e425ff3851`.
