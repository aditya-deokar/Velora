# Demo B — Skill-Load Trace (in order)

1. `velora` (root): entry point; routed the determinism request to setup,
   scenes, transitions, render, debug, performance, and verify skills.
2. `velora-init`: `velora init --json` in the disposable host.
3. `velora-scenes`: `proc-stage` recipe (three staggered leaves) plus the
   time-disciplined `GlStage` leaf (pure function of `timeMs` plus seed).
4. `velora-threejs`: time-discipline rules for the canvas leaf; no
   `requestAnimationFrame`, no ticker; fallback content reasoning.
5. `velora-transitions`: `focus-pull` boundary on segment `s2`
   (`velora transitions describe --type focus-pull --json`).
6. `velora-render`: gap proofs, two full renders (second with `--no-cache`),
   manifest reading, `compare-renders.mjs` hash diff.
7. `velora-debug`: triaged the dim-content `ERR_VISUAL_BLANK` finding
   (see issue-fix-log.md) via sample inspection.
8. `velora-performance`: seed discipline and cache behavior (content-hash
   cache served identical seeks; `--no-cache` forced the honest re-capture).
9. `velora-verify`: `velora check --frames` and `velora check --video`
   gates with gap exclusion; recorded `requiresVisualReview: true`.
