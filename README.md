# Velora by [Aditya Deokar](https://github.com/aditya-deokar)

Cinematic 3D scenes made from your **real React UI**. Your coding agent composes the camera, depth, focus and motion. Velora provides the renderer, scene library, playback and MP4 export. Your app keeps its components, providers and styles.

Open source under the [MIT license](LICENSE). Runs locally, with your existing coding agent. No account or AI subscription connection is needed in Velora.

## Install into your app

**React DOM 18.2+ or 19**, with **Node 22.12+** for the CLI. The renderer is independent of your router and build tool. Setup has automatic connections for Next.js App/Pages Router and standard Vite projects; other React hosts use the same portable wrapper without changing frameworks.

From your existing app's directory, **create a separate Git branch before installing**. Velora adds integration and scene files to your codebase; a branch keeps those changes separate while you create and review your animations. Commit or stash any existing work first:

```sh
git switch -c velora-scenes
npm install @adityadeokar/velora
npx velora init
npm run dev
```

Keep your existing dev server if it is already running. Use the URL it prints:

```sh
npx velora open --url http://127.0.0.1:5173
```

In Next.js, open `/velora` on your existing dev server (usually port 3000). Setup adds this development-only route without rewriting your app/layout/providers. In Vite, setup connects the existing root. Both create `VELORA.md`. Repeating setup is safe; conflicting user-owned files get a repair message. Normal app routes and production builds remain ordinary. One installed app owns one scene catalog.

## Other React hosts (including Electron renderers)

Run `npx velora init --adapter react`. Setup creates a framework-independent wrapper and tells your agent how to connect it. It deliberately does not guess or replace your application root:

```jsx
import { VeloraProjectPreview } from "./velora/ProjectPreview";

<ExistingProviders>
  <VeloraProjectPreview enabled={yourDevelopmentFlag}>
    <ExistingApp />
  </VeloraProjectPreview>
</ExistingProviders>
```

For production bundle exclusion, have your agent load the generated module only behind your bundler’s compile-time development condition. The `enabled` prop is a runtime guard, not a substitute for removing development imports. Next and Vite automatic connections include their native compile-time guards.

Use your host's actual development flag, then open its route with `?velora-preview=1`. For a dedicated route, pass `active`. This uses the existing React renderer, including Electron's renderer process; no changes to main/preload, security settings or build tools. A React Native application without browser DOM is not supported.

The underlying `ProjectPreview` export accepts `projectId`, `enabled`, optional `active`, `sceneModules` (lazy module loaders) and `children`. This is the shared integration contract; named framework connections are conveniences, not renderer dependencies. Next.js scene bindings are client components: keep server-only imports in the host's server layer and supply their data through that boundary.

## Give your coding agent this prompt

> Read VELORA.md and run `npx velora guide --json`. Inspect this app's real dashboard page and create a cinematic Velora scene from its existing components. Choose intentional close perspective, camera travel and depth of field. Preserve the app's design and providers. Verify it in the browser, save a snapshot, and give me the scene URL.

Replace “dashboard” with the page you want. Claude Code, Codex CLI or another repository-capable agent can use the same installed guide; Velora does not run or authenticate the agent for you.

For launch work, start from the prompt library instead. Each prompt names the blueprint or template, the skills to load and the proof loop; replace its `<placeholders>`:

```sh
npx velora prompts ls
npx velora prompts show --id launch-film
```

Prompts: `launch-film`, `feature-announcement`, `website-hero-loop`, `vertical-teaser`, `dashboard-cinematic`, `changelog-video`, `product-hunt-assets` and `first-scene`. The generated `VELORA.md` and the studio's Getting started panel offer the same prompts.

The guide explains concepts, tradeoffs, exact APIs and a tested file-pair example. It leaves the composition to the creator. Ask your agent to revise the source when you want a different shot.

## Five-minute path (CLI + skills, `--json`-first)

Run these in your app's root with its dev server running (here on port 5173). Each step works on a fresh install:

```sh
npm install @adityadeokar/velora
npx velora init --json
npx velora doctor --url http://127.0.0.1:5173 --json
npx velora skills install --agent claude --json
npx velora new scene --template hero-push --id home-hero --route / --json
npx velora shot --scene home-hero --time 3000 --out home-hero.png --url http://127.0.0.1:5173 --json
```

`home-hero.png` is a cinematic still of your real home page. For a whole launch film, scaffold a blueprint, check it, and draft it:

```sh
npx velora new video --blueprint launch-film-30s --id launch --route / --json
npx velora validate --composition launch.composition.json --json
npx velora review --composition launch.composition.json --platform youtube-1080p --json
npx velora frames --composition launch.composition.json --out board --every 30 --contact-sheet --url http://127.0.0.1:5173 --json
npx velora render --composition launch.composition.json --out launch.mp4 --quality draft --url http://127.0.0.1:5173 --json
npx velora check --video launch.mp4 --manifest launch.manifest.json --json
```

