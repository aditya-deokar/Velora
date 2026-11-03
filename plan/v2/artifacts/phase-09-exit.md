# Phase 9 Exit — Any-Site Mode

Status: implemented. Date: 2026-11-03.

## Delivered

- **09.1 Managed workspace.**
  - **Location:** `<user cache>/velora/studio-<version>/` (`VELORA_CACHE_DIR` overrides). It is created by `provisionStudioWorkspace`, installs pinned `react`, `react-dom`, `vite` and `@vitejs/plugin-react` once (41.7 MB on first install here), and works offline afterwards.
  - **Linking:** `@adityadeokar/velora`, `/preview` and `/kit` are aliased to the running CLI's `dist/library`, and `resolve.dedupe` gives the studio, the library and the project's bindings one React.
  - **The project gets only** `.velora/project.json` (adapter `site`, the site origin), `VELORA.md`, scenes, compositions and assets. React, Vite and `package.json` never enter it; the frame cache defaults to `.velora/cache/frames` there.
- **09.2 Same-origin proxy.**
  - The studio is served under `base: "/__velora/"`. `STUDIO_PROXY_PATTERN` proxies every other path to the site, including WebSockets, and excludes the studio base, `@vite`, `@fs`, `@id`, `@react-refresh` and `node_modules/.vite`.
  - `X-Frame-Options` and CSP `frame-ancestors` are stripped in the development proxy only.
  - Diagnostics: `ERR_SITE_NOT_LOOPBACK`, `ERR_SITE_UNREACHABLE`, `ERR_SITE_REDIRECT_EXTERNAL` (the root redirects off-machine), `ERR_STUDIO_FAILED`, `WARN_SITE_FRAME_HEADERS`.
- **09.3 Route-level authoring.**
  - `velora studio init --site`.
  - `velora studio --site URL [--port] [--json]` runs in the foreground: it prints its ready envelope through a new `emit` environment hook and stops on Ctrl-C through `onShutdown`. `--check` starts the studio, verifies identity, proxy and framing, then stops.
  - `velora new scene --template … --route …`, validate, shot, render, frames, check, review and deliver all work against `--url <studio origin>`. `previewBase` gives capture and the captions layer `/__velora/`, and `projectFileUrl` fetches captions and brand from Vite's file server instead of the proxied site root.
  - `velora init` in a non-React package now points to `velora studio --site`, and refuses site projects.
- **Docs:** README "Any website" section, compatibility row, `velora-init` skill (setup table, troubleshooting), root router intent, architecture §Any-site mode, CHANGELOG.

## Validation (real runs, fixture site `tests/fixtures/sites/static-multipage`)

The fixture is a plain Node HTTP server: three pages, absolute CSS and SVG assets, a WebSocket echo, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, and an off-machine redirect route. The project directory has no `package.json`.

- [x] **Quick shot `scroll-through` of `/`, exported to MP4, no React in the site project.** `velora export --url http://127.0.0.1:5180/__velora/?velora-preview=1&velora-quick=scroll-through&velora-route=%2F` produced 540 frames, H.264, 1440×1000.
- [x] **Three route shots render and `velora check --video` is green.** hero-push `/`, scroll-through `/` and tilt-up-reveal `/pricing` with a crossfade: 228 frames at 1280×720 in 53 s. Checks: streams, manifest, no blank frames, dimensions, flash safety, banding.
- [x] **Proxy correctness:** `/`, `/pricing` and `/assets/site.css` are served through the studio origin; frame headers are gone; the WebSocket upgrade passes through (`echo:hi`); `/away` keeps its 302.
- [x] **Studio identity:** the `velora-project` meta carries the project ID; the scene library loads the project's `.jsx` bindings; the capture bridge is ready.
- [x] **`npm run test:site`** repeats all of this on free ports, plus `velora deliver --targets og-image,readme-gif,website-hero --quality draft` through the site studio, and asserts the project stays free of `node_modules` and `package.json`.

## Bugs found and fixed during validation
- **Alias globs came back empty.** Vite treats a glob that starts with `/` as root-relative, so `/@velora-project/…` never matched. The alias is now `@velora-project`, and the studio entry maps glob keys to project-relative paths.
- **`node_modules` appeared in a site project.** The frame cache default `node_modules/.cache/velora/frames` created it in a Rails or static project. Site projects now use `.velora/cache/frames` (`defaultFrameCacheDir`).
- **Capture readiness under load.** The 30 s `networkidle` wait failed whole renders on busy dev servers. It is now a best-effort settle (Phase 7), with readiness owned by the capture bridge.

## Deviations
- **Recipe directory.** Scenes stay in `<project>/src/velora/scenes` (the existing `SCENE_RECIPE_DIRECTORY`), not `<project>/velora/scenes`, so every CLI command, template scaffolder and validator works unchanged.
- **Test fixtures.** Only a static multi-page fixture exists. The plan's SSR-like fixture (absolute assets plus a WebSocket) is covered by the same fixture's absolute assets and WebSocket echo.
- **CI.** Any-site mode is not in CI: the first workspace install needs the npm registry. It is a local release gate (`test:site`), like the agent demos.

## Verification (one run for Phases 7–9, 2026-11-03)

| Gate | Result |
|---|---|
| build, typecheck, lint:architecture | pass |
| test:architecture | 147 pass |
| test:core | 713 pass |
| test:react | 71 pass |
| test:launch | 522 pass (deliver CLI, starter, studio, security, parser execution of every documented command) |
| test:export | 339 pass (deliver end to end with real FFmpeg, size ladder, cleanup) |
| test:browser | 10 pass |
| test:release | 43 pass (size budget, website never packed) |
| test:skills | 22 skills green |
| test:installed | pass (guide v3) |
| test:agent-demos | 5 transcripts replay |
| test:site | pass: any-site studio, route render, video check, deliverables (171 s) |
| test:starter | pass: create, install, setup, doctor, blueprint frames, check |

`test:starter` installs the packed tarball in one step: `@adityadeokar/velora` is not yet on the npm registry, so the starter's `^0.1.2` spec only resolves once the maintainer publishes.
