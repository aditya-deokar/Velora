---
name: velora-launch
description: Plan and ship a product launch with Velora — the brief, story structure (Hook, Problem, Reveal, Proof, CTA; AIDA), platform pacing, deliverables per platform, and website hero video practice. Use first for any launch film, feature announcement, social teaser, changelog video, Product Hunt kit or landing-page hero.
license: MIT
version: 0.1.2
when-to-use: A request to announce, launch or promote a product or feature with video; choosing the story, length, platforms and files before any shot is made.
prerequisites:
- velora loaded for routing
- velora init completed in the host app (velora-init)
commands:
- prompts
- templates
- new
- review
- frames
- render
- export
- check
related-skills:
- velora
- velora-templates
- velora-editing
- velora-cinematography
- velora-motion-design
- velora-brand
- velora-looks
- velora-export
not-for: Camera moves inside one shot (velora-cinematography), transition and sound mechanics (velora-editing), or encoder settings (velora-export).
---

# Velora Launch — From Brief to Deliverables

A launch video has one job: make one person understand one thing and act. This skill decides what to make; the craft skills decide how.

## When to Use This Skill

| Request | Prompt | Blueprint or template | Then load |
|---|---|---|---|
| "Launch film", "announcement video" | `launch-film` | `launch-film-30s` | `velora-templates`, `velora-editing` |
| "Announce this feature" | `feature-announcement` | `feature-drop-15s` | `velora-templates`, `velora-editing` |
| "Hero video for the landing page" | `website-hero-loop` | `float-loop`, `scroll-through`, `website-hero-loop-8s` | `velora-templates`, `velora-export` |
| "Vertical teaser", "Reel", "TikTok" | `vertical-teaser` | `social-teaser-9x16` | `velora-editing`, `velora-looks` |
| "Release notes video" | `changelog-video` | `changelog-20s` | `velora-editing` |
| "Product Hunt assets" | `product-hunt-assets` | `product-hunt-kit` | `velora-export` |

`velora prompts show --id <id> --json` prints the full prompt with its `<placeholders>`; fill them from the brief.

## Commands

- `velora prompts ls --json` lists the prompt library; `velora prompts show --id launch-film --json` prints one.
- `velora templates ls --category blueprint --json` lists the launch blueprints.
- `velora new video --blueprint launch-film-30s --id launch --route / --json` scaffolds a film, its `launch.brief.md` and a caption skeleton.
- `velora review --composition launch.composition.json --platform youtube-1080p --json` checks the hook, pacing, reading time and end card for that platform.
- `velora frames --composition launch.composition.json --out board --every 30 --contact-sheet --json` makes the storyboard.
- `velora render --composition launch.composition.json --out launch.mp4 --quality draft --json` renders the draft for review.
- `velora render --composition launch.composition.json --out launch-yt.mp4 --preset youtube-1080p --json` renders a platform deliverable; add `--aspects 16:9,9:16,1:1` for variants and `--poster 1500` for a poster frame.
- `velora check --video launch-yt.mp4 --manifest launch-yt.manifest.json --json` gates each file (flash safety, blank frames, sync).

## Prerequisites

- A written brief (below). Without a single message, no structure will save the film.
- The real UI running in the dev server; the brand file (`velora brand init --json`, see `velora-brand`).
- Licensed music if the film has a bed. Velora bundles none.

## Workflow

The director's workflow. Each step has an exit before the next one starts.

1. **Brief.** Write down: product; audience; the single message (one sentence); platforms; duration; motion personality (`calm`, `crisp`, `playful` or `bold`); must-show features (at most three); the call to action.
2. **Structure.** Pick one:
   - *Hook, Problem, Reveal, Proof, CTA*: the default for launches. The hook lands in the first 2 s, the problem is shown on the real UI, the reveal is the product as an object, the proof is a number or a quote, the CTA holds.
   - *AIDA* (Attention, Interest, Desire, Action): for feature drops where the problem is already known.
   - *Before/after*: for redesigns (`split-compare`).
3. **Shot list.** Scaffold the blueprint and edit `<id>.brief.md`: one template per beat, or a bespoke shot (`velora-scenes`). Vary shot size and movement between neighbouring shots.
4. **Storyboard.** `velora frames --contact-sheet` before refining. Read it as a sequence: does each frame say something new?
5. **Refine.** Replace placeholders with real components, rewrite copy and captions, set the brand.
6. **Draft.** `--quality draft`, watched at full speed with sound.
7. **Review.** `velora review` for the target platform, then `velora check --video`. Fix or consciously accept every advisory.
8. **Taste review.** A person watches the draft. Advisories never replace this.
9. **Master.** `--quality master` (or a delivery preset).
10. **Deliver.** One render per platform preset (below), each checked.

### Platform pacing

`velora review --platform <preset>` uses these shot-length windows.

