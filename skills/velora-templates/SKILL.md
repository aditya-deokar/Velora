---
name: velora-templates
description: Start a cinematic scene or a whole reel from a certified camera template, slotting the app's real component or route. Use when the request matches a known shot (push-in, orbit, scroll-through, dolly zoom, rack focus, website hero loop).
license: MIT
version: 0.1.2
when-to-use: A request that maps to a known shot or reel, a user who wants a fast first result, or an agent choosing a starting point before refining camera, lens and focus.
prerequisites:
- velora init completed (velora doctor --json green)
- The real page route or component path the shot should feature
commands:
- templates
- new
- shot
- scenes
related-skills:
- velora
- velora-cinematography
- velora-scenes
- velora-composition
- velora-render
- velora-launch
- velora-motion-design
- velora-editing
not-for: A bespoke shot that no template describes, layered multi-surface choreography, titles or motion graphics; use velora-scenes and author the recipe directly.
---

# Velora Templates — Certified Starting Points

Templates are camera moves that are already tuned and checked. `velora new` copies a plain recipe and binding into the project. The files are the creator's from that moment on: nothing at runtime depends on the template.

## When to Use This Skill

Use a template when the request names or implies a known shot. Pick one from the intent table:

| Request sounds like | Template | Then consider |
|---|---|---|
| "open the video on our product", "hero shot" | `hero-push` | `tilt-up-reveal`, `crane-down` |
| "make this page feel huge / epic" | `monumental-survey` | `dolly-zoom` |
| "turntable", "reveal the product" | `orbit-reveal` | `hero-push` |
| "show the whole landing page" | `scroll-through` | `float-loop` |
| "highlight this metric / button" | `macro-detail` | `rack-focus` |
| "draw attention without moving" | `rack-focus` | `macro-detail` |
| "background video for our website hero" | `float-loop` or blueprint `website-hero-loop-8s` | `scroll-through` |
| "energetic social clip" | `handheld-push` | `whip-pan` |
| "vertigo", "unsettling emphasis" | `dolly-zoom` | `monumental-survey` |
| "a 20-second product reel" | blueprint `product-reel-20s` | individual templates |

Every template is certified: in each supported aspect (16:9, 21:9, 1:1, 4:5, 9:16) and at every intensity, the subject stays framed, stays clear of the camera plane, and ends in focus.

## Commands

- `velora templates ls --json` lists templates and blueprints. Filter with `velora templates ls --tag loop --json`, `--category camera` or `--aspect 9:16`.
- `velora templates show --id hero-push --json` shows params (type, range, default), craft notes, pairings and example commands.
- `velora templates check --json` re-runs framing certification for every template.
- `velora new scene --template hero-push --id home-hero --route / --json` frames a page of the running app (zero code).
- `velora new scene --template orbit-reveal --id dash-orbit --component src/components/Dashboard.tsx#Dashboard --set intensity=standard --json` slots a real component (omit `#Export` for a default export).
- `velora new video --blueprint product-reel-20s --id reel --route / --json` writes a composition plus one scene pair per shot.
- `velora shot --scene home-hero --time 3000 --out home-hero.png --json` proves a frame.

## In the Studio (zero code)

Open the app with `?velora-preview=1`, then choose the Templates tab. Each card shows a storyboard of the move. Select **Try on your app** to see the template applied to the live app, then tune its params in the panel. The quick-shot URL holds the whole shot:

- **Copy export command** gives `npx velora export --url '<quick-shot url>' --output <id>.mp4 --width W --height H --fps 30`. It exports the MP4 without writing any source file.
- **Copy scaffold command** gives the exact `velora new scene` command, so the shot becomes editable recipe files.
- **Copy agent prompt** hands the same command to a coding agent.

The Compositions tab plays a `*.composition.json` with its audio and captions. Use Space, J/K/L, the arrows and `[`/`]` to review the cut. The studio never writes files; the CLI owns the source.

## Prerequisites

- `velora init` has run. `velora new` refuses an uninitialized project with `not-initialized`.
- For `--route`: the app's dev server serves that path on its own origin and allows same-origin framing in development.
- For `--component`: the file exports the component. Note which providers (theme, data, router) it needs.

## Workflow

1. Map the request to a template with the table above, or with `velora templates ls --json`.
2. Choose the slot:
   - `--route` for zero code (works in every host, including Next.js);
   - `--component` for the real React subtree, which needs its providers wrapped in the binding.
