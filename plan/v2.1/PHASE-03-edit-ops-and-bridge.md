# Phase 03 — Edit operations, CLI parity and the edit bridge

## Goal
One typed, pure edit vocabulary that the CLI, coding agents and the editor all share. It persists
through a local channel that is safe by construction. After this phase, an agent can do
headlessly everything the editor will later do by hand, and the editor (04) is "just" a UI over
these operations.

## Prerequisites
- Phase 01. Clip, path, link and constraint ops land when Phase 02 does; until then they are rejected with `ERR_EDIT_UNSUPPORTED`.
- Spike S2 verdict (bridge transport).
- Decision D1 confirmed.

## Scope IN
- `src/core/edit.ts` (`EditOpSchema`, `applyEdits`, inverse ops, coalescing).
- A formatting-preserving JSON writer.
- The `velora edit` CLI family.
- The loopback bridge server (HTTP plus event stream) with its security model; the file watcher; any-site integration.
- The `velora-editor` skill (first version).

## Scope OUT
- Browser UI (04+).
- Codemods on TSX (08).
- Composition ops (10, which extends the same vocabulary).

## Tasks

### 03.1 Edit vocabulary — new core owner `src/core/edit.ts`
- **Addressing:**
  - A track by `TrackRef { target, property }`, the existing uniqueness key in `MotionSchema`.
  - A keyframe by `{ track, atMs }`. Keyframe times are already strictly increasing and distinct, so this is unique and needs no ids in files.
  - A clip by id, a link by its `to` ref, a constraint by index plus kind.
- **Ops** (zod discriminated union on `op`):

  | Group | Ops |
  |---|---|
  | Keyframes | `key.set {track, atMs, value, easing?}` (upsert), `key.remove`, `key.move {track, fromMs, toMs}`, `key.ease {track, atMs, easing}`, `keys.shift {refs[], deltaMs}`, `keys.scale {refs[], pivotMs, factor}`, `keys.reverse {refs[]}` |
  | Tracks | `track.add {target, property, keyframes, interpolation?, ease?, unit?}`, `track.remove`, `track.options {interpolation?, ease?, noise?, rove?, orient?}` |
  | Scene base | `camera.set {property, value}`, `focus.set {property, value}`, `node.ensure {id}`, `node.remove {id}` (refused while tracks target it), `motion.set {durationMs?, speed?, loop?}`, `look.set {look?}` |
  | Structure (02) | `clip.create {id, from: refs[] \| tracks}`, `clip.update {id, startMs?, speed?, inMs?, durationMs?, loop?, ease?, mode?, label?}`, `clip.dissolve {id, bake?: {samplesPerSecond}}`, `stagger.set {clipId, members, eachMs, order, ease?}`, `link.set`, `link.remove`, `constraint.set`, `constraint.remove`, `path.fromAxes {target}` (x/y/z tracks to a position path), `path.tangent {track, atMs, inTangent?, outTangent?}` |
  | Metadata | `editor.set {labels?, colors?, locked?, markers?}` |

- `applyEdits(recipe, ops)` returns either `{ ok: true, recipe, inverse: EditOp[], touched: string[] }` or `{ ok: false, issues }`:
  - **Atomic:** the whole batch applies, or nothing does.
  - The result must pass `SceneRecipeSchema` **and** `presentPreview`. Issue paths point at the op index that caused them (`ops.3.atMs`).
  - Adding the first track on a surface missing from `scene.nodes` inserts `node.ensure` automatically and records it in `inverse`.
  - `key.set` beyond `motion.durationMs` fails with a hint, unless the batch also contains `motion.set` extending the duration.
- `invert` is exact: applying `inverse` to the result yields a recipe deep-equal to the input. The formatter (03.2) makes that byte-equal on disk.
- `coalesce(prev, next)` merges consecutive transient ops on the same target (drag gestures) into one history entry.
- `describeOp(op)` returns a human label ("Move headline x keyframe 1.20 s → 1.35 s") for history and logs.