| Platform class | Presets | Shot length | First 2 s |
|---|---|---|---|
| Vertical short-form | `tiktok`, `instagram-reel`, `youtube-shorts` | 0.8-4 s | must read muted |
| Feed (landscape, square, 4:5) | `x-landscape`, `x-square`, `linkedin`, `instagram-feed-4x5` | 1-7 s | must read muted |
| YouTube | `youtube-1080p`, `youtube-4k` | 2-10 s | hook still matters |
| Website hero | `website-hero` | 3-20 s | no hook; a calm loop |
| Default (no platform) | — | 1.5-8 s | — |

### Deliverables per platform

| Target | Preset | File |
|---|---|---|
| YouTube | `youtube-1080p` | MP4 master, 24 or 60 fps |
| X / LinkedIn | `x-landscape`, `x-square`, `linkedin` | MP4 with burned-in or styled captions |
| Reels / TikTok / Shorts | `instagram-reel`, `tiktok`, `youtube-shorts` | 1080x1920 MP4, text inside the safe zones |
| Landing page | `website-hero` | WebM (VP9) plus an H.264 MP4 fallback and a poster |
| README | `github-readme-gif` | GIF under 10 MB |
| Link previews | `og-image` | the `--poster` PNG |
| Product Hunt | `product-hunt-gallery` | MP4 gallery video plus stills |

Each preset carries size and duration budgets; the render reports warnings when a file exceeds them.

### Website hero practice

- Keep it short (8-15 s), calm and seamless: `float-loop` returns exactly to its first frame; `velora review` flags a loop seam.
- Render the WebM with `--preset website-hero`, then an MP4 fallback with `--codec h264`, and a poster with `--poster 0` so the first paint is the first frame.
- Respect the size budget (about 4 MB for the WebM). Lower `--quality` or the duration before lowering the resolution.
- Embed muted, looping and inline, with the poster and a reduced-motion fallback:

```html
<video autoplay muted loop playsinline poster="/hero.poster.png" aria-hidden="true">
  <source src="/hero.webm" type="video/webm">
  <source src="/hero.mp4" type="video/mp4">
</video>
<style>@media (prefers-reduced-motion: reduce) { video[autoplay] { display: none; } }</style>
```

  Show the poster image in place of the video when motion is reduced.

## Worked Example

```bash
velora prompts show --id launch-film --json
velora new video --blueprint launch-film-30s --id launch --route / --json
velora frames --composition launch.composition.json --out board --every 30 --contact-sheet --json
velora review --composition launch.composition.json --platform youtube-1080p --json
velora render --composition launch.composition.json --out launch.mp4 --quality draft --json
velora render --composition launch.composition.json --out launch-yt.mp4 --preset youtube-1080p --poster 1500 --json
velora check --video launch-yt.mp4 --manifest launch-yt.manifest.json --json
```

Expected: a scaffolded 30 s film whose brief names each beat, a storyboard image, a review with no advisories (or advisories you accepted on purpose), a draft for the taste review, then a checked YouTube master with its poster.

## Anti-Patterns

- Starting with shots before the brief has a single message.
- Three CTAs, or a CTA on screen for less than 2 s.
- One cut of the film for every platform: a 16:9 film cropped to 9:16 loses its text to the platform UI.
- A website hero with a hook, a cut every second or sound.
- Shipping the draft render, or a master nobody watched with sound.

## Troubleshooting

- `ADV_HOOK_LATE`: move the first readable title or the product into the first 2 s.
- `ADV_SHOT_LENGTH` on a feed platform: split the shot, or review against the platform you actually post to.
- `ADV_READING_TIME`: shorten the copy before lengthening the shot.
- A size warning on `website-hero`: shorten the loop or lower `--quality`, then re-render.
- `ERR_PROMPT_NOT_FOUND`: run `velora prompts ls --json` for the IDs.

## Validation

- The brief names the single message, platforms and CTA.
- `velora review --platform <preset>` is clean or every advisory is accepted on purpose.
- Every deliverable passes `velora check --video` and sits within its preset's budgets.
- A person has watched the draft with sound.

## Craft Notes

The structure comes from advertising and trailer editing: AIDA dates from early twentieth-century sales copy, and the problem-to-reveal arc is the standard shape of product keynotes and launch trailers. Social pacing follows how feeds are watched: muted first, decided in about two seconds. These are working conventions to start from, not rules; a clear single message beats any structure.

## Related Skills

- `velora-templates`: blueprints and shot templates.
- `velora-editing`: transitions, rhythm, sound, captions and review.
- `velora-cinematography`: shot size, angle, lens and movement.
- `velora-motion-design`: titles, stats and end cards.
- `velora-brand` and `velora-looks`: tokens, motion personality and grade.
- `velora-export`: codecs, quality and delivery presets.

## When NOT to Use This Skill

- Do not use it for a single cinematic shot of a page; go to `velora-templates` and `velora-cinematography`.
- Do not use it for encoder flags or alpha output; load `velora-export`.
- Do not treat the pacing tables as gates; they are review prompts for a human.
