# Demo D — Issue-Fix Log (all detected by real CLI runs, 2026-11-03)

## 1. Capture failed on a busy dev server (product bug, fixed)

The WebM rendered (240 frames, 176 s). The MP4 fallback right after it failed with
`page.waitForLoadState: Timeout 30000ms exceeded` in segment `loop`. The same timeout hit demo E's
storyboard. Each snapshot waited for `networkidle` (500 ms without network), which a Vite dev server
serving route frames to several workers may never reach, and the timeout failed the whole render.
Readiness already belongs to the capture bridge: `seek` awaits every capture-settle hook (RouteFrame
load, fonts, decoded images, video seeks). `networkidle` is now a best-effort 15 s settle that cannot
fail the render. After the fix the MP4 rendered in 80 s.

## 2. Wrong manifest name in the agent's check step

`velora check --video hero.webm --manifest hero.manifest.json` failed with `ERR_VISUAL_MANIFEST`.
Non-MP4 containers keep their extension in the manifest name (`hero.webm.manifest.json`) so variants
never collide; the render envelope's `manifest` field names it. The agent re-ran the check with that
path and both files passed.

## 3. Deliverables

- `hero.webm`: VP9, 1920x1080, 8 s, 608,573 bytes, inside the `website-hero` 4 MB budget (no warnings).
- `hero.mp4`: H.264 fallback, 936,971 bytes.
- `hero.poster.png`: frame 0, which is also the loop seam (`float-loop` returns exactly to its start).
- `velora review --platform website-hero`: no advisories. Both video checks passed: no blank frames,
  flash safety 0 per second. `ADV_BANDING` on the backdrop gradient was accepted.

Embed, as `velora-launch` documents:

```html
<video autoplay muted loop playsinline poster="/hero.poster.png" aria-hidden="true">
  <source src="/hero.webm" type="video/webm">
  <source src="/hero.mp4" type="video/mp4">
</video>
```
