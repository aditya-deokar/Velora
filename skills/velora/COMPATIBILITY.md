# Velora Skills — Agent Compatibility

Core stays agent-neutral: every command supports `--help` and `--json`, stable exit codes (`0` ok, `1` operational failure, `2` usage error), and machine-readable `code`, `path`, `message`, plus `hint` and `next`. No command prompts; pipes and `NO_COLOR` stay plain.

## Skill paths

- Packaged source: `<package>/skills` containing `velora/SKILL.md` plus `velora-*/SKILL.md`.
- Install target: any directory you own, for example `./.skills`, `~/.claude/skills`, or a repo-local skills folder.
- Install: `velora skills install --dir <path> --json`. Re-running is byte-identical; differing files fail with `ERR_SKILL_CONFLICT`.
- List: `velora skills ls --dir <path> --json` shows available, installed, and version drift.
- Check: `velora skills check --dir <path> --json` validates front-matter, required sections, command refs, and skill cross-links.

## Per-agent setup

Do not let the CLI overwrite `AGENTS.md`, `CLAUDE.md`, or provider config. `velora skills install --agent <name> --dir <path> --json` prints a registration snippet and verifies with `velora skills check --dir <path> --json`; you apply the snippet in your agent's own configuration.

- Claude Code: add the install directory as a skill source (for example a repo-local `.claude/skills` entry or your user skill directory), then restart the session. Start with `velora/SKILL.md`.
- Codex: add the install directory to the agent's skill search paths in its configuration, then start a new session.
- Cursor: add the install directory to the agent's skill configuration, then start a new session.
- Generic: expose the install directory as skills and load `velora/SKILL.md` first.

Prompt snippet for `--json`-first agents:

```
Load velora/SKILL.md from the installed skills directory first. Prefer --json for every Velora command and follow the routing table to load only the next skill. Verify with velora skills check --dir <path> --json.
```

## Version pinning

Every `SKILL.md` front-matter `version` pins the CLI version it was written against as `X.Y.Z`. `velora skills check` reports `ERR_SKILL_VERSION` when the installed skill differs from the running CLI; re-run the install to refresh. `skills-lock.json` records the packaged skill versions for review.

## Compatibility matrix

| Surface | Supported |
|---|---|
| Agents | Claude Code, Codex CLI, Cursor, generic skill-compatible agents |
| React | DOM 18.2+ or 19 (Next.js App/Pages Router, Vite, portable wrapper, Electron renderer) |
| Node | 22.12+ for the CLI |
| FFmpeg | Required for audio mix, caption burn, MP4 encode, and audio probing |
| Chromium | Required via Playwright for capture, snapshots, and video sampling |
| AI auth | Bring your own agent subscription — Velora runs no agent and stores no keys |

## Limits (honest scope)

Local-first React DOM only: no React Native without DOM, no hosted service or
accounts, no visual builder or focus-position editor, no text-to-speech or
transcription, no universal quality or performance promises (evidence is
device- and scene-specific), and no artistic scoring (`velora check` is
technical; handoff always records `requiresVisualReview: true`). Ewmotion
integration is deferred until a real source exists. The dual command name
`flute`/`velora` runs the same CLI; recipes stay at version 1 with focus
version 3, and older wrappers upgrade via `velora init`.
