# Demo B — Issue-Fix Log (all detected by real CLI runs)

## 1. Advisory `camera-travel-missing` (kept intentionally)

`velora validate --composition determinism.composition.json --json` passes
with one advisory: surfaces move but the camera has no translational travel.
The agent kept the stationary camera intentionally — camera motion would add
variance to a determinism isolation demo — and recorded the reason instead of
changing the shot.

## 2. `ERR_VISUAL_BLANK` — dim stage content

The first full render's `velora check --video run1.mp4 --manifest
run1.manifest.json --json` reported 11 blank samples: the stage leaves were
100px outlines with small glyphs, so whole-frame mean and variance stayed
under the blank floor. The agent brightened the leaf backing paint (solid
light surfaces, large glyphs), kept the time-disciplined canvas leaf, and
re-rendered from scratch. Re-check → 13 sampled frames non-blank with gaps
excluded, all suites green.

## 3. Determinism proven, not assumed

`run1.mp4` (cached render) and `run2.mp4` (fresh `--no-cache` capture of all
75 frames) were diffed with `node skills/velora/scripts/compare-renders.mjs`:

```
Renders identical: 75 frames share SHAs.
```

Seed 42 plus identical composition bytes reproduce identical pixels across
independent captures.
