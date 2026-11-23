# Phase 14 validation

## Chromium focus strategy

A solid edge and two stacked transparent surfaces exercised two backdrop veils. The far layer used 4 px and 3 px contributions, which compose to 5 px. At yaw 0° and ±30°, the maximum sigma difference from a per-layer CSS blur reference was 0.13 px. The foreground edge matched the unfiltered reference in all three poses. The runtime uses veils behind the focal plane and reversible filters on eligible front branches. Unsupported or incompatible geometry uses terminal-layer filters and reports `dof-approximate`.

The 200 mm rack browser fixture used the physical `laptop-14` pixel density and f/1.4. Focus exchanged between the modal and chart, both sharp ends measured under half a pixel, and the chart's projected width changed by 1.8%. Pixel variance reversed in the expected direction and repeat capture matched preview bytes. The iframe mask selected the expected bands at both ends and the rendered iframe showed the same swap in sharpness. Forced fallback emitted its advisory.

## Lens and authoring

The core tests compare fixed-eye zoom projection against its inverse screen ray and raster budget. They also verify synchronized rack keys, additive breathing, exact undo, and the 200 mm override on 4:5 and 9:16 templates. Chromium kept the off-axis subject width within 1% and measured convergence above 3° at 24 mm and below 0.3° at 200 mm. The legacy `lensFor` contract, recorded shots and seven capture goldens matched.

The live CLI test applied the physical telephoto preset, inspected the two projected layers, resolved a rack through their selectors and wrote the generated focus clip. Its dry run left the recipe byte-identical.

The generated recipe schema exposes zoom, the widened lens ranges and rack provenance. The packed artifact passed release validation. The built CLI certified all 30 templates and validated the skill library.

## Repository checks

`npm run verify:ci` passed packaging, type checking, 910 core tests, 156 React tests, all 64 browser tests, recipes, skills, installed-package smoke tests, the scene library, and iteration. The architecture fixtures and CLI reference were updated after failures in that run. All 178 architecture checks passed on rerun. A serial launch rerun passed 602 of 603 tests, including the four initial failures. All three preview loop tests passed in isolation after the timing failure under load.

The export rerun passed 384 tests with one existing skip. CLI surface coordinates resolved offline use the authored frame or fitted stage dimensions. Named depth layers use live measurements.

The resumed gates passed installed agent authoring, demo replay, Next Pages Router, standalone React 18, any-site Studio and video deliverables, and the release suite and artifact check. The Next App Router fixture passed install, Studio editing, snapshot, MP4 export, source editing, and the production build in isolation with its subprocess timeout raised from 110 to 240 seconds. No single aggregate run was green. Every behavior gate passed across the original run and the reruns.
