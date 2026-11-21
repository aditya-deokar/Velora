# Phase 08 exit report · Source integration

Date 2026-11-21

## Implementation

The studio can pick a rendered JSX element, browse the scene binding and its immediate local imports, open a source location in VS Code, or copy the location. The outline follows one default re-export. Picking recognizes Code Inspector’s `data-insp-path` and highlights outline candidates by tag, text, and Surface when source markers are absent.

The editor can promote a JSX element to a Surface, group contiguous sibling Surfaces while retaining their IDs and tracks, and expose a literal prop as an inspector channel. When a component is shared with the host app, generated Surfaces render the original subtree outside a Scene and generated hooks return the original prop defaults. The diff shows Git status and the resulting outline. A viewport pick can also show a before-and-after layout sample based on the current DOM.

The authenticated edit bridge requires a reviewed diff and matching file hashes before it applies changes. A journal protects the JSX and scene recipe across partial writes. Undo verifies the current versions of both files. The CLI supports the same operations with dry runs by default and `--write` for an explicit commit. Refused edits report the reason and offer a copyable agent prompt. The editor and scene skills describe the workflow.

## Verification

- The package build, type check, 177 architecture checks, all 23 skills, and all 23 core goldens passed.
- The focused JSX, source transaction, bridge, CLI, prompt, and React regression run passed 61 tests. It covers stale hashes, partial-write recovery, read-only mode, authored-path policy, and shared host components.
- The Chromium suite passed all 44 tests. Its Vite source tests used a Code Inspector-format fixture attribute and plain DOM fallback. They promoted three siblings, grouped and staggered them, and checked group motion in capture. A second journey exposed and keyframed a counter prop.
- The installed Next App Router fixture picked a heading from an imported client component, waited for the reviewed JSX and recipe writes, and verified the new layer after Fast Refresh. The regular host route retained the heading without a Surface wrapper, and the production studio route returned 404.
- The real `local-project` `overview` outline resolved the re-export into `scene-content.tsx` and its `dashboard.tsx` import. The CLI previewed a Revenue promotion with paired JSX and recipe diffs. Revenue occupies a different JSX parent from Customers and Projects, so grouping those three in the existing dashboard would require a host layout refactor. The three-sibling workflow was exercised in the Vite fixture.
- The aggregate `verify:ci` run passed package preparation, type checking, architecture, recipe, core, React, and export checks. One existing dev-server test exceeded its five-second limit during the launch suite. The same test passed in isolation in 537 ms. The timeout stopped the aggregate run before its standalone browser and installed-host stages.

## Scope notes

- The location parser follows the [Code Inspector attribute format](https://inspector.fe-dev.cn/en/api/advance.html). The Vite fixture exercises marked and unmarked JSX. The Next fixture exercises the outline fallback. Installation of the third-party plugin was outside these checks.
- Promoting a descendant can turn a leaf Surface into a spatial group. A scene with depth-of-field blur needs its remaining visible content in Surface leaves or `content`. The three-card fixture uses `maxBlur: 0`.
