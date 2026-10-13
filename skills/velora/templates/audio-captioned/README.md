# Audio Captioned Template

Copy `captioned.composition.json` plus `subs.srt` into the project, add your audio file to `assets/` and declare it in `audio`, then run `velora captions validate --file subs.srt --json` and `velora captions check --composition captioned.composition.json --json`.
