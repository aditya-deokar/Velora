# Phase 08 — Source integration: full control of real components

## Goal
Close the gap between "elements I can see" and "layers I can animate". Today only `<Surface>`
subtrees are layers. After this phase a person can click *any* element of their real UI in the
viewport, see where it lives in source, and — with an explicit diff and confirmation — promote it
to an animatable layer, group sibling layers into a spatial group, or expose a literal prop as a
typed animatable. The host's code stays theirs: every change is a minimal, formatting-preserving
edit they review.

## Prerequisites
- Phase 04 (editor, bridge client), Phase 01 (`useAnimatable`), spike S4 verdict, decision D3
  confirmed.

## Scope IN
- JSX outline of the scene binding and its local imports (TypeScript API).
- Codemods: promote to layer (wrap in `Surface`), group layers (spatial group), expose prop.
- Click-to-source (code-inspector attributes when present; outline fallback); "open in editor".
- Bridge `/v1/source/*`, CLI `velora edit source …`, two-file transactions, safety rules.

## Scope OUT
- Arbitrary refactors, edits in `node_modules`, server components, non-React hosts (any-site
  mode has no TSX to edit — documented).

## Tasks

### 08.1 JSX outline — `src/project/source.ts` (sourceAdapter layer, TypeScript AST)
- Input: a project-relative `.tsx/.jsx` file (the scene binding `src/velora/scenes/<id>.tsx` and,
  one level deep, local modules it imports from `src/` — not `node_modules`, not generated
  adapters, not files with Velora ownership records).
- Output (`SourceOutlineSchema`, core): elements with a stable **node path** (`file#index.path`
  derived from JSX child indices + tag), tag name, key/id/className/data-* attributes, text
  preview (≤ 40 chars), line/column range, flags: `isSurface` (+ id), `insideMap` /
  `insideConditional` (expression containers), `hasSpread`, and `useAnimatable` calls found
  (static scan: literal ids and spec keys).
- Re-exports are followed once (`export { WholeScene as default } from "../../components/…"`,
  as in `local-project`).

### 08.2 Promote to layer
- Op: wrap the element at node path in `<Surface id="<id>">…</Surface>` (or, with `--content`,
  `<Surface id content={<el/>}/>` for a pure visual leaf), adding `import { Surface } from
  "<VELORA_PACKAGE.name>"` (`src/core/branding.ts`) when missing; formatting preserved by text
  splices (the `src/project/vite.ts` precedent); JSX in `.jsx` files stays JS.
- Refusals with reasons: element inside `.map()`/conditional (suggest a keyed id template the
  user writes), already a Surface, inside another component's props, spread-only elements,
  fragments as targets, server-only modules (Next `"use server"` / non-client files).
- The recipe gains `node.ensure {id}` in the **same transaction** (08.6).
- Layout caveat surfaced in the diff panel: the wrapper is a `div` with `position: relative` and
  `preserve-3d` (`Surface` styles) — inline elements may reflow; the preview shows the result
  before confirming.

### 08.3 Group layers (spatial group)
- Wrap **contiguous siblings** that are Surfaces (or will be) in a parent `<Surface
  id="group-…">`; children keep ids and their tracks; the new group is animatable as a whole
  (transforms inherit — true 3D parenting, unlike clips which group time).
- Non-contiguous selection → refused with an explanation and an agent prompt suggestion.

### 08.4 Expose prop as animatable
- For a JSX element (inside a Surface) with a **literal** prop (`number`, `string` color,
  `boolean`, string from a small set): insert `const <name> = useAnimatable("<id>", { <prop>:
  {type, default: <literal>} })` at the top of the enclosing component and replace the literal
  with `<name>.<prop>`; add the import. Only function components with a block body; refuse
  otherwise.
- The inspector then lists the prop with typed controls (01.5) — "full control of the
  component" without hand-editing.

