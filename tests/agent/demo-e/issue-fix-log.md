# Demo E — Issue-Fix Log (all detected by real CLI runs, 2026-11-03)

## 1. The shipped blueprint's end card was too short to read (product bug, fixed)

The first scaffold of `social-teaser-9x16`, reviewed with `velora review --platform tiktok`, reported
`ADV_READING_TIME`: shot-4 shows copy that needs about 3100 ms but is on screen 2600 ms
(`evidence-review-old-blueprint.json`). The defect was in Velora's blueprint, not the agent's work.
The end card now holds 3200 ms, and a regression test scaffolds every Wave 3 blueprint and requires
a clean review on its target platform. Writing that test also exposed the review pacing table: it
treated LinkedIn and X landscape like TikTok (4 s maximum shot). Feed placements now have their own
1-7 s window.

## 2. Snapping before beat detection

`velora compose snap --to beats` without markers failed with `ERR_MARKERS_MISSING` and named the next
command. After `velora audio beats --write-markers` (120 BPM, confidence 0.981, 22 markers), the
default tolerance left shot-3 and shot-4 unsnapped. `--tolerance 260 --write` placed every cut on a
beat; review was then clean.

## 3. Storyboard capture timeout

The first `frames --contact-sheet` run failed with the dev-server `networkidle` timeout described in
demo D's log (same fix). After the fix it completed in 28 s. The draft render had already succeeded
on the first pass (295 frames, 1080x1920, 424 s); the re-run correctly refused to overwrite it
(`output-exists`).

## 4. Video checks and taste notes

`velora check --video`: streams, manifest, no blank frames, the caption window covered, flash safety
0 per second, A/V drift 0 ms; loudness -13.99 LUFS. `ADV_BANDING` on the backdrop gradient was
accepted. Taste notes for the person: the fixture app is short, so the 9:16 UI shot leaves the lower
half of the plane empty; the end card shows the package name until `velora.brand.json` is filled in.
