# Phase 12 validation

Validated on Windows with Chromium and FFmpeg on 2026-11-21.

## App stage and capture

- The `hero-push` CLI scaffold with `--stage laptop-14` laid out its route at 1512 × 982 CSS pixels in both Studio and export. The 1500px media query matched in both, and the button rectangle stayed within 0.5 CSS px on all four values.
- `velora export --quality standard --width 1920 --height 1080` captured the route at DPR 2. The chart's 146 CSS px canvas used a 292 px backing store, and `ffprobe` reported a 1920 × 1080 video.
- The test camera moved from 0.25× to 1× projection, a 4× increase. `velora inspect` found raster demand within budget, and the final still matched the SHA of the explicit DPR-2 reference. An explicit DPR 1.25 still also came out at 1920 × 1080.
- A 3840 × 2160 composition frame recorded `effectiveDpr: 1`, `dprCapped: true` and a failing `stage-dpr` check for the requested 2× capture.
- The native stage control copied the exact CLI command in read-only Studio. With the bridge connected it stored the measured viewport and one undo restored the recipe byte for byte after Vite reloaded. Chromium capture pages omitted the control.
- Template certification exercised 30 templates across every supported aspect and intensity with `laptop-13`, `laptop-14`, `desktop-1080` and the existing stage-less framing. The dramatic survey retains its original minimum camera distance when fitted to a shallower stage.

## S7 capture cost

The 1080p Chromium spike averaged five PNG screenshots after warmup at each DPR. A same-origin iframe stayed at 1512 × 982 at both scales.

| Browser DPR | 100 CSS px canvas backing width | Mean screenshot time |
|---|---:|---:|
| 1 | 100 px | 92 ms |
| 2 | 200 px | 366 ms |

This sample measures PNG capture time. End-to-end render cost also includes sampling, linear-light downscaling and encoding. The sharpness check covers a raster chart in a RouteFrame. The authoring and inspector budgets estimate demand from the authored scene and projected focus, since those checks run without DOM measurements.

## Regression checks

- `node scripts/golden.mjs --capture` matched 23 core comparisons and seven Chromium frame hashes. The golden files are unchanged.
- The full Chromium suite passed all 56 tests, including both Phase 12 runs. Project and preview verification passed 603 tests, and the export suite passed 384 tests with one skipped.
- The focused stage, templates, quick-shot, schema and React suites passed 343 tests. The architecture suite passed all 177 fixtures after adding the stage owners to its canonical-source fixtures.
- The CLI guide, skills and generated recipe JSON Schema include the additive stage contract. Both `npm run test:skills` and the packaged `velora skills check --json` validated all 23 skills.
- The rebuilt local package passed all 43 release tests and the artifact budget check. It remained at 0.1.2 and measured about 5.8 MB unpacked.
- The installed package and the agent workflow passed. The library smoke test passed after replacing the stale ten-scene expectation with the fixture catalog count. The iteration test passed with bounded retries for Windows rename locks and time for the Vite WebSocket to disconnect. It measured 83 ms from a metadata save to a visible update.
- The Next.js App Router, Next.js Pages Router and standalone React 18 fixtures passed. The React 18 rerun verifies clipboard handoff inside the Ask agent dialog, where the prompt is distinct from the read-only toolbar action.
- The any-site rerun exported and verified all 228 frames of its three-route composition, then produced the OG image, README GIF and website hero deliverables. The manifest recorded a 960 × 540 output and a 1512 × 982 stage at effective DPR 2. Capture now attempts network idle once per browser session. The bridge still settles the route at every seek, so a continuously busy route no longer spends 15 seconds waiting on every frame.

The initial `npm run verify:ci` reported failures in architecture, the library smoke test, iteration, React 18 and any-site capture. Each passed on its targeted rerun after the corresponding fix. The export suite and all nine stage and capture-golden browser tests also passed again after the capture startup change.
