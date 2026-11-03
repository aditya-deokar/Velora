# Velora v2 — "Cinematic by Default" Roadmap

Source brief: the maintainer's request (2026-10-20) to make Velora very easy to use and
production grade. It asks for attractive starting points (easy and advanced-looking B-roll
templates, skills and quick-starts) drawn from the craft of top video editors and
cinematographers, so developers can make product and website launches memorable.

Repo audited: 2026-10-20 at `@adityadeokar/velora@0.1.2` (commit `4b67a68`).
v1 roadmap: `plan/README.md` (phases 00–09, complete; exit reports in `plan/artifacts/`).

## 1. Vision

v1 made Velora a rigorous, agent-first engine. v2 makes it **cinematic by default**. A
developer goes from `npm install` to an exported, beautiful shot of their *real* product in
minutes. From there they grow into launch films with titles, music and platform-ready
deliverables, without leaving their codebase or learning 3D math.

Three paths, one engine:

1. **Zero code.** Open the studio, pick a quick shot of your live page, then copy the export command.
2. **Scaffold.** `velora new scene --template hero-push --route /` (or `--component path#Export`)
   writes plain, editable source into the project.
3. **Direct.** Your coding agent, guided by craft skills, authors bespoke shots and edits
   whole films through the CLI's verify loop.

The v1 defining principle still holds: **the CLI provides the capabilities; the skills
provide the intelligence.** v2 adds a third leg: **templates provide the taste**, as
starting points the creator always owns.

## 2. Audit summary (what blocks the goal)

| # | Gap | Evidence |
|---|---|---|
| P0 | Fresh installs of the scoped package are broken. The rename to `@adityadeokar/velora` touched only README/package.json; `init` looks for `node_modules/velora` or `@webprodigies/velora`; generated adapters import `velora/preview`; the guide, skills and templates teach `from 'velora'`. | `src/project/commands.ts:73,118,124,274`, `src/project/services.ts:329`, `src/project/vite.ts:11,28`, `src/project/portable.ts:13`, `src/core/authoring.ts:126`, `scripts/check-installed.mjs:72-99` |
| P0 | The frame cache goes stale when host components/CSS change: the key covers only the recipe and binding files. | `src/export/services.ts:175`, `src/export/commands.ts:164` |
| P0 | Video render holds every PNG in memory; 30 s at 1080p60 is multiple GB, so out-of-memory crashes are likely. | `src/export/commands.ts:313-330`, `src/export/services.ts:316` |
| P0 | Two shipped templates are broken: `survey.tsx` expects a `page` prop the library never passes, and `stage.tsx` has no default export and no WebGL. | `skills/velora/templates/*` |
| P0 | No CI test workflow; GitHub only runs the publish job. | `.github/workflows/publish.yml` |
| Gap | Templates are wiring stubs (4–14 line components); examples render at 320×200; the guide states "no template loader". | `skills/velora/templates`, `tests/examples`, `src/core/authoring.ts:93` |
| Gap | Thin motion vocabulary: 3 easings, with GSAP back/elastic rejected; keyframe paths stop at every waypoint; `perspective` is not animatable (no dolly-zoom); no handheld noise, per-surface blur or true masks. | `src/core/motion.ts:33`, `src/core/gsap.ts` |
| Gap | Output looks "web-recorded": DPR 1, default CRF, no bt709 conversion/tags, no motion blur, no 24 fps, MP4 only. | `src/export/services.ts:48,312`, `src/core/export.ts:9` |
| Gap | No zero-code path: the studio is a single-scene viewer with no template gallery or composition player, and the Next.js studio route has no host children. | `src/preview/index.tsx:36`, `src/project/portable.ts:28` |
| Gap | Editing is approximate: transitions are entering-side only and overlaps are rejected; there are no overlay (V2/V3) tracks, beat sync or SFX. | `src/core/transitions.ts:11-14`, `src/core/timeline.ts:66` |
| Gap | Skills are operational, not creative: no shot vocabulary, editing rhythm, brand or deliverables guidance. | `skills/velora*/SKILL.md` |

## 3. Decisions (confirmed with the maintainer, 2026-10-20)

- Ship **both template families**:
  - real-UI camera/shot templates that wrap the app's actual components or routes;
  - brand-styled motion-graphics templates (titles, logo stings, counters, end cards), so a complete launch film needs no outside tool.
- Studio v2 = **template gallery + quick shots of the live app + param panel + composition player**. Still **no drag-and-drop editor and no browser file writes**: the studio copies exact CLI commands or agent prompts.
- **Any-site** (non-React) support is a **late phase** (09).
- Execution: save this roadmap, implement Phase 00, then stop for review.

## 4. v2 principles (in addition to the v1 global rules in `plan/README.md` §4)

