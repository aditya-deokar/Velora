# Phase 16 exit evidence

`drone-flyover`, `telephoto-parallax-orbit` and `whip-pan-macro` bake at 240 Hz and emit ordinary recipe clips and constraints. The position path uses explicit Bézier handles and stage-space eye coordinates. The renderer converts the eye position using the evaluated rotation, so the additive horizon bank does not disturb the flight path.

```sh
velora edit rig --scene home-hero --kind telephoto-parallax-orbit --target subject:revenue --arc 36 --url http://127.0.0.1:5173 --json
velora edit rig --scene home-hero --clip camera-rig --arc 24 --url http://127.0.0.1:5173 --write --json
```

The first command previews the edit. The second regenerates an existing rig clip. In Studio, the Camera tool opens the rig controls. Director view displays the path, bank and clearance, and a waypoint drag commits one undoable edit.

Telephoto reports use the scene's measured planes. Authored far planes receive coverage estimates for the full arc. Depth boost updates the live layer elevation and the predicted parallax. Velocity blur uses milliseconds of shutter time, and capture substitutes shutter accumulation when selected by the render settings.

Library source maps retain their mappings and reference the source files. The release package omits embedded copies of those files to stay within the existing size budget.

## Browser certification

The live dashboard fixture uses the laptop stage at 1512 × 982 and compares preview and capture at 960 × 540. Each row records a PNG that matched preview and two capture passes byte for byte.

| Rig | Sample | PNG SHA-256 |
|---|---:|---|
| Drone flyover | 1300 ms | `58a65b406d9db9ff6a5723339d0a3b68ee2c316fc65003098110a9d046312837` |
| Telephoto orbit | 900 ms | `115f64ad06bff7a41386a68c35a0abd3ef70c170aaaa40f0196ca067d1527f7e` |
| Whip pan | 183.333 ms | `9953acd6c1fa9d34bcd0511e446b21e728ab5208703ce7529c1e61a90f88cb92` |

The through-flight cleared the 40 px margin, stayed below 100,000 px/s³ peak jerk and had bake joins below 0.05 px/s velocity discontinuity. The dry run left the recipe bytes intact. The telephoto target stayed centered and below 0.5 px of focus blur at all sampled times.

| Dashboard element | Measured peak displacement | Predicted peak displacement |
|---|---:|---:|
| Control | 448.261 px | 448.261 px |
| Floating | 389.301 px | 389.301 px |
| Growth card | 145.994 px | 145.994 px |

The whip's horizontal blur exceeded four times its vertical blur at peak velocity. The arrival target was centered and sharp at 800 ms. The capture bridge reported `velocity` for the standard pass and `shutter` when accumulation disabled the directional filter.

## Release checks

Type checking, 925 core tests and 157 React and Studio tests passed. The core suite includes the existing shot goldens, recipe schemas, and editor operation parity.

The project, CLI, preview, docs and export run passed 64 suites and encountered timeouts and temporary-file locks in three suites on Windows. All 116 tests in those three suites passed when rerun serially. One test in the wider run was skipped.

The package build, 178 architecture checks, 43 release tests and 23 packaged skill checks passed. The tarball unpacked to 4.8 MB, within the existing 6 MiB limit.
