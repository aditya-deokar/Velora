# Phase 15 exit

D14 ships named element anchors and scoped CSS selectors. Surface and RouteFrame geometry stays live through layout, scrolling and depth changes. Recipes store the target reference, optional local point and optional face or base plane.

## Author a lock

```sh
velora anchors --scene home-hero --time 400 --json
velora edit lock --scene home-hero --look-at subject:revenue-card --focus-follow subject:revenue-card --write --json
velora edit lock --scene home-hero --frame subject:revenue-card --fill 0.6 --json
```

Studio shows the target at the playhead. Shift-click with the Focus tool adds focus follow. Alt-click an unnamed JSX element to review a proposed source anchor. The source edit is applied only after diff review.

Capture refreshes target measurements after the scene settles. If an active lock resolves to zero or multiple visible elements, capture returns `ERR_TARGET_MISSING` with the anchor inventory command. Live locked scene frames are sampled again on each render so a cache hit cannot hide a missing element.

## Verification

- Core coverage exercises target parsing, plane and elevation, frame fill, composition, evaluation order and live rack depth, including a rack between an anchor and a classified layer.
- React coverage checks transform-free placement with ancestor borders and scroll, and reports missing or duplicate targets.
- Browser coverage samples a 200 mm orbit and checks the one-pixel marker, focus blur, reflow and capture evidence. The RouteFrame case authors locks from CLI inventory and checks scroll, fixed and sticky placement, inventory read-only behavior, Studio reticles and geometry, and refusal at export.
- CLI and project coverage exercise the result envelope, lock dry runs and exact undo, focused templates, and guarded source anchor edits.

The Chromium orbit tests nine samples from 0 through 1000 ms. The exported 1 px marker stays within 0.5 CSS px of center and anchor blur stays below 0.5 px. A layout shift of 27 px updates the anchor at the same playhead time. The RouteFrame test covers a 200 mm orbit authored from the anchor inventory and confirms the fixed and sticky positions after scroll.

The recipe JSON Schema uses shared definitions to preserve the release package's existing size budget. The rebuilt package passed the artifact check at 6.1 MB unpacked.

## Repository checks

Type checking, the core and React suites, launch, export, recipes, installed package, iteration, agent replay, Pages Router, React 18 and any-site Studio passed during `npm run verify:ci`. The run passed 65 browser cases. The lifted RouteFrame case passed on rerun with a longer wait for Studio's editor to load. All 178 architecture checks passed after updating the test fixtures. The 23 installed skills passed after correcting the scaffold command example. The seven capture goldens, core goldens and 43 release policy checks passed.

The Next App Router smoke test passed on its isolated rerun, including snapshot, MP4 export, source editing, hot reload, and the production build.

The isolated installed-library rerun passed all 11 scenes, native scroll, selection and reload, CLI parity, source recovery, mobile layout, and MP4 export. Every behavior suite passed across the original run and the reruns. The aggregate command recorded the earlier failures and exited nonzero.
