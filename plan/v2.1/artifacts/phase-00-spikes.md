# Phase 00 spikes (S1–S8): verdicts

Date: 2026-11-14. Branch `feat/v2.1-motion-graphics-suite-plan`, starting commit `88d8b7a`.
Reference machine: Windows 11 (win32-x64), Node 24.12.0, Playwright 1.58.2 with Chromium build 1208 only
(Firefox and WebKit are not installed).

The plan time-boxes the spikes at 18 working days in total. The initial pass ran only the spike that fit inside
the Phase 00/01 session (S5, partly). The table records later verdicts as each spike is run. None of S1–S4 or S6–S8
blocks Phase 01, which needs no editor UI, bridge, 3D or depth work. Each one does block the phase noted
below, and must be run before that phase starts.

| Spike | Status | Verdict | Blocks |
|---|---|---|---|
| S1 Timeline rendering | Not run | No verdict. D6 stays at its recommendation (build in house) until S1 runs. | 05 (and 10) |
| S2 Bridge transport | Not run | No verdict. Only Chromium is installed here, so the Firefox/WebKit gate cannot pass on this machine yet. | 03 |
| S3 Deterministic R3F | Passed 2026-11-21 | R3F 9.8.2 accepts absolute seconds on its manual root. A Suspense-loaded glTF reproduced the same Chromium pixels after a backward seek. | 09 |
| S4 Click-to-source | Not run | No verdict. | 08 |
| S5 Lazy editor chunk | **Partly run** | Chunk emission **passes**; installed-host exclusion is **not yet verified**. | 04 |
| S6 Volumetric depth in live DOM | Phase 13 depth gate passed, 2026-11-21 | Chromium sorted lifted cards above proxy planes at ±30°. Same-time screenshots matched. Forty-eight layers scrubbed at 59.9 fps median. | 13, 14 |
| S7 Stage DPR and sharpness | Passed in Chromium, 2026-11-21 | CSS viewport stayed fixed at 1512×982. DPR 2 doubled the chart backing width and took about 4× the screenshot time at 1080p. | 12 |
| S8 Projected parallax in iframes | Phase 13 projection gate passed, 2026-11-21 | Same-origin centers met the 50 mm and 200 mm positional tolerances. Teardown restored inline style attributes byte for byte. The packaged CLI froze and captured depth through the any-site proxy with matching layer hashes. | 13 |

## S3 Deterministic R3F

Chromium 1208 with SwiftShader, React 19.2.0, Three.js 0.187.0 and R3F 9.8.2. A 400 × 300 canvas rendered a glTF triangle after its Suspense boundary resolved. Each layout commit called the root's `advance(seconds, false)` once. A frame subscriber observed the absolute times 0, 0.25, 0.75, 0.25 in that order. The two 0.25-second PNGs had SHA-256 `9edf1b0b522ba4932abe367d81306cd5005a8d135dc20a607fe0fd12e6268adf`. The 0.75-second PNG differed. With a single 20-frame, display-paced run, the observed means were 18.78 ms with drawing-buffer preservation and 16.55 ms without it. That timing includes browser pacing and is a smoke measurement. R3F's installed peer range is React and React DOM 19.0 through 19.3.

## S5: lazy editor chunk (partly run)

Setup (scratch worktree of `88d8b7a`, never committed): `src/editor/Probe.tsx` exporting a component with a
unique marker string; `src/preview/EditMode.tsx` containing only
`export const loadEditor = () => import("../editor/Probe")`, re-exported from `src/preview/index.tsx`.
Built with the unchanged `vite.lib.config.ts` (ES lib mode, entries `index`, `preview`, `kit`).

Results:
- Vite emitted the editor as its own chunk, `dist/library/Probe-<hash>.js` (0.26 kB). The marker string
  appeared **only** in that chunk; `index.js`, `preview.js`, `kit.js` and the shared chunks did not contain it.
- `preview.js` references it only through `() => import("./Probe-<hash>.js")`.
- The chunk sits under `dist/library`, which `package.json` `files` already ships, so no `files` change is needed.

Still to verify before Phase 04: extend `scripts/check-installed.mjs` so the editor chunk is absent from the
production assets of installed Vite, Next and esbuild hosts, the dev studio loads it on demand, and the
package budget still passes.

The architecture checker now enforces the import side of this design (Phase 00.5): only a dynamic
`import()` from `src/preview/EditMode.tsx` may reach `src/editor` (rule `editor-lazy-boundary`).

## S7 Stage DPR and capture cost

On the Windows reference machine, full Chromium used a 1920×1080 capture viewport. A same-origin iframe reported 1512×982 at both device scales. A 100 CSS px canvas used 100 backing pixels at DPR 1 and 200 at DPR 2. Five PNG screenshots after warmup averaged 92 ms at 1× and 366 ms at 2×. This isolates browser screenshot cost and excludes downscaling, encoding and network activity.