### 03.2 Formatting-preserving writer — `src/core/json.ts`
- `formatJsonDocument(originalText, nextValue)` is pure. Its rules:
  - existing keys keep their order; new keys follow canonical schema order;
  - detected indentation (default 2 spaces), line endings (LF or CRLF) and trailing-newline state are preserved;
  - a BOM is preserved, matching `parseJsonDocument`;
  - numbers are written in shortest round-trip form;
  - untouched subtrees are copied **verbatim from the original text**, including the large `snapshot` data URL.
- No-op guarantee: `formatJsonDocument(text, parseJsonDocument(text))` equals `text`, byte for byte, for the whole Phase 00 corpus.

### 03.3 CLI — `velora edit` (new owner `executeEditCommand` in `src/project/edit.ts`, commands layer)
Every subcommand except the bridge is **dry-run by default**: it prints the resulting diff, validation and `describeOp` labels, and writes only with `--write`. This follows `velora compose snap`.

| Command | Purpose |
|---|---|
| `velora edit ls --scene <id> [--at <ms>] --json` | Tracks, clips, links, constraints and keyframes, optionally with evaluated values at a time |
| `velora edit apply --scene <id> --ops <file\|-> [--expect-sha <sha>] [--write] --json` | Generic: any `EditOp[]` |
| `velora edit key --scene <id> --track camera.z --at 1200 --value 400 [--ease cubic.out] [--write]` | Ergonomic upsert |
| `velora edit ease --scene <id> --track headline.x --at 0 --ease '{"cubicBezier":[0.33,0,0.67,1]}' [--write]` | Set segment easing |
| `velora edit [--scene <id>] [--port <n>] [--read-only] [--no-open]` | Start the bridge and open the editor (03.4) |

- Track shorthand `camera.z`, `focus.distance`, `<surface>.<prop>`, `style:<surface>.--accent`, `channel:<id>` parses to a `TrackRef` with clear errors.
- **Writes:** `atomicWrite(root, target, content, expected)` (`src/project/services.ts`) with the read SHA as the compare-and-swap guard. `--expect-sha` lets agents fail fast when the editor saved in between.
- **Errors** (added to the catalog in `src/core/cli-schema.ts`, each with a hint and next commands):
  - `ERR_EDIT_INVALID` (op validation);
  - `ERR_EDIT_CONFLICT` (SHA mismatch);
  - `ERR_EDIT_TARGET` (unknown scene, track or keyframe);
  - `ERR_EDIT_UNSUPPORTED` (op not yet available);
  - `ERR_BRIDGE_*` (03.4).
- Add `CLI_COMMANDS` entries (skill `velora-editor`) and `--help` text.

### 03.4 The edit bridge — `src/project/services/bridge.ts` (services) plus policy in `src/project/edit.ts`
**Startup:**
1. Resolve the project and verify the dev server, reusing the `open-preview` verification in `executeProjectCommand`.
2. Bind `127.0.0.1` on a free or given port and generate a 256-bit token (`crypto.randomBytes(32)`, base64url).
3. Open `<dev origin><studio route>?velora-preview=1&velora-scene=<id>&velora-edit=1#velora-bridge=<port>.<token>` (or print it with `--no-open`).

The process runs until Ctrl+C, or until 30 minutes of idle time with no connected editor.

**Endpoints (v1, JSON):**

| Method and path | Purpose | Responses |
|---|---|---|
| `GET /v1/hello` | version, projectId, readOnly, capabilities, allowed file kinds | 200 |
| `GET /v1/scenes/:id` | `{ text, sha256, recipe }` | 200, 404 |
| `POST /v1/scenes/:id/edits` | `{ baseSha, ops, label }` | 200 `{ sha, inverse }`, 409 `{ sha, text }` (conflict), 422 `{ issues }` |
| `GET /v1/events` | streaming `fetch` (text/event-stream) | `file-changed {path, sha}`, `bridge-closing` |

Later phases add `/v1/presets`, `/v1/source/*`, `/v1/compositions/*` and `/v1/media/peaks` under the same rules.

