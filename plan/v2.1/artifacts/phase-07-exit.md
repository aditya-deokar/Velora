# Phase 07 exit report · Groups, presets and motion design

Date: 2026-11-21. Branch `feat/v2.1-motion-graphics-suite-plan`.

## Implementation

| Task | Result |
|---|---|
| 07.1 Group and ungroup | Ctrl/⌘+G moves selected root tracks into a clip at their first key. The Clip Inspector edits ease, speed, play count, and blend mode. Ungrouping uses exact keyframe time transforms when possible. The bake dialog reports maximum sampled deviation at 30 Hz before it commits. |
| 07.2 Stagger | The tool builds a clip from the first layer's tracks, a behavior, or a compatible project preset. It supports forward, reverse, center-out, edges-in, and seeded random order. The timeline handle previews changes to `eachMs` and writes one operation on release. |
| 07.3 Timing | The editor sequences root layer tracks with millisecond or percentage overlap, and aligns, distributes, reverses, or stretches selected keys. `keys.retime` moves keys atomically when their destinations differ. |
| 07.4 Behaviors | The catalog emits editable clips. Updating parameters regenerates the selected behavior in a single undo step. Direct edits to generated tracks clear the source and display a notice. |
| 07.5 Camera moves | The editor builds all twelve `SHOT_KINDS` using the selected layer. The verdict samples the proposed recipe against the live layer geometry and reports visibility, depth margin, and blur. |
| 07.6 Presets | The browser, edit bridge, and CLI share `PresetSchema`. Motion presets can contain tracks and nested clips. Relative values use the destination pose. The easing library reads project curves, and the studio saves a selected curve, motion, or parameterized behavior. |
| 07.7 Kit | `TextAnimator`, `DrawPath`, and `Shape` read keyframeable values on the scene clock. Text selectors use `<id>.selector.*`. Typewriter and reveal behaviors use `<id>.chars` and `<id>.reveal.progress`. The editor reports when a scene is shorter than its text's minimum reading time. |

## Scope and limits

- Grouping selected keys moves their complete root tracks, since a property has one replace owner. Sequence operates on root tracks.
- Nonlinear bakes handle numeric replace clips. Additive, style, and color bakes are refused because the root tracks cannot preserve those results with the current sampler.
- The stagger tool uses layer-track presets as templates. Retimed or nested motion presets can be applied from the preset browser.
- The reading-time advisory checks the scene's total duration. It is a lower-bound check for short scenes. A visual review can assess the readable interval when the text is animated.
- Camera moves certify the measured layer in the current scene. Element targets and physical rigs arrive in the later phases listed in the roadmap.

## Verification

- The package build emitted all four JSON Schemas. The skills checker passed all 23 skills.
- The core suite and grouping tests passed 871 tests. A serial run of the React, editor, project, CLI, and composition video tests passed 265 tests.
- The full Playwright suite passed all 42 tests, including the seven capture goldens and six Phase 07 journeys. The new journeys cover three-layer grouping, easing and retiming, undo, the five-card stagger drag, relative preset reuse across two scenes, behavior regeneration, matching orbit preview and capture frames, and exact text and stroke pixel endpoints.
- `node scripts/golden.mjs` matched all 23 Phase 00 core goldens.
- The composition export test now checks seek times per capture session because a scene and its overlay share a URL and their parallel calls can interleave.
- `npm run verify:ci` passed package preparation, type checking, core, React, architecture, and recipe validation on reruns. With `VITEST_MAX_WORKERS=2`, the aggregate gate still hit 5-second project fixture and 30-second live MP4 timeouts on Windows.
- The four project and export files associated with the timeouts and seek assertion passed all 121 tests when run sequentially with `--fileParallelism=false`.