Every command supports `--help` and `--json`; exit `0` ok, `1` operational
failure with `issues[].code`, `2` usage error. The root skill
(`velora/SKILL.md`, loaded first) routes each intent to at most four
specialized skills; `npx velora skills check --json` verifies the installed
library. `velora check` and `velora review` are technical and advisory only; a
person still reviews taste (`requiresVisualReview: true`).

## Compatibility and limits

| Surface | Supported |
|---|---|
| Agents | Claude Code, Codex CLI, Cursor, any skill-compatible agent (`--json` contract is the coupling surface; snippets are additive) |
| React | DOM 18.2+ or 19 (Next.js App/Pages Router, Vite, portable wrapper, Electron renderer) for component-level shots |
| Any website | Astro, SvelteKit, Rails, Django, static HTML through `velora studio --site` (route-level shots; no React in your project) |
| Node | 22.12+ for the CLI |
| FFmpeg | Required for audio mix, caption burn, MP4 encode, and audio probing; burned-in captions need a build with libass (Homebrew: `brew install ffmpeg-full`) |
| Chromium | Required via Playwright for capture, snapshots, and video sampling |
| AI auth | Bring your own agent subscription — Velora runs no agent and stores no keys |

Not supported: React Native without DOM, hosted rendering service, accounts or
licensing, a visual builder or focus-position editor, text-to-speech and
transcription, and universal quality or performance promises (evidence is
device- and scene-specific). Ewmotion integration is deferred until a real
source exists to integrate. The command name `velora` runs the
same CLI; recipe files stay at version 1 and scenes at focus version 3, and
older wrappers and `VELORA.md` handoffs (from the unscoped `velora` package or
guide v2) are upgraded by re-running `velora init` (never hand-edited).

## Ship every platform at once

`velora deliver` renders every launch file from one composition into a fresh directory:
- each platform video at its preset's size, codec, quality and loudness, stepped down until it fits the preset's size budget;
- a website hero (WebM plus MP4 fallback, a poster, `embed.html` and `HeroVideo.tsx`);
- Open Graph and Product Hunt stills;
- `deliverables.json` with every SHA and size.

```sh
npx velora deliver --composition launch.composition.json --targets youtube,reels,tiktok,website-hero,readme-gif,og-image --url http://127.0.0.1:5173 --json
```

Targets: `youtube`, `x`, `x-square`, `linkedin`, `reels`, `instagram-feed`, `tiktok`, `shorts`, `website-hero`, `readme-gif`, `og-image`, `product-hunt` (or any delivery preset id).

## No React app yet?

`velora create` writes a launch studio: a blank Vite React stage with a branded landing page, `velora.brand.json` and a blueprint, for motion graphics and screen recordings.

```sh
npx @adityadeokar/velora create my-launch --name "Your product"
```

Then `cd my-launch`, `npm install`, `npm run velora:setup` and `npm run dev`.

## Any website: Astro, SvelteKit, Rails, static HTML

Any-site mode films the real routes of a non-React site.
- Velora runs a managed studio from your user cache, so React and Vite never enter your repository.
- The studio is served at `/__velora/`; every other path is proxied to your site's local dev server, so routes frame same-origin.
- Scenes, compositions and assets stay in your project.

```sh
npm install --save-dev @adityadeokar/velora
npx velora studio init --site http://127.0.0.1:4321
npx velora new scene --template scroll-through --id tour --route / --json
npx velora studio --site http://127.0.0.1:4321
```

Render and deliver against the studio origin it prints (for example `--url http://127.0.0.1:5180`). Limits:
- shots are route-level, not component-level;
- the site's own animations are frozen;
- interactive states must be reachable by route or query parameter.

The development proxy strips `X-Frame-Options` and `frame-ancestors` so pages can be framed; production is unaffected.

## Compatibility policy and migrating to 1.0

- **Additive within a major version.** New optional fields never break existing files. Old CLIs reject fields they don't know, so upgrade the CLI before using new fields.
- **Breaking changes bump the file version** (`version` in recipes, compositions, `velora.brand.json` and the guide) and ship an upgrade path. Re-running `velora init` upgrades generated adapters and `VELORA.md`; you never hand-edit generated files.
- **Deprecations warn for one minor version** before removal.
- **0.x to 1.0:** recipe version 1, scene version 3 and composition version 1 are unchanged, so existing scenes and compositions keep working. Re-run `npx velora init` once to refresh the adapter and the guide v3 handoff, then `npx velora skills install --agent claude` (or your agent) to get the 22-skill library.

## Scenes and studio

The agent creates `src/velora/scenes/my-shot.scene.json` and matching `my-shot.tsx` or `my-shot.jsx` (one component per recipe). JSON owns the scene definition; the component imports actual host UI and returns stable `Surface` elements. The shared studio supplies the camera renderer, playback and capture, with no duplicated renderer.

Outside Vite, run `npx velora sync` after adding/removing scene pairs. Existing file edits use your host’s hot reload. Open the scene library, select a scene, play or seek, and revise its source through your running dev server.

```sh
npx velora scenes
npx velora open --scene my-shot --url http://127.0.0.1:5173
npx velora snapshot --scene my-shot --url http://127.0.0.1:5173
```

Snapshots cache rendered local pixels in the recipe. Refresh them after visual changes; they may include visible app data.

