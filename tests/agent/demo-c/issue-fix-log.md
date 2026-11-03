# Demo C — Issue-Fix Log (all detected by real CLI runs, 2026-11-03)

## 1. A bad overlap passed `validate` (product bug, fixed)

The agent's first draft started `shot-2` at 3000 ms. Its whip lasts 400 ms, so the overlap (500 ms) did
not match the transition. `velora validate --composition` returned success, because it never ran the
timeline gate; only `render` would have rejected the file, after capture had started. Fixed in
`resolveCompositionSpec`: validate now runs `validateTimeline`, and the replayed draft step expects
`ERR_TIMELINE_OVERLAP` ("Segment "shot-2" overlaps "shot-1" by 500ms but its whip lasts 400ms. Start
it at 3100ms."). The agent moved the cut back to 3100 ms.

## 2. Two cuts off the beat

With the 120 BPM bed in `assets/music.wav`, `velora audio beats --write-markers` found 120 BPM at
confidence 0.988 (62 markers). `velora review` reported `ADV_OFFBEAT_CUT` on `shot-5` and `shot-6`
(170 ms off). The default snap (`--tolerance 120`) left them unsnapped, which the dry run said
explicitly. A second pass with `--tolerance 260 --write` moved them; review then reported no
advisories (`evidence-review-before.json`, `evidence-review-after.json`).

## 3. Draft render and video checks

`render --quality draft`: 895 frames, 1920x1080 at 30 fps, 1140 s on this machine (layered captions on
every frame). Loudness was normalized to -13.98 LUFS / -1.0 dBTP, with four transition SFX at the
cuts. `velora check --video` passed: streams, manifest, no blank frames, all four caption windows
covered, flash safety (at most 1 per second) and A/V drift 0 ms. One `ADV_BANDING` advisory on the
large gradient backdrops was accepted; a film look's grain is the documented remedy.

## 4. Left for the taste review (not automated)

The storyboard (`evidence-contact-sheet.png`) shows the blueprint's default copy and stats ("12k+",
"98%", "3x") and the package name as the brand. Rewriting copy and seeding `velora.brand.json` is
the agent's next step after this draft; the prompt says to wait for the person's review first.