### 08.5 Click-to-source
- If the clicked DOM element (or an ancestor) carries the code-inspector attribute (format
  confirmed by S4), map file:line:col → outline node; otherwise use the nearest Surface → its
  binding outline, highlighting candidate nodes by text/tag match for the user to choose.
- "Open in editor": `vscode://file/<abs>:<line>:<col>` link plus "Copy path:line" (no process
  spawning from the browser; the bridge may offer `POST /v1/source/open` that runs the user's
  configured `EDITOR` only with `--allow-open`, off by default).

### 08.6 Transactions and safety — `src/project/edit.ts` + bridge `/v1/source/*`
- `GET /v1/source/outline?file=` · `POST /v1/source/preview {kind, file, node, …}` → unified diff
  + resulting outline · `POST /v1/source/apply {previewId, baseShas}` (explicit confirm step).
- Two-file transaction (TSX + recipe): journal in `.velora/journal/` (as `init` does), CAS on
  both files, write TSX then recipe; on failure restore the TSX from the journal; startup
  recovers interrupted journals.
- Rules: project `src/` only; refuse files with merge markers, > 512 KB, symlinks, generated
  adapters/catalogs, or ownership-recorded files; show git status (clean/dirty) in the diff panel
  when git is available (services read-only `git status --porcelain` with argument arrays).
- Undo: the editor stores the pre-image; undo restores it only if the current SHA equals the
  post-image SHA (otherwise "file changed since — use git").
- CLI: `velora edit source outline|wrap|group|expose --file <path> --node <path> --id <id>
  [--scene <id>] [--write]` (dry-run prints the diff).

### 08.7 Agent handoff
- For refused cases, "Ask agent" copies a prompt with file, node path, intended layer id and the
  refusal reason (prompt library entry `promote-layer`).

## Contracts
- `SourceOutlineSchema` (core), node-path format, bridge `/v1/source/*`, `velora edit source`.

## Files
- New: `src/project/source.ts`, `src/core/source.ts` (schemas only), `src/editor/source/{Outline,DiffPanel,PromoteDialog}.tsx`
- Modified: `src/project/{edit,services/bridge}.ts`, `src/project/services.ts` (journal reuse),
  `src/core/{cli-schema,prompts}.ts`, `scripts/check-architecture.mjs` (owners
  `SourceOutlineSchema`, `outlineSource`, `wrapElement`), skills `velora-editor`,
  `velora-scenes`

## Tests
- `tests/project/source.test.ts` (fixtures: TSX and JSX; self-closing; nested; comments; CRLF;
  `.map()` and conditional refusals; re-export follow; server-file refusal): outline paths
  stable across unrelated edits above the node; wrap/group/expose produce exact expected text;
  idempotence (second wrap refused); formatting untouched outside the splice.
- `tests/project/source-transaction.test.ts`: crash between writes → recovery restores TSX;
  CAS conflicts on either file abort cleanly.
- `tests/project/security.test.ts`: source endpoints refuse paths outside `src/`, symlinks,
  ownership-recorded files; `open` disabled by default.
- `tests/browser/source.spec.ts` (Vite + Next fixture hosts): click a headline that is not a
  Surface → Promote → diff → Apply → HMR → layer appears in Layers → animate x → export frame
  shows motion; expose a counter's `value` prop and keyframe it.

## Validation criteria
- [ ] On the `local-project` dashboard, three non-Surface cards are promoted, grouped, staggered
  and exported without the user opening a code editor; `git diff` shows only the minimal wraps,
  one import and recipe changes.
- [ ] Every refusal has a reason and a working agent prompt.

## Anti-patterns
- Reprinting files with a code generator (destroys formatting); regex-based JSX edits.
- Writing without a confirmed diff; editing outside `src/`; silent partial transactions.
- Relying on React internals (`_debugSource`, fibers) for source mapping.

## Definition of Done
Tests and validation green on Vite and Next hosts; skills updated;
`plan/v2.1/artifacts/phase-08-exit.md` written.