New scaffolds use `laptop-14`, a 1512×982 CSS viewport at 2×. Choose a preset or pass the viewport as `--stage 1536x730@1.25`. **Use as stage** in Studio can save your current window or screen size. Set the video dimensions independently when you export.

Enable UI depth on a surface with `velora edit depth --scene home-hero --surface subject --mode auto --write`. Depth tiers give cards and controls parallax, edges, shadows and camera-reactive sheen. Use `velora depth resolve --scene home-hero --write` to freeze the classified layers before delivery.

### Edit mode: keyframes by hand

```sh
npx velora edit --scene my-shot
npx velora edit key --scene my-shot --track camera.z --at 1200 --value 400 --ease cubic.out
```

The first command verifies your dev server, starts the local edit bridge and opens the editor. The second is the headless equivalent for one keyframe (a dry run until you add `--write`).

Edit mode puts layers, the Inspector, a dope sheet and a graph around the live scene. Click a stopwatch to animate a property, set another value at the playhead, and use F9 for Easy Ease. Ctrl/⌘+G groups selected tracks into a clip. **Ask agent** copies the selection and edit intent for your coding agent. The local bridge saves gestures to the scene JSON. Without a bridge, **Copy as command** gives you the equivalent CLI batch.

Open **Compositions → Edit** to cut a film with audio waveforms, captions, overlays and beat markers. Use the local bridge to save, or preview a JSON batch with the CLI.

```sh
npx velora edit --composition launch.composition.json
npx velora compose edit --composition launch.composition.json --ops ops.json --json
```

[Watch a video rendered by Velora](website/public/media/hero/hero.mp4) · [Studio walkthrough](USER_GUIDE.md#editing-scenes-by-hand-edit-mode)

## Export video

Install FFmpeg on your system and Chromium once:

```sh
npx playwright install chromium
```

The studio's Export control supplies the command for the selected scene. For example:

```sh
npx velora export --url 'http://127.0.0.1:5173/?velora-preview=1&velora-scene=my-shot' --output my-shot.mp4 --fps 60
```

30, 60 and 120 FPS are supported. Export samples the live scene deterministically and excludes studio controls. Choose a new output filename; existing files are not overwritten. Keep the host server running. Camera depth of field uses performant DOM blur approximation, not ray-traced bokeh.

## Work on Velora

```sh
npm ci
npm run verify:agent
npm run build
npm run setup:local
npm run dev
```

The separate `local-project/` exercises installation with real scenes; it is not shipped in the package. The unconnected product opens with an honest empty scene list.

Read [architecture](docs/architecture.md) for canonical code owners and [product](docs/product.md) for scope. The installed `velora guide` is the authoritative authoring reference. Build and boundary checks reject architectural drift.

## Maintainer release

GitHub Actions runs `ci.yml` on every push and pull request: fast gates (typecheck, architecture, core, React, skills, release) on Linux, Windows and macOS with Node 22.12 and 24, plus a Linux browser/export/installed-app tier. Hardware timing and `verify:release` stay local. The separate publish workflow only builds and publishes a new npm version.

1. Update the package version with `npm version patch --no-git-tag-version`. Every `skills/velora*/SKILL.md` front-matter `version` and `skills-lock.json` must pin the same version; `npm run test:skills` enforces it.
2. Run `npm ci`, install Chromium and FFmpeg, then run `npm run verify:release` locally. This includes architecture, browser, installed-app, export, agent-demo transcript replay (`test:agent-demos`), and hardware checks. Logs remain in `.release/logs/`. `npm run release:local` plus `node scripts/release.mjs check` must accept the artifact (skills ship, tests and demo MP4s do not).
3. Commit the verified version and lockfile, then push to `main`. The publishing workflow checks npm first. If that version already exists, it stops before installing or building. Otherwise it runs `npm run build:package` and publishes through OIDC. npm versions are immutable; changing source without a version bump does not update the public package.
4. Run `npm run test:published` locally after publication to check the exact public version in a fresh installed app.

The public source is [aditya-deokar/velora](https://github.com/aditya-deokar/velora), and the package is `@adityadeokar/velora` (owned in source by `VELORA_PACKAGE`). npm's trusted publisher uses GitHub repository `velora`, workflow `publish.yml`, environment `npm`, with direct `npm publish` permission. The GitHub environment permits the `main` branch. Never commit npm tokens.

Code-only and documentation-only pushes do not start a workflow. Package/lockfile or publishing-workflow changes can trigger the small version lookup. A failed release can be retried through Actions → Publish npm package → Run workflow on `main`; an existing npm version will safely skip. Publication is never tag-triggered; test results come from `ci.yml` and the local release gate.

`verify:ci` remains a local alternative without hardware timing checks; `verify:release` retains the full hardware gate. CI does not run the hardware gate, so the maintainer still runs `verify:release` before pushing a release version.

For manual publication, run `npm run release:publish` locally from the clean committed candidate and complete npm's private authentication prompt. For source-only testing, `npm run release:local` builds a tarball in `.release/`; `npm run setup:local` installs it in the isolated local host.
