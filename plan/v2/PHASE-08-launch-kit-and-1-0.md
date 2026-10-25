# Phase 08 — Launch Kit, Docs Site, Starter & 1.0 Hardening

## Goal
One command produces every asset a launch needs. A public docs site shows Velora's craft,
and is itself made with Velora. Teams without a React app get a starter. The package meets
a 1.0 bar for stability, compatibility and security.

## Prerequisites
- Phase 06 (blueprints, loudness, overlays) and Phase 07 (skills, prompts, guide v3).

## Scope IN
- `velora deliver`, website embed snippets, the docs website, the `create` starter, 1.0 hardening, the v2 rewrite of `docs/product.md` and `docs/architecture.md`.

## Scope OUT
- Hosted rendering, accounts, licensing infrastructure (still out of product scope).

## Tasks

### 08.1 `velora deliver --composition FILE --targets LIST [--out DIR] [--json]`
- Targets come from `DELIVERY_PRESETS` (Phase 04): `youtube`, `x`, `linkedin`, `reels`, `tiktok`, `shorts`, `website-hero`, `readme-gif`, `og-image`, `product-hunt`.
- Per target:
  - aspect-aware render (true reframing for template-provenance recipes, cover-crop + warning otherwise);
  - codec and loudness from the preset;
  - poster;
  - size-budget enforcement via a deterministic CRF ladder (report each attempt).
- `website-hero` emits `hero.webm`, `hero.mp4`, `poster.jpg`, plus `embed.html` and `HeroVideo.tsx` snippets:
  - `<video autoplay muted loop playsinline preload="metadata" poster>`, with sources in webm → mp4 order;
  - `prefers-reduced-motion` falls back to the poster;
  - width/height set to avoid layout shift.
- `og-image` and `product-hunt` emit stills (1200×630; 1270×760 gallery frames) chosen from hero times.
- Writes a `deliverables.json` manifest (targets, files, sizes, durations, loudness, SHAs, warnings).

### 08.2 Docs website — `website/` (not shipped in the npm package)
- React-based (dogfooding the renderer).
- Contents:
  - getting started (the five-minute path);
  - template gallery with Velora-rendered videos and contact sheets;
  - cookbook (launch film, hero loop, vertical teaser);
  - craft guides (from the skills, human-oriented);
  - API reference generated from the shipped JSON Schemas;
  - CLI reference generated from `CLI_COMMANDS`.
- Velora's own launch film is made with `launch-film-30s`, and its render manifest is published as evidence.
- Built and deployed by a separate workflow; never part of `verify:*`.

### 08.3 Starter — `npm create @adityadeokar/velora`
- A separate tiny package, or `velora create`. It generates a blank Vite React host, pre-initialized, with `velora.brand.json`, a launch blueprint and installed skills.
- Audience: teams whose product isn't a React app, who need motion graphics, screen recordings (`VideoClip`) and routes later via any-site mode (09).
- Honest positioning: real-UI shots require a React host or any-site mode.

### 08.4 1.0 hardening
- **Compatibility policy:**
  - Schema evolution is additive within a major version.
  - Breaking changes bump recipe/composition `version` and ship `velora migrate`.
  - Deprecations get a one-minor warning window.
- **Migration guide** 0.x → 1.0 in README/CHANGELOG.
- **CI:** browser tier on Windows + macOS + Linux. Fast-tier matrix kept.
- **Package size budget**, enforced by `scripts/release.mjs`.
- **Security review:**
  - RouteFrame is same-origin only;
  - capture stays loopback-only (`ExportVideoSchema.url`);
  - scoped writes everywhere;
  - no shell interpolation of user strings (spawn args only);
  - FFmpeg filter-graph inputs are validated (no user-controlled filter text).
- **Performance regression evidence:** recorded per release (device-specific, never promised).
- **Docs:** rewrite `docs/product.md` (v2 product: templates, kit, studio gallery, editorial, delivery) and `docs/architecture.md` (new owners and layers). The checker still allows only these two files.

## Files
- New: `src/core/deliverables.ts`, `src/export/deliver.ts` (or within `src/export/commands.ts`), `website/**`, starter package
- Modified: `src/cli/index.ts`, `src/core/cli-schema.ts`, `scripts/release.mjs`, `.github/workflows/ci.yml`, `docs/*`, README.md, CHANGELOG.md

## Tests
- `tests/export/deliver.test.ts`: target matrix, size ladder determinism, embed snippet validity (HTML parse), manifest schema.
- Starter smoke: create → install → `velora doctor` → render blueprint frames.
- Release tests: size budget, allowlist (`website/` never shipped).

## Validation criteria
- [ ] `velora deliver --targets youtube,reels,website-hero,readme-gif,og-image` on a fixture produces every file within budget, with correct loudness and aspect.
- [ ] The docs site's hero video is rendered by Velora from a blueprint.
- [ ] Three-OS CI green; 1.0 checklist signed off in the exit report.

## Anti-patterns
- Shipping `website/` or demo media in the npm package.
- Size-budget loops that are non-deterministic.
- Claiming platform compliance without `lastVerified` dates.

## Definition of Done
1.0 checklist complete. `plan/v2/artifacts/phase-08-exit.md` written. The maintainer tags the 1.0 release.
