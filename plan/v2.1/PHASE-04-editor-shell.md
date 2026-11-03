# Phase 04 — Editor shell: Edit mode, layers, inspector and history

## Goal
Open any scene in **Edit** mode on the live app. Select a layer and switch on a property's
stopwatch to animate it. Change values at the playhead, undo and redo, and see the recipe file
update on disk while the preview stays live. This phase delivers the frame of the editor:
- edit-mode entry, layout and store;
- bridge client, layers panel and inspector;
- history, save and conflict states, and the command registry.

The timeline (05) and viewport tools (06) plug into it.

## Prerequisites
- Phase 03 (ops, formatter, bridge).
- Spike S5 (lazy chunk) verdict.
- `EDITOR-UX.md` §§1–4, 6–7.

## Scope IN
- `velora-edit=1` entry; lazy `EditMode`; `ScenePreview` editor slots.
- Editor store, bridge client, layers panel, inspector (all property kinds from Phases 01 and 02), advisories.
- Command registry and palette, history panel, read-only fallback, accessibility baseline.
- Updates to `docs/product.md` and `docs/architecture.md`.

## Scope OUT
- Dope sheet and graph editor (05; a minimal keyframe strip under the inspector is enough here).
- Gizmos and picking in the viewport (06), clips UI (07), codemods (08), 3D (09).

## Tasks

### 04.1 Entry and layout
- **Entry:** `ProjectPreview` and `SceneLibrary` recognize `velora-edit=1` (DEV only, same guard as the studio). The selected scene renders `src/preview/EditMode.tsx`, which **dynamically** imports `src/editor/Editor.tsx`. This is the only allowed preview → editor edge (Phase 00 fixture).
- **ScenePreview slots:** `ScenePreview` gains optional `layout="editor"` slots: `left`, `right`, `bottom`, `toolbar`, and `overlay` (rendered inside the scaled frame next to `StudioOverlays`, chrome-marked).
  - Without these props, the DOM and behavior are unchanged (React tests compare snapshots).
  - The one session, capture registration and error boundary stay in `ScenePreview`.
- **Studio button:** the scene header gains **Edit** (opens edit mode: connected when launched by `velora edit`, read-only otherwise).
- **Export URL:** the export command copied in Edit mode strips `velora-edit` and the URL fragment.

### 04.2 Editor store — `src/editor/store.ts` (owner `createEditorStore`)
- **Approach:** an external store read through `useSyncExternalStore`, with no new dependencies.
- **State:**
  - `base`: the last recipe known on disk, plus its `sha`;
  - `pending`: committed ops not yet acknowledged by the bridge;
  - `transient`: in-gesture ops;
  - `draft`: derived as `applyEdits(base, pending + transient)`, structurally shared and deep-frozen in DEV;
  - `history`: undo and redo stacks of `{ label, ops, inverse }`, capped at 200 entries;
  - `selection`: layers, tracks, keyframes, clips;
  - `ui`: panel sizes and expanded rows, saved in `localStorage` per project and scene inside try/catch.
- **Draft flow:** the draft definition flows into `ScenePreview` as `definition`, and the store's revision counter is passed as `revision`. Session semantics are unchanged: invalid drafts never reach the viewport, and the last valid one is retained.
- **Echoes:** when HMR delivers a new recipe from the scene module:
  - equal to the expected post-write document: ignore;
  - different, with no pending ops: adopt it;
  - different, with pending ops: rebase (re-apply the pending ops on the new base). If the rebase fails, enter the **Conflict** state (EDITOR-UX §3).