**Security** (each rule has a test in `tests/project/security.test.ts`):
1. Loopback bind only; refuse `0.0.0.0` and `::`.
2. `Authorization: Bearer <token>` with a constant-time compare. The token never appears in query strings or logs.
3. `Origin` must equal the verified dev origin (or the any-site studio origin). Preflight answers only that origin, and other origins get 403 with no CORS headers.
4. `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding defense).
5. Body ≤ 1 MB; ≤ 2,000 ops per request; JSON content type only.
6. Allowed targets only:
   - `src/velora/scenes/<id>.scene.json`;
   - root `*.composition.json` (10);
   - `src/velora/presets/<id>.preset.json` (07).

   Resolved through `scopedPath`, so symlinks and traversal are refused.
7. Every write is compare-and-swap and atomic. `--read-only` refuses all writes (405).
8. Every write is logged with path, SHA before and after, and op labels (JSON lines with `--json`).

### 03.5 Watcher
- `fs.watch` on `src/velora/scenes/`, the project root (compositions) and presets, debounced (100 ms). Atomic renames are normalized, which matters on Windows.
- The watcher emits `file-changed` with the new SHA. The editor (04) uses it to detect agent and IDE edits.

### 03.6 Any-site mode
- `velora studio --site <url> --edit` hosts the bridge in the studio process. The allowed Origin is the studio origin, and the editor URL uses `/__velora/`.

### 03.7 Skill — `skills/velora-editor/SKILL.md` (new; listed in the router)
- When to use the CLI ops instead of rewriting JSON by hand: small, surgical, diffable edits with exact undo.
- The dry-run → `--write` loop.
- `--expect-sha` etiquette while a human has the editor open: re-read, then apply; never overwrite.
- The track shorthand and the op table.

## Contracts
- `EditOpSchema` (above), `applyEdits`, `formatJsonDocument`.
- `velora edit` subcommands and JSON envelopes.
- Bridge protocol v1. Additive changes only; breaking changes bump `/v2`.

## Files
- New: `src/core/edit.ts`, `src/project/edit.ts`, `src/project/services/bridge.ts`, `skills/velora-editor/SKILL.md`
- Modified: `src/core/json.ts`, `src/core/cli-schema.ts`, `src/cli/index.ts`, `src/project/commands.ts` (studio `--edit`), `scripts/check-architecture.mjs` (owners `EditOpSchema`, `applyEdits`, `formatJsonDocument`, `executeEditCommand`; the `src/project/edit.ts` commands regex), `skills/velora/SKILL.md` (router row)

## Tests
- `tests/core/edit.test.ts`:
  - **property tests:** random op sequences over the golden corpus. Each batch is rejected atomically or produces a valid recipe, and `apply(inverse(apply(x)))` deep-equals `x`;
  - `node.ensure` insertion; duration guard; `coalesce` rules; `describeOp` labels.
- `tests/core/json-format.test.ts`:
  - no-op byte identity over the whole corpus, plus CRLF, BOM, 4-space and tab fixtures;
  - minimal diffs: one changed keyframe changes exactly the lines that contain it;
  - snapshot bytes untouched.
- `tests/cli/edit.test.ts`:
  - dry run leaves the file unchanged; `--write` writes once;
  - `--expect-sha` conflict returns `ERR_EDIT_CONFLICT`;
  - track shorthand errors; JSON envelopes; exit codes.
- `tests/project/security.test.ts` (extended): token missing or wrong, foreign Origin, bad Host, oversized body, too many ops, path traversal, symlinked scene file, read-only mode, non-loopback bind refused.
- `tests/project/bridge.test.ts`:
  - hello, read, edit and conflict round-trip;
  - watcher events for an external write, including the rename-based atomic write on Windows in the CI matrix.

## Validation criteria
- [ ] Run against `local-project/` (a Vite host):
  1. `velora edit key … --write` adds a keyframe;
  2. HMR updates the open studio;
  3. `velora edit apply --ops <inverse>` restores the file byte-identically.
- [ ] Bridge security suite 100% green on Linux, Windows and macOS.
- [ ] The formatter's no-op identity holds for every committed recipe and composition.

## Anti-patterns
- Ops addressing keyframes by array index (fragile across concurrent edits).
- Reformatting whole files on write, or dropping or reordering author keys.
- Opening the bridge on a non-loopback interface, accepting the token in a URL query, or logging it.
- A second validator inside the bridge. Validation is `applyEdits`, which uses the existing owners.

## Definition of Done
Tests and validation green, the `velora-editor` skill installed and checked, error catalog
updated, and `plan/v2.1/artifacts/phase-03-exit.md` written.
