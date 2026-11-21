# Phase 13 validation

Validated on Windows with full Chromium on 2026-11-21.

## Rendering and cleanup

- The in-tree dashboard orbit put the raised card center within 0.5 px of the spatial projection. Contact shadows, four side walls and sheen planes rendered alongside the original host. At the same camera time, the preview and two independent capture screenshots had identical bytes.
- The clipped control emitted `depth-flattened` and kept the host's `overflow: hidden`. Flattened regions use projected depth. Volumetric surfaces defer whole-leaf focus blur and emit `depth-focus-deferred` when it would otherwise apply.
- The same-origin RouteFrame dashboard matched the raised center within 1 px at 50 mm and 0.25 px at 200 mm through its orbit. An isolated ±30° Chromium probe measured less than 0.001 px of center error at perspectives 1450 and 6000. The in-tree and iframe fixtures restored their entire host markup, including inline styles and `!important` priorities, byte for byte.
- A staged route classified and froze its layers with `velora depth resolve`. The dry run left the source file intact. The saved layer hash appeared in both the still result and the composition frame manifest. Applying the inverse restored the original JSON bytes. Studio showed the layer tiers, refused capture while Depth view was active, and restored the iframe markup and removed its freeze stylesheet when Edit mode exited.
- The packaged CLI froze the card layers of a non-React pricing page through the any-site proxy. The captured still reported the same hash as the frozen recipe.
- All seven legacy capture frame hashes matched. The shipped recipe schema includes the optional depth map and surface `elevation`, and enforces the same 32-surface limit as the runtime.

## Performance

| Check | Measured | Target |
|---|---:|---:|
| Scrub with 48 volumetric layers | 59.9 fps median | ≥55 fps |
| Frame interval p95 | 33.3 ms | Evidence only |
| Synchronous commit median | 3.1 ms | Evidence only |
| Classification of 2,000 serialized nodes | 1.0 ms mean | ≤30 ms |

Moving a pre-rendered sheen gradient with transform and opacity brought the measured scrub from 20.1 to 59.9 fps. The classifier measurement starts after reading the browser layout snapshot.

The pose tests cover Phase 13 projection and sorting. Phase 14 owns per-layer optical filters and their separate visual comparisons.

## Package checks

The release artifact passed the size and contents checks. The built CLI certified 30 templates and validated 23 skills.

`npm run verify:ci` passed packaging, type checking, core, React, architecture, recipes and skills. The full run was stopped after Windows worker teardown errors and broad browser timeouts. Phase 13 browser scenarios and the motion and spatial goldens passed in isolated reruns.
