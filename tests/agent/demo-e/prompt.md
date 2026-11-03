# Demo E — Starting Prompt (vertical teaser, any skill-compatible agent)

The prompt is `velora prompts show --id vertical-teaser` with `<platform>` = TikTok, `<product>` =
Fieldnote and the bed at assets/music.wav.

> Read VELORA.md and run npx velora guide --json in this project, then start from the installed
> velora/SKILL.md and follow its intent router. Make a 9:16 social teaser for TikTok about Fieldnote.
> Start from the social-teaser-9x16 blueprint (velora new video --blueprint social-teaser-9x16 --id
> teaser --route /). Hook in the first second, keep shots short, and write karaoke captions for every
> line of the voiceover or on-screen story into the caption file. Detect beats in assets/music.wav and
> snap cuts with velora compose snap --to beats --write. Keep text inside the platform safe zones. Prove
> each shot with velora shot or velora frames --contact-sheet, read the PNGs, and fix what you see
> before rendering. Run velora review --platform tiktok.