3. Choose the aspect for the destination: 16:9 web or YouTube, 9:16 social vertical, 1:1 or 4:5 feeds, 21:9 cinematic banners.
4. Keep `intensity=subtle` unless the brief asks for drama. Restraint reads as confidence.
5. Run `velora new scene` and read `warnings` (`WARN_TEMPLATE_PLACEHOLDER` means no slot was given).
6. In non-Vite hosts run `velora sync --json`.
7. Prove it with `velora shot` at the start, middle and end, then review in the studio.
8. Refine by editing the recipe directly: camera values, lens (`perspective`), focus, durations. The provenance block records what the template produced.

## Worked Example

```bash
velora templates show --id macro-detail --json
velora new scene --template macro-detail --id revenue-detail --component src/components/Revenue.tsx#Revenue --set focusRegion=40,30,420,180 --set lens=85 --json
velora shot --scene revenue-detail --time 0 --out start.png --json
velora shot --scene revenue-detail --time 6000 --out end.png --json
```

Expected:
- `start.png` frames the 420×180 region at macro distance and in sharp focus.
- `end.png` shows the whole component, with the region still sharp.

The generated binding imports `Revenue` and wraps it in `Surface id="subject"`. Add the component's providers where the `TODO(velora)` comment says.

## Anti-Patterns

- Treating a template as fixed. Templates are starting points; edit the recipe until the shot serves the story.
- The same template for every scene of a film. Vary shot families (push, detail, survey, arc) so the cut has rhythm.
- `dramatic` intensity everywhere. Save it for one beat.
- Recreating the app's UI in the binding instead of slotting the real component or route.
- Overwriting by hand-deleting files to "re-run" a template; choose a new `--id` and compare.

## Troubleshooting

- `ERR_TEMPLATE_NOT_FOUND`: list IDs with `velora templates ls --json`. Blueprints use `velora new video`.
- `ERR_TEMPLATE_PARAM`: `velora templates show --id <id> --json` lists every param's type and range. Regions are `x,y,width,height` in subject pixels.
- `ERR_TEMPLATE_ASPECT`: use an aspect the template lists.
- `ERR_COMPONENT_EXPORT_MISSING`: check the path (project-relative) and the export name; default exports need no `#`.
- `ERR_ROUTE_INVALID`: routes are same-origin paths such as `/pricing`; full URLs are refused. In Git Bash on Windows, an argument starting with `/` is rewritten into a Windows path before Velora sees it. Prefix the command with `MSYS_NO_PATHCONV=1` or run it from PowerShell or cmd.
- `ERR_ROUTE_FRAME_BLOCKED` in the studio or capture: the route redirected off-origin or the dev server forbids framing. Allow same-origin framing in development, or use `--component`.
- `ERR_SCENE_EXISTS`: pick another `--id`. `velora new` never overwrites.

## Validation

- `velora templates check --json` reports every template certified.
- `velora scenes --json` lists the new scene; `velora validate --json` passes.
- `velora shot` frames at the start, middle and end show the subject framed and the focus region sharp at the end.
- A human reviews taste: one motivated move, readable at output size, an intentional settle.

## Craft Notes

Template IDs name techniques, not people. Each one packages a camera convention described in `velora-cinematography` (push-in, survey, orbit, crane, rack focus, dolly zoom, whip) or a motion-graphics convention described in `velora-motion-design`, with restrained defaults. They are starting points: the brief and the person's direction override them.

## Related Skills

- `velora-cinematography`: why each move works, and how to refine camera, lens and focus by hand.
- `velora-scenes`: recipe and binding rules for editing what was scaffolded.
- `velora-composition`: editing the composition a blueprint wrote.
- `velora-render`: frames, shots and contact evidence.
- `velora`: root router.
- `velora-launch`: which blueprint fits a launch intent.
- `velora-motion-design`: Wave 2 graphics and layered templates.
- `velora-editing`: blueprints after scaffolding (transitions, rhythm, sound).

## When NOT to Use This Skill

- Do not force a template onto a request for a unique shot; author it with `velora-scenes`.
- Do not use templates for titles, logos or end cards. Motion-graphics templates arrive in a later release, and until then that work belongs in `velora-typography`.
- Do not use `--route` for a page that needs logged-in state the dev server cannot reproduce. Use `--component` with fixture providers instead.