### 04.3 Bridge client — `src/editor/bridge.ts`
- Parse `#velora-bridge=<port>.<token>`, then `history.replaceState` to drop the fragment.
- `fetch` with `Authorization`; events through a streaming `fetch` reader (EventSource can't send headers).
- A serialized write queue with one write in flight: send `{ baseSha, ops }`.
  - **409:** rebase or conflict.
  - **422:** show issues and roll back the transient state.
- Backoff on disconnect (Offline state). Hello-capability checks gate features, for example source endpoints in 08.
- **Read-only fallback** with no bridge:
  - edits stay in memory;
  - the save area offers **Copy as command** (`velora edit apply --scene <id> --ops - --write` with the ops inline as a heredoc for POSIX shells and a file hint for PowerShell);
  - and **Copy agent prompt** (prompt library, 11).

### 04.4 Inspector data hook — `src/react` (owner `useSceneInspector`)
- A read-only snapshot of the current Scene for editor consumers:
  - registry bindings (id, parent id, measurement, mounted);
  - animatables (01.5);
  - evaluated node data (world matrix, blur, depth);
  - the current `MotionState`.
- It subscribes to the registry revision and holds no React instances.
- Exposed from `@adityadeokar/velora` for advanced users (documented as editor-grade API).

### 04.5 Layers panel — `src/editor/Layers.tsx`
- The tree, as specified in `EDITOR-UX.md` §2:
  - Camera, Focus and Look;
  - the Surface hierarchy from the registry;
  - recipe nodes that aren't mounted, flagged;
  - animatables under their owner;
  - clips (02) as a separate group.
- Row actions: select, rename (`editor.labels`), color tag (`editor.colors`), lock (`editor.locked`), and solo or hide.
  - **Solo and hide** are editor-only CSS classes applied through a chrome-scoped stylesheet. They are never written, and the capture page never has them.
- Search, keyboard tree navigation (`role="tree"`), and expand to animated properties (`U` shows only animated ones).

### 04.6 Inspector — `src/editor/Inspector.tsx`
- Groups: Transform, Visual and grade, Style vars (+ add var), Props (animatables), Camera (with lens mm via `lens.ts`), Focus (plus follow target), Constraints, Motion (duration, speed, loop), Look.
- Row anatomy: stopwatch, keyframe navigator (◀ ◆ ▶), value control by kind (EDITOR-UX §6), and the evaluated value at the playhead (italic when interpolated).
- Change semantics follow EDITOR-UX §4.1–4.3 exactly. They are implemented once, in `src/editor/intents.ts` (`intentToOps`), and the inspector, gizmos (06) and palette all call it.
- Drag-scrub fields emit transient ops at pointer rate and commit on release.

### 04.7 Advisories, history and command palette
- **Advisories popover:** `reviewAuthoring` advice, Scene diagnostics and the `useAnimatable` conflict diagnostics. Each entry selects the offending track or layer.
- **History panel:** labeled entries (`describeOp`), click to jump (undo to that point), and **Copy as command** per entry.
- **Command registry** `src/editor/commands.ts` (owner `EDITOR_COMMANDS`): id, label, shortcut, `enabled(state)` and `run`. The palette (Ctrl/⌘+K), menus and the shortcut handler all read it.
  - Test: no shortcut collides with `transportTarget` keys or with another command in the same mode.

### 04.8 Capture safety
- Every editor element carries `data-velora-preview-chrome`.
- A browser test exports from an Edit-mode URL (after the strip) and from Preview mode, and compares frame SHAs.

### 04.9 Accessibility baseline
- Landmarks, focus order, a live region for save state, labeled controls, and a visible focus ring in the editor theme (scoped, never resetting host styles; `theme.ts` rules).

### 04.10 Docs (only the two allowed files)
- `docs/product.md`: the Studio section gains Edit mode. Boundaries change to say that the studio writes project files **only** through `velora edit`'s local bridge, with compare-and-swap writes; it remains a local tool.
- `docs/architecture.md`: a new section "Editor and edit bridge" (store, ops, bridge, chrome rules); "Current scope" is updated.
- `README.md` and `USER_GUIDE.md`: a short Edit-mode section.

## Contracts
- URL flag `velora-edit=1`; fragment `velora-bridge`.
- `ScenePreview` `layout="editor"` slots.
- `useSceneInspector()` snapshot shape.
- `EDITOR_COMMANDS` entries (ids are stable; Phase 11 tests and docs reference them).

## Files
- New: `src/preview/EditMode.tsx`, `src/editor/{Editor,store,bridge,intents,commands,Layers,Inspector,Advisories,History,Palette,theme}.ts(x)`
- Modified: `src/preview/{ScenePreview,SceneLibrary,index}.tsx`, `src/react/{index.tsx,registry.ts}`, `scripts/check-architecture.mjs` (owners: `createEditorStore`, `useSceneInspector`, `EDITOR_COMMANDS`, `intentToOps`), `docs/{product,architecture}.md`, `README.md`, `USER_GUIDE.md`

## Tests
- `tests/editor/store.test.ts`: undo and redo, coalescing, rebase on external change, conflict entry, read-only mode, frozen drafts.
- `tests/editor/intents.test.ts`: every EDITOR-UX §4 rule (animated vs auto-key vs static; camera and focus statics; `node.ensure`).
- `tests/editor/bridge-client.test.ts`: against an in-process bridge (Phase 03), the write queue, 409 and 422 handling, and fragment stripping.
- `tests/react/inspector-hook.test.tsx`: snapshot contents, subscription and no-instance guarantee.
- `tests/preview/editor-slots.test.tsx`: `ScenePreview` output is unchanged without slots.
- `tests/browser/editor-shell.spec.ts` (installed `local-project` host via `velora edit --no-open`):
  1. open the editor URL;
  2. select `dashboard` in Layers;
  3. switch on the stopwatch for `x`;
  4. seek to 2 s and type 120;
  5. assert the file on disk contains the expected track (byte compare to fixture);
  6. press Ctrl+Z and assert the file is byte-identical to the original;
  7. edit the file externally and assert a rebase or conflict banner.
- `tests/browser/editor-capture.spec.ts`: export from an Edit-mode URL equals a Preview-mode export.
- Time-to-first-keyframe journey (README §8) recorded in the exit report.

## Validation criteria
- [ ] The scripted journey above passes on Vite (React 19), Next App Router (React 19) and Next Pages (React 18) fixture hosts.
- [ ] The editor chunk is absent from the production build of every installed host.
- [ ] The read-only fallback produces a command that, when run, yields the same file as the connected path.

## Anti-patterns
- A second playback cursor or `requestAnimationFrame` loop in the editor (use the session).
- Writing on every pointer move (commit per gesture).
- Editor state in project files (panel sizes, solo, hide).
- Duplicating `intentToOps` logic in individual widgets.

## Definition of Done
Journeys green on the three hosts, docs updated, and `plan/v2.1/artifacts/phase-04-exit.md`
written with time-to-first-keyframe evidence.
