# Phase 00 spikes (S1–S8): verdicts

Date: 2026-11-14. Branch `feat/v2.1-motion-graphics-suite-plan`, starting commit `88d8b7a`.
Reference machine: Windows 11 (win32-x64), Node 24.12.0, Playwright 1.58.2 with Chromium build 1208 only
(Firefox and WebKit are not installed).

The plan time-boxes the spikes at 18 working days in total. This pass ran only the spike that fit inside
the Phase 00/01 session (S5, partly). Every other spike is **not run**, not passed. None of S1–S4 or S6–S8
blocks Phase 01, which needs no editor UI, bridge, 3D or depth work. Each one does block the phase noted
below, and must be run before that phase starts.

| Spike | Status | Verdict | Blocks |
|---|---|---|---|
| S1 Timeline rendering | Not run | No verdict. D6 stays at its recommendation (build in house) until S1 runs. | 05 (and 10) |
| S2 Bridge transport | Not run | No verdict. Only Chromium is installed here, so the Firefox/WebKit gate cannot pass on this machine yet. | 03 |
| S3 Deterministic R3F | Not run | No verdict. `three` and `@react-three/fiber` are not dependencies; installing them is a Phase 09 layer decision. | 09 |
| S4 Click-to-source | Not run | No verdict. | 08 |
| S5 Lazy editor chunk | **Partly run** | Chunk emission **passes**; installed-host exclusion is **not yet verified**. | 04 |
| S6 Volumetric depth in live DOM | Not run | No verdict. The band-quantized fallback (14.4) stays the contingency. | 13, 14 |
| S7 Stage DPR and sharpness | Not run | No verdict. D10's numbers are still open. | 12 |
| S8 Projected parallax in iframes | Not run | No verdict. | 13 |

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
