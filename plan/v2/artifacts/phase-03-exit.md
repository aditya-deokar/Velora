# Phase 3 Exit — Studio v2

Status: implemented, uncommitted. Date: 2026-10-27.

## Delivered

- **Library tabs** Scenes | Templates | Compositions, kept in the URL (`velora-tab`); back, forward and reload restore the view.
- **`TemplateGallery`:**
  - Schematic SVG storyboards: the subject plane projected at start, middle and end via the new core `projectSubject`.
  - One live mini preview, only on the hovered or focused card.
  - Tag and aspect filters, plus blueprint cards.
- **`QuickShot`:**
  - The live app (host children, now forwarded by `ProjectPreview`) or a `RouteFrame` fills the template subject.
  - The URL contract (`velora-quick`, `velora-route`, `velora-params` base64url) lives in core `src/core/quickshot.ts`.
- **`ParamPanel`:**
  - Controls are generated from typed params, plus aspect and route.
  - Edits go to a draft and reach the URL once per animation frame.
  - Copy actions for the scaffold command, export command and agent prompt. No file writes.
- **`CompositionPlayer`:**
  - One `usePreviewSession` cursor, using timeline mode and a new signed shuttle `rate`.
  - The next segment is preloaded; gaps render as void.
  - Captions via `parseCaptions`; audio follows the cursor via `syncMedia` (50 ms resync).
  - Segment strip with thumbnails and transition markers.
- **Keyboard transport** (`useTransportKeys`): Space, J/K/L (1x/2x/4x), ←/→ frame, Shift+←/→ second, `[`/`]`, Home/End. Used by `ScenePreview` and the player.
- **Guides** (`StudioOverlays`): thirds, title/action safe, approximate 9:16 zones, aspect crop, focus peaking. Chrome-marked, held in memory only.
- **Adapters:**
  - The Vite adapter adds DEV-only `compositionModules` and `assetUrls`, and `init` upgrades the pre-studio bytes.
  - `velora sync` registers root compositions in portable catalogs, leaving the connection component unchanged.

## Verification

| Gate | Result |
|---|---|
| typecheck, lint:architecture | pass |
| test:architecture | 147 pass |
| test:core | 533 pass (incl. new `quickshot`) |
| test:react | 51 pass |
| test:launch | 448 pass (new: gallery, quick-shot, composition-player, adapter upgrade, portable compositions) |
| test:export | 238 pass |
| test:release | 41 pass |
| test:browser | 10 pass |
| test:skills | 17 green |
| test:installed | pass (production exclusion intact) |
| test:library (functional, `VELORA_VERIFY_HARDWARE=0`) | pass |

**Hardware scroll budget fails on this machine for the HEAD baseline too.** A HEAD worktree measured 9.8 fps against a 55 fps budget, and the Phase 3 tree measured 8–26 fps. The gap is local GPU/load, not Phase 3. Re-measure before release.

## Browser journey (installed tarball, fresh Vite app)

| Check | Result |
|---|---|
| Re-running `init` | Upgraded the Phase 2 adapter in place. |
| Gallery | 12 cards, 0 live previews idle, 1 on hover. |
| Quick shot edits | `hero-push` with lens 35 and intensity standard: the URL updates, and the shot survives reload. |
| Zero-code export | `velora export --url '<quick-shot url>' --output quick-hero.mp4 --width 1920 --height 1080 --fps 30` exported a 1920×1080, 30 fps, 180-frame MP4 in 45 s. No scene files were written (16 before and after). |
| Exported frames | No guides and no panel. |
| Player | `]` jumps, frame step and `L` shuttle all advanced the single cursor. No page errors. |

Screenshots (gallery, quick shot with guides, player, exported frame) are in the session scratchpad `shots3/`.

## Bugs found and fixed during verification

- Two param edits in one frame lost the first. Fixed with an immediate draft state.
- The Guides panel was clipped by the scrollable controls and covered by the live app. It is now fixed-positioned.
- Host CSS (the Vite starter's `#root` text-align and heading colors) leaked into cards and the panel. Studio now sets explicit colors.
- The player frame overlapped its controls. It now reserves space above them.

## Deviations and open items

- **Audio in portable hosts.** Next.js and generic React hosts get compositions but no `assetUrls`, since their bundlers don't import audio without loaders. The player there shows picture and captions only.
- **Audio drift.** Drift logic is unit-tested with fake media elements. A 30 s real-audio drift measurement was not run (the smoke reel has no audio).
- **Next.js.** The route picker for Next is covered by a jsdom test, not a real Next fixture run.
- **Performance evidence.** Gallery idle cost is structural (0 live scenes when idle). Frame-budget numbers were not recorded, given the hardware state above.
- **Transitions** are strip markers only; A/B compositing is Phase 6.
