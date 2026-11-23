# Product

Velora turns a product's real interface into cinematic launch video. A developer's own coding agent works in source with the Velora CLI and skills: it picks a shot or a whole film from certified templates, refines it with real components, previews it live, and renders every file a launch needs. Velora runs locally and owns no AI provider login or account. Its studio adds a hand-editing mode (keyframes, easing, graph editor) over the same recipe files the agent writes.

## Who it serves

- **Teams with a React app** (Vite, Next.js, portable React DOM 18.2+/19, Electron renderers) film their real components and pages. `velora init` connects the existing app without changing its providers, data or styles.
- **Teams with any other website** (Astro, SvelteKit, Rails, Django, static HTML) film their real routes through any-site mode: `velora studio --site <local dev URL>` runs a managed studio outside their repository and frames the site through a same-origin proxy. Shots are route-level; the site's own animations are frozen.
- **Teams without a product UI yet** start from `velora create <dir>`: a blank React stage with a branded landing page, a brand file and a launch blueprint, ready for motion graphics and screen recordings.

## Four ways to make a film

1. **Zero code.** Pick a quick shot of a real page in the studio's Templates tab (live, with typed params), copy the export command and render.
2. **Templates.** Scaffold a camera template (`hero-push`, `scroll-through`, `dolly-zoom`, ...) or a launch blueprint (`launch-film-30s`, `social-teaser-9x16`, ...) into plain files the project owns, then refine.
3. **Direct by hand.** Keyframe camera, focus and layers in Studio. Group tracks, use the Graph Editor and assemble the cut in **Compositions → Edit**.

4. **Direct by agent.** Have your coding agent author or refine recipes and bindings from the guide. **Ask agent** shares the current selection, playhead and recent edits, and the agent applies scoped edit batches.

Templates are starting points, not straitjackets: scaffolded files are ordinary source, provenance is recorded, and user direction overrides every default.

## Craft

- **Cinematography:** shot size, angle and one motivated move per shot; lens language from 24 to 135 mm; depth of field that follows camera-axis depth; smooth rails, springs and seeded handheld noise; restraint (subtle intensity) by default.
- **Motion design and brand:** a kit of device frames, backdrops, cursor, titles, counters and captions driven only by scene time; `velora.brand.json` tokens and motion personalities (calm, crisp, playful, bold).
- **Editing:** true A/B transitions, overlay tracks, beat-snapped cuts, procedural sound on cuts, loudness normalization, styled captions, and an advisory editorial review (hook, pacing per platform, reading time, eye trace, loop seams).
- **Finishing:** quality presets up to supersampled masters, motion blur, looks (grade, grain, LUTs), BT.709 tagging, alpha codecs for editors.

Technical checks (`velora check`, `velora review`) never certify artistic quality. A person reviews taste.

## Studio

The studio opens at `?velora-preview=1` in the developer's running app (or at `/__velora/` in any-site mode). It has three tabs:
- **Scenes:** the project's recipes as a tilted credits list with snapshots.
- **Templates:** a gallery with one live quick shot at a time and a param panel that copies the scaffold command, the export command and an agent prompt.
- **Compositions:** a player with J/K/L transport, frame stepping, safe-area guides and synced audio and captions.

**Edit mode** (`velora-edit=1`, from a scene's Edit button or `npx velora edit --scene <id>`) turns the studio into a keyframe editor on the live app: layers, an inspector with stopwatches and the evaluated value at the playhead, a dope sheet with clip bars and snapping, a graph editor with bezier handles, an easing library, history and a command palette. Every gesture is one typed edit op, so the editor and coding agents make identical, reviewable edits to one recipe file.

**Composition Edit mode** opens from the Compositions tab or `npx velora edit --composition <file>`. Picture, overlays, captions, audio waveforms and beat markers share the playhead. Trim, ripple, roll, slip, split and add A/B transitions. Double-click a shot to edit its recipe at the corresponding source time.

The local edit bridge saves to files in Edit mode using loopback, a per-session token, an origin allowlist and compare-and-swap writes. With the bridge disconnected, Edit mode keeps changes in memory and offers a copyable scene or composition command. JSX promotion and prop exposure require review and confirmation of the source diff. Panel settings stay in the editor.

## Launch delivery

`velora deliver --composition FILE --targets youtube,reels,website-hero,...` renders every platform file into a fresh directory:
- each video at its preset's size, codec, quality and loudness, stepped down in quality until it fits the preset's size budget;
- a website hero as WebM plus MP4 fallback, a poster, and copy-ready `embed.html` and `HeroVideo.tsx` (muted, inline, looping, reduced-motion aware, no layout shift);
- Open Graph and Product Hunt stills.

`deliverables.json` records every file, SHA, size, attempt and warning. Platform limits change, so each preset carries the date it was last checked.

## Agents and prompts

`VELORA.md`, `velora guide` (format 4), 23 skills with an intent router, and `velora prompts` give repository-capable agents a brief-to-delivery workflow. The developer's existing agent subscription runs the agent.

## Boundaries

- Local only: no hosted rendering, accounts, licensing or telemetry. FFmpeg and Chromium are local prerequisites. The edit bridge is a local process the developer starts; it serves only loopback.
- React DOM only for component-level shots; React Native without DOM is out of scope; non-React sites get route-level shots.
- `/three` is an optional React 19 entry for R3F 9 and Three.js. The base toolkit supports React DOM 18.2+ and 19.
- No text-to-speech or transcription; music is the creator's licensed file; sound effects are synthesized.
- No universal quality or performance promises: evidence is device- and scene-specific.

## Distribution

Velora by [Aditya Deokar](https://github.com/aditya-deokar) is MIT-licensed and published as `@adityadeokar/velora` (the unscoped name belongs to another publisher). Source lives at `aditya-deokar/Velora`. Maintainer verification runs locally plus CI on Linux, Windows and macOS. A version pushed to `main` publishes through GitHub OIDC; unchanged versions skip. Compatibility follows the policy in the README: additive changes within a major version, versioned files with a migration path for breaking changes, and a one-minor deprecation window.
