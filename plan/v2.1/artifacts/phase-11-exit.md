# Phase 11 status · Agent parity, quality gates and release

Date 2026-11-21

## Implemented

- Ask agent is available from the scene and composition toolbars, command palettes and timeline context menus. Its clipboard prompt carries the active target, cursor, selection, applicable time range, recent edits, revision and the user's intent. History and read-only editing can copy commands with JSON on stdin for PowerShell or a POSIX shell. Native-shell tests feed those commands into the actual CLI and verify the write.
- The parity test enumerates the runtime edit schema, supplies a valid example for each available op, checks its documented CLI entry point and description, and requires every editor command to declare its op families or its UI-only effect. The CLI contract test records the command and flag catalog and JSON envelope fields from the repository's 1.0 hardening commit, `2b3a269`. It runs the old help commands and checks representative defaults and result shapes.
- Guide and generated project handoff use format 4. Vite and portable init upgrade byte-identical format 2 and 3 handoffs, including those generated with a custom package name. Locally edited copies are preserved and reported. The skills, product docs and Studio showcase cover the implemented scene and composition workflows.
- Chromium tests audit editor panels with axe and exercise keying, easing and grouping with the keyboard alone. The viewport retains its pointer-focused director shortcut. Timeline keys have a tab stop when visible, and graph handles expose numeric values to assistive technology. Axe is an MPL-2.0 development dependency and is excluded from the runtime package.

## Performance measurements

Full Chromium on Windows, Intel Core i3-1220P and Intel UHD Graphics, driver 32.0.101.7088. The performance config now discovers its own test suite. The 300-track fixture independently animates five properties on each of 60 surfaces. Registry layout reads share common ancestors within each synchronous measurement.

| Check | Measured | Gate |
|---|---:|---|
| Scrub, 60 surfaces and 300 tracks | 59.9 fps median | Pass at ≥55 fps |
| Editor chunk request to dope sheet mounted | 469 ms | Pass at ≤1,000 ms |
| Scroll, zoom and drag on 200 rows × 1,000 keys | 0 long tasks in each sampled interval | Pass at ≤50 ms |
| Viewport move gizmo drag | 32.3 ms p95 | Open at ≤16 ms |
| Five-curve graph redraw | 152.3 ms p95 | Open |
| Camera playback with progressive focus | 60.0 fps mean, 16.9 ms p95 | Pass |
| Focus playback with progressive focus | 31.1 fps mean, 50.2 ms p95 | Open |
| Vite source save to visible change | 61 ms | Pass at ≤300 ms |
| Next App Router and Pages Router recipe save to visible change | 44 ms and 95 ms | Pass at ≤1,000 ms |

The Windows installed-host runs passed with Vite React 19, Next App Router React 19, Next Pages Router React 18 and any-site mode. Next verified a saved keyframe, clipboard handoff and production exclusion. The App Router also verified a reviewed source edit and live export. Any-site mode opened the edit bridge, copied a scene prompt, rendered and checked a 228-frame route composition, and generated the requested delivery assets.

Windows ran out of disk space while writing the portable React 18 esbuild bundle, after installation and TypeScript compilation. The fixture now serves the bundle from memory. Its browser check still needs a complete run.

The initial package check measured 5,726,741 unpacked bytes. Its largest file was the 1,012,666-byte CLI, and the package contained no axe code. The recipe, motion, spatial, optics, shot and Chromium capture goldens and the formatter corpus passed. The root skill catalog validated all 23 installed skills, and the docs site built.

The documentation check validates command names, flags and JSON examples. The shell, editor, installed host and export tests exercise representative examples. Exhaustive execution of every documented command remains open.

The targeted Chromium checks passed across isolated runs. They cover the scene and composition accessibility audits, keyboard-only keying, easing and grouping, clipboard handoff, source promotion, channel exposure, the 30-second recut and real CLI-frame comparison. The 152 React and editor tests, 16 bridge security and recovery tests, and 116 project migration and documentation tests passed.

## Release status

The 1.1.0 release is gated on the open performance budgets, complete local and CI verification, and an explicit decision about cinematic Phases 12–16. Those phases have no exit reports or approved descoping. Worker startup, memory allocation and disk exhaustion prevented a clean full Windows verification run. Linux and macOS CI results remain pending. The changelog records the changes under Unreleased, and the package remains at 0.1.2.