1. **Starting points, not straitjackets.** Templates scaffold plain recipe JSON + TSX into the project ("copy the source in", as shadcn/ui popularized). No hidden runtime template engine. Provenance (`template: {id, version, params}`) is recorded in the recipe so it can be re-scaffolded.
2. **Zero-code wow first, depth on demand.** Every capability has the simplest path first (quick shot), then scaffold, then bespoke.
3. **Preview == export.** Every visual feature renders identically in the studio and in capture. Export-only finishing (bloom, motion blur) must offer a still preview (`velora shot --finish`, `--motion-blur`).
4. **Craft-certified templates.** Every template passes:
   - framing invariants (subject visible, projection plane never crossed, focus on the subject at hero frames);
   - determinism (two renders produce identical frame SHAs);
   - a performance budget;
   - the craft checklist in `TEMPLATE-CATALOG.md`.
5. **Restraint by default.** One motivated move per shot. `intensity: subtle | standard | dramatic`, defaulting to `subtle`. Taste is reached by subtraction.
6. **Clean licensing.** Device frames are CSS-only; no third-party media is bundled; SFX are synthesized procedurally; template IDs never use real people's names (craft lineage is described in docs only, as technique references).
7. **Architecture stays enforced.** New owners and layers are registered in `scripts/check-architecture.mjs` with fixtures. `docs/` stays at two files. Core stays pure; effects stay in services.
8. **Skills move with features.** Each phase updates the skills it affects. A skill never documents unbuilt behavior.

## 5. Craft → feature map

| Inspiration | Technique | Velora feature (phase) |
|---|---|---|
| Hitchcock *Vertigo*, Spielberg *Jaws* | Dolly zoom | Animatable `perspective` (01) + `dolly-zoom` template (02) |
| Roger Deakins | Restraint, motivated movement, one strong composition | Single-move shot builders, subtle defaults (02); cinematography skill (02) |
| Emmanuel Lubezki | Long, fluid, continuous camera | Smooth spline paths with no waypoint stops (01); `monumental-survey` (02) |
| David Fincher | Precise, locked-on, slow push-ins | `hero-push` with framing invariants (02) |
| Stanley Kubrick, Wes Anderson | Symmetry, one-point perspective, whip pans | Symmetry framing option (02), `whip-pan` + motion blur (02/04) |
| Denis Villeneuve, Greig Fraser | Monumental scale | `monumental-survey`, low-angle `crane-down` (02) |
| Apple product films | Macro inserts, light sweeps, exploded views, clean type | `macro-detail` (02), `LightSweep`, `exploded-stack`, `title-reveal` (05) |
| Walter Murch, *Rule of Six* | Emotion > story > rhythm > eye-trace | Editing skill + eye-trace continuity check across cuts (06) |
| Thelma Schoonmaker, Edgar Wright | Rhythmic cutting, match cuts, whip transitions | Beat-snapped cuts, match-cut check, whip transition (06) |
| Editorial J/L cuts | Audio leads or lags picture | Audio offsets in blueprints (06) |
| After Effects | Graph-editor bezier, wiggle, shutter-angle motion blur, track mattes, adjustment layers | `cubicBezier`/spring easings, noise (01); motion blur (04); clip masks (01); Looks (05) |
| Premiere MOGRTs | Parameterized motion-graphics templates | Template manifests with typed params + brand tokens (02/05) |
| DaVinci Resolve | Lift/gamma/gain, LUTs | `LookSchema` grade + `.cube` LUT (05) |
| Screen Studio | Auto-zoom on clicks, smooth cursor, wallpaper backdrops, window inset | `cursor-demo`, `Cursor`, `Backdrop`, `WindowFrame` (05) |
| Rotato | 3D device mockups | `device-showcase`, CSS device frames (05) |
| Linear / Vercel / Stripe / Raycast launch films | Dark UI, glow, grids, kinetic type, spring motion | `Backdrop` grid-floor/glow, `kinetic-statement`, motion personalities (05) |
| Disney multiplane camera | Layered parallax | `parallax-planes` (05) |
| CapCut / social editors | Word-highlight captions, vertical safe zones | `CaptionTrack` styles (06), safe-area overlays (03) |
| Remotion | Schema-driven props, `create-video` starters | Param panel (03), JSON Schemas for editor autocomplete (01), starter (08) |
| Cinema cameras | Focus peaking, frame guides | Focus-peaking + safe-area overlays in the studio (03) |

## 6. Phase map

