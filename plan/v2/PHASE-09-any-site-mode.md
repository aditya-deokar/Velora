# Phase 09 — Any-Site Mode (non-React websites)

## Goal
Let developers launching websites built with **any** stack (Astro, SvelteKit, Rails, Django,
static HTML) use Velora's templates, quick shots, compositions and delivery with their real
pages. Their project never needs React installed.

## Prerequisites
- Phase 03 (studio, quick shots, composition player), Phase 05 (kit, `RouteFrame` maturity, `VideoClip`).

## Scope IN
- `velora studio --site URL`: a managed standalone studio workspace, a same-origin reverse proxy, route-level scenes and compositions for the target site.

## Scope OUT
- Component-level decomposition of non-React UIs (impossible without their renderer); cross-origin production URLs (loopback targets only).

## Tasks

### 09.1 Managed studio workspace
- `velora studio --site http://localhost:4321 [--port P] [--json]` provisions a **managed workspace** outside the user's project. The first run installs pinned `react`, `react-dom`, `vite`, `@vitejs/plugin-react` and `@adityadeokar/velora`, and reports the size.
  - Location: `<user cache>/velora/studio-<version>/` (resolved by services; never inside the user's repo).
  - Offline after first install. `velora doctor` reports workspace health.
- The user's project gets only `velora/` (scenes, compositions, assets, brand), created by `velora studio init`. No dependency changes.

### 09.2 Same-origin reverse proxy
- The studio app is served under `base: '/__velora/'`.
- Every other path (including WebSocket HMR) is proxied to the target site via Vite `server.proxy` with a catch-all that excludes `/__velora/`, `/@vite`, `/@fs`, `/@id` and `/node_modules/.vite`.
- Effect: `RouteFrame route="/pricing"` is same-origin, so scroll, freeze-animations and readiness all work, and absolute asset paths of the target site keep working.
- Diagnostics:
  - `ERR_SITE_UNREACHABLE` (target down);
  - `ERR_SITE_REDIRECT_EXTERNAL` (target redirects off-loopback);
  - `ERR_ROUTE_FRAME_BLOCKED` (frame-ancestors/X-Frame-Options from the target dev server, with a hint to relax them in dev).

### 09.3 Route-level authoring
- Scenes live in `<project>/velora/scenes/*.scene.json` + `.tsx`, compiled by the managed Vite (`server.fs.allow` includes the project's `velora/` dir).
- Templates scaffold with `--route` only (`velora new scene --site --template … --route /`).
- Quick shots, compositions, render, frames, check, deliver and review all work, because capture targets the studio origin.
- Documented limits:
  - shots are route-level;
  - the target site's own animations are frozen;
  - interactive state requires query-param or route-driven states.

## Files
- New: `src/project/studio.ts` (workspace planning; pure), services for cache-dir provisioning and spawn, the generated studio host template, `skills` updates (`velora-init`, `velora-templates`).
- Modified: `src/cli/index.ts`, `src/core/cli-schema.ts`, `src/project/commands.ts`

## Tests
- Fixtures: a static multi-page site served by a tiny Node server, plus an SSR-like fixture with absolute asset paths and a WebSocket.
- Proxy correctness: paths, assets, WS passthrough, redirects.
- `RouteFrame` same-origin scroll and readiness.
- Template scaffold `--site`.
- Render determinism.
- Doctor workspace checks.

## Validation criteria
- [ ] Static fixture site: `velora studio --site <url>` → quick shot `scroll-through` of `/` → export MP4, with no React installed in the site project.
- [ ] Composition of three route shots renders, and `velora check --video` is green.

## Anti-patterns
- Installing React or Vite into the user's non-React project.
- Proxying non-loopback origins.
- Promising component-level shots for non-React sites.

## Definition of Done
All validation green. `plan/v2/artifacts/phase-09-exit.md` written. README and compatibility docs list any-site support with its limits.
