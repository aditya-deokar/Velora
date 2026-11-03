# Demo D — Skill-Load Trace (in order)

1. `velora` (root): "website hero loop" → `velora-launch` → `velora-templates` → `velora-export`.
2. `velora-launch`: `velora prompts show --id website-hero-loop`; website hero practice (8-15 s, calm,
   seamless, WebM + MP4 + poster, size budget, reduced-motion embed).
3. `velora-init`: `velora init --json`.
4. `velora-templates`: `templates show --id float-loop`, `new scene --template float-loop --id hero`,
   `new scene --template scroll-through --id tour` (the long-page alternative), `templates check`.
5. `velora-debug`: `validate --composition hero.composition.json` (an 8 s single-shot loop).
6. `velora-launch`: `review --platform website-hero` (pacing and loop seam: no advisories).
7. `velora-render`: `shot` stills at 0 and 4000 ms (first frame equals the loop seam).
8. `velora-export` (via `velora-launch` deliverables): `render --preset website-hero --poster 0` for the
   WebM, then `--codec h264` for the MP4 fallback.
9. `velora-verify`: `check --video` on both files.
