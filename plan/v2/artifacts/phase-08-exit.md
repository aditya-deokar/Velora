# Phase 8 Exit — Launch Kit, Docs Site, Starter & 1.0 Hardening

Status: implemented. Date: 2026-11-03.

## Delivered

### 08.1 `velora deliver`
- **Core** (`src/core/deliverables.ts`, pure):
  - `DELIVER_TARGETS`, twelve short names mapped to presets and kinds: youtube, x, x-square, linkedin, reels, instagram-feed, tiktok, shorts, website-hero, readme-gif, og-image, product-hunt. Preset ids are also accepted.
  - `resolveDeliverTargets`; a deterministic, monotonic `sizeLadder` (CRF steps per codec, frame-rate steps for GIF); `heroTimeMs` (the middle of the longest shot); `galleryTimesMs`.
  - The website-hero snippets `heroEmbedHtml` (escaped title, WebM before MP4, poster, width and height, reduced-motion swap) and `heroVideoTsx`.
  - `DeliverablesManifestSchema` and `DeliverInputSchema` (project-relative output only).
- **Export** (`executeDeliver` in `src/export/commands.ts`):
  - Per target it calls `executeVideoRender` with the preset's size, codec and quality. Loudness comes from the preset unless the composition sets its own.
  - It climbs the ladder until the byte budget is met. An internal `crf` render override has no CLI flag; frame-cache hits make each retry encode-only.
  - Attempts render in `<out>/.velora-attempts/`, and the winner is published with a no-overwrite hard link.
  - Stills are cover-cropped (`encodeStill`). The output directory must be new; a failed run leaves no empty directory.
  - `deliverables.json` records files with SHA-256, bytes, sizes, render manifests, attempts, measured loudness, warnings and each preset's `lastVerified` date.
  - Warnings: `WARN_DELIVER_BUDGET`, `WARN_DELIVER_CROPPED`, `WARN_DELIVER_HERO_LONG`. Error: `ERR_DELIVER_TARGET`.
- **CLI:** `velora deliver --composition FILE --targets LIST [--out DIR] [--quality Q] [--parallel N] [--no-cache] [--no-stream] [--url] [--project] [--json]`.
- **Deviation: aspect reframing.** It uses the existing cover-fit, which is the same as `render --aspects`. True per-aspect re-scaffolding of template-provenance recipes is not done; still crops are reported with `WARN_DELIVER_CROPPED`.