| Phase | File | Theme | Headline outcome | Depends on |
|---|---|---|---|---|
| 00 | `PHASE-00-stabilize.md` | Stabilize | Scoped install works end to end; cache, memory and template bugs fixed; CI | — |
| 01 | `PHASE-01-motion-engine-v2.md` | Motion Engine v2 | Pro easings, splines, lens language, noise, channels, blur/clip, JSON Schemas | 00 |
| 02 | `PHASE-02-shot-library-and-templates.md` | Shot Library + Templates (Wave 1) | `velora new scene --template hero-push --route /` | 01 |
| 03 | `PHASE-03-studio-v2.md` | Studio v2 | Template gallery, quick shots of the live app, param panel, composition player | 02 |
| 04 | `PHASE-04-master-quality-render.md` | Master-quality render | Supersampling, bt709, 24/25/50 fps, motion blur, WebM/GIF/ProRes-alpha, platform presets | 00 (parallel with 02/03) |
| 05 | `PHASE-05-visual-kit-brand-looks.md` | Visual Kit, Brand, Looks (Wave 2) | Device frames, backdrops, cursor, titles, counters, grade/grain; 18 templates | 01, 02, 04 |
| 06 | `PHASE-06-editorial.md` | Editorial (Wave 3) | Overlay tracks, true A/B transitions, beat sync, SFX, styled captions, launch blueprints | 04, 05 |
| 07 | `PHASE-07-director-skills.md` | Director skills v2 | Intent-first router, craft skills, guide v3, prompt library, agent demos C/D/E | 02–06 |
| 08 | `PHASE-08-launch-kit-and-1-0.md` | Launch Kit + 1.0 | `velora deliver`, docs site + showcase, starter, 1.0 hardening | 06, 07 |
| 09 | `PHASE-09-any-site-mode.md` | Any-site mode | `velora studio --site <url>` for Astro, SvelteKit, Rails and static sites via same-origin proxy | 03, 05 |

```
00 ──► 01 ──► 02 ──► 03 ─────────────► 09
 │             │      │                ▲
 └──► 04 ──────┼──────┼──► 05 ──► 06 ──┤
               └──────┴─────────► 07 ──┴──► 08
```

`TEMPLATE-CATALOG.md` holds every template's technique, slots, params, craft notes and
certification checklist. Phases 02, 05 and 06 implement its waves.

## 7. Success metrics (whole roadmap)

| Metric | Target | Measured by |
|---|---|---|
| Time to first wow | Install → exported cinematic MP4 of the user's real page in ≤ 5 min, zero code | Phase 03 browser journey + fresh-machine smoke |
| Launch film | A 30 s launch film from a blueprint + agent in ≤ 30 min | Phase 07 agent demo C transcript |
| Install health | 100% green install/init/doctor on the 3-OS CI matrix | Phase 00/08 CI |
| Template quality | 100% of templates certified (framing, determinism, budget, craft checklist) | `velora templates check --json` + certification tests |
| Output fidelity | Master renders: bt709-tagged, supersampled, deterministic | Phase 04 tests + ffprobe |
| Honesty | Zero skills or docs describing unbuilt behavior | `velora skills check`, docs-examples test |

## 8. How to execute

- Work phase-sequentially along the dependency graph; Phase 04 may run in parallel with 02/03.
- Every phase file is self-contained: goal → prerequisites → scope in/out → tasks → contracts → files → tests → validation → anti-patterns → Definition of Done.
- After each phase:
  1. Run its **Validation** section.
  2. Run the local umbrella gate (`npm run verify:ci`), plus `verify:release` before any version bump.
  3. Confirm CI is green.
  4. Write `plan/v2/artifacts/phase-NN-exit.md` (commands run, results, evidence, deviations).
- Keep v1 gates green at all times. v2 extends; it never forks owners or adds a second clock, renderer or validator.

## 9. Final status (2026-11-03)

All ten phases are implemented. Each has an exit report in `plan/v2/artifacts/phase-NN-exit.md` with its commands, results, evidence and deviations.

| Phase | Status | Headline evidence |
|---|---|---|
| 00 Stabilize | done | Scoped install, cache invalidation, bounded-memory video, CI |
| 01 Motion Engine v2 | done | Easing library, smooth rails, lens, noise, channels, masks, JSON Schemas |
| 02 Templates (Wave 1) | done | 12 camera templates plus 2 blueprints, certified |
| 03 Studio v2 | done | Gallery, quick shots, param panel, composition player |
| 04 Master render | done | Quality presets, codecs, motion blur, alpha, delivery presets |
| 05 Kit, brand, looks (Wave 2) | done | Kit components, brand, looks, 18 templates |
| 06 Editorial (Wave 3) | done | A/B transitions, overlays, beats, SFX, loudness, review, 6 blueprints |
| 07 Director skills | done | Intent router, `velora-launch`, guide v3, prompt library, demos C/D/E |
| 08 Launch kit and 1.0 | done (maintainer tags 1.0) | `velora deliver`, docs site with a Velora-rendered hero, `velora create`, three-OS CI, size budget, security review |
| 09 Any-site mode | done | `velora studio --site`: a static non-React site rendered to MP4 and delivered, with no React in the project |

Success metrics:
- **Time to first wow:** the README five-minute path is executed command by command by the parser suite, and the starter smoke runs it end to end.
- **Launch film:** demo C scaffolded, beat-snapped, reviewed and drafted a 30 s film.
- **Template quality:** `velora templates check` certifies every template.
- **Honesty:** `velora skills check` plus the parser execution of every skill, README and USER_GUIDE command.
- **Install health on three OSes:** confirmed by the first CI run of the 1.0 branch.

Open for the maintainer:
- the version bump and the 1.0 tag;
- confirming the three-OS CI run;
- enabling GitHub Pages for the website workflow.
