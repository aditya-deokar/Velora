# Demo A — Skill-Load Trace (in order)

1. `velora` (root): entry point; routed the teaser request to setup, composition,
   scenes, render, audio, and verify skills via the routing table.
2. `velora-init`: `velora init --json` in the disposable host; `velora doctor`
   reasoning for prerequisites (Node, FFmpeg, Chromium).
3. `velora-composition`: authored `teaser.composition.json`; `velora inspect
   --composition` to review resolution and totals; `velora assets ls --json`.
4. `velora-scenes`: recipe plus TSX bindings (`teaser-a`, `teaser-b`),
   camera rail, `velora guide --json` for track shapes.
5. `velora-typography`: two-word kinetic title comiled as staggered opacity
   tracks (word-cascade pattern).
6. `velora-transitions`: entering-side transition on segment `s2`
   (`velora transitions describe --type depth-dolly --json`).
7. `velora-audio`: `velora audio check` and `velora captions check` for the
   narration track and the SRT file.
8. `velora-render`: `velora render --frame` gap proof, `velora frames --at`,
   full MP4 render, manifest reading, cache behavior.
9. `velora-debug`: triaged `ERR_CAPTION_TIMING` and the truncated-MP4 finding
   via `velora validate --json` and `velora check` diagnostics.
10. `velora-verify`: `velora check --frames` and `velora check --video`
    gates; recorded `requiresVisualReview: true` for handoff.