### 08.2 Docs website (`website/`, never packed)
- **Stack:** React and Vite with hash routing. Pages: Start (five-minute paths and featured prompts), Templates (real storyboards from the agent demos, filterable catalog, blueprints), Cookbook (demos C, D and E with their real commands, prompts and fix logs), Craft (skills' Craft Notes, transitions, skills), Deliver (targets and presets with `lastVerified`, hero snippet), CLI (every command and its `--help`), Schemas (property trees from the shipped JSON Schemas).
- **Generated data:** `website/scripts/generate.mjs` builds everything from the shipped sources (`CLI_COMMANDS`, catalogs, prompts, presets, schemas, skills and the demo evidence), so the site cannot drift.
- **Dogfooding.**
  - The site was connected with `velora init` (automatic Vite adapter) and given the `website-hero-loop-8s` blueprint of its own home page.
  - Its hero was rendered by `velora deliver --targets website-hero` in 157 s: `hero.webm` 1,854,189 bytes (within the 4 MB budget, no warnings), `hero.mp4` 2,120,854 bytes, a poster, `embed.html` and `HeroVideo.tsx`.
  - These are committed under `website/public/media/hero/` with `deliverables.json` as evidence.
- **Deploy:** the `.github/workflows/website.yml` Pages workflow (action SHAs resolved with `gh api`) builds and deploys. It is not part of `verify:*`.

### 08.3 Starter
- `velora create <dir> [--name] [--blueprint]` (`src/project/starter.ts`, pure; `executeCreateCommand`, create-only into a new or empty directory). It writes:
  - a Vite React stage with a branded landing page (accent CTA for contrast) and `velora.brand.json` (crisp personality);
  - a README with the five-minute path and `.gitignore`;
  - `npm run velora:setup` (`velora init`, skills install, blueprint scaffold).
- Product names are stripped of markup.
- Honest positioning in the README and help: real-UI shots of an existing product need a React host or any-site mode.
- Smoke gate `npm run test:starter`: create, install with the packed tarball, setup, dev server, doctor, blueprint frames, check.

### 08.4 1.0 hardening
- **Compatibility policy and 0.x to 1.0 migration** (README; architecture §1.0): additive within a major version, versioned files with upgrade paths, a one-minor deprecation window. Recipe v1, scene v3 and composition v1 are unchanged.
- **CI:** the browser, export and installed-app tier now runs on Linux, Windows and macOS, with per-OS FFmpeg install. Agent demos, any-site mode and hardware timing stay local release gates (they need registry access or real hardware).
- **Package budget** (`PACKAGE_BUDGET` in `scripts/release.mjs`): 6 MB unpacked, 2 MB per file. It is 2.8 MB now. Tests prove the budget fails, and that `website/` and demo media can never be packed.
- **Security review** (pinned in `tests/project/security.test.ts`):
  - *Fixed:* on Windows, `run()` launched every executable through `cmd`, including `rundll32` with a URL and `npm install` with the user's `--package` path. Now only `npm.cmd` uses a shell, and cmd metacharacters are refused.
  - *Fixed:* `escapeSubtitlesPath` escaped `'` as `\'` inside FFmpeg single quotes, where a backslash is literal, so a quote in a project path could end the string. Such paths are now refused.
  - *Confirmed:* capture and export URLs are loopback-only; `RouteFrame` is same-origin only; writes are project-scoped and no-overwrite; spawns use argument arrays; SFX and looks come from schemas.
- **Capture robustness:** the screenshot timeout rose from 10 s to 30 s. Rendering the docs site's heavy page with several workers exceeded 10 s on this machine.
- **Docs:** `docs/product.md` rewritten for v2 (audiences, three paths, craft, studio, delivery, agents, boundaries, distribution); `docs/architecture.md` adds launch delivery, starter, any-site mode and 1.0 hardening; README and CHANGELOG updated.
- **Not done:**
  - `velora migrate`: no breaking schema change exists yet, so there is nothing to migrate. The policy names the mechanism, and `velora init` performs the existing upgrades.
  - The version bump to 1.0.0 and the tag: those are the maintainer's.

## Validation criteria
- [x] `velora deliver --targets youtube,reels,website-hero,readme-gif,og-image` (plus product-hunt) on a fixture produces every file at the preset size and codec; `tests/export/deliver.test.ts` checks this with real FFmpeg. In the live run through any-site mode (`test:site`), og-image, readme-gif and website-hero came from real browser capture.
- [x] The docs site's hero video is rendered by Velora from a blueprint.
- [ ] Three-OS CI green: the workflow is updated and its first run happens on push (the PR shows it).
- [x] 1.0 checklist below.

## 1.0 checklist
| Item | State |
|---|---|
| Compatibility policy and migration guide | done (README, architecture) |
| Three-OS browser CI | configured; confirmed by the PR's CI run |
| Package size budget | enforced, 2.8 / 6 MB |
| Security review | done; two fixes, rules pinned by tests |
| Performance evidence | recorded below (this machine) |
| Docs rewrite | product.md, architecture.md |
| Version bump and tag | maintainer |

## Performance evidence (Windows 11, this machine; device-specific)
| Run | Result |
|---|---|
| Docs hero, `deliver --targets website-hero --parallel 2` | 240 frames at 1920×1080: VP9 plus H.264, 157 s |
| Any-site three-route composition, 960×540 | 228 frames, render about 53 s (1280×720 trial) |
| Demo C launch film draft (Phase 7) | 895 frames, 1140 s |

## Verification
See the gate table in `plan/v2/artifacts/phase-09-exit.md` (one run covers both phases). Note: until `@adityadeokar/velora` is published, a starter from `velora create` must install Velora from a tarball or folder; its `^version` spec resolves after publication.
