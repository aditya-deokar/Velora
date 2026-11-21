import { applyEdits, coalesce, describeOp, type EditOp, type EditIssue, type TrackAddress } from "../core";

/** SOURCE OF TRUTH: createEditorStore.
 * WHAT: the editor's one external store: the last recipe known on disk (base + sha), committed ops not
 * yet acknowledged (pending), in-gesture ops (transient), the derived draft (applyEdits over base), undo
 * and redo history of labeled op batches with exact inverses, the shared selection, UI state and the save
 * state machine (saved, saving, unsaved, conflict, offline) with one write in flight.
 * WHY: the editor is another author, not another engine: every change is an EditOp the CLI could apply,
 * drafts are ordinary definitions for the one preview session, and external edits rebase or conflict.
 * WHERE: Editor.tsx wires it to the bridge client (bridge.ts) and to ScenePreview; panels read it through
 * useSyncExternalStore and change it only through intents (intents.ts) and commands (commands.ts).
 */
export type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type SaveState = "saved" | "saving" | "unsaved" | "conflict" | "offline";
export type HistoryEntry = { label: string; ops: EditOp[]; inverse: EditOp[]; at: number };
export type KeyRef = { track: TrackAddress; atMs: number };
export type Selection = { layers: string[]; tracks: TrackAddress[]; keys: KeyRef[]; clips: string[] };
export type EditorUi = { autoKey: boolean; snap: boolean; animatedOnly: boolean; view: "dope" | "graph"; zoom: number; scroll: number;
  workArea?: { startMs: number; endMs: number }; solo: string[]; hidden: string[]; armed: string[]; expanded: string[]; panel?: string;
  /** Viewport (Phase 06): active tool, director viewpoint (editor-only camera), group scope, overlays. */
  tool: ViewportTool; director?: import("../core").CameraDefinition; scope?: string; onion: boolean; paths: boolean };
export type ViewportTool = "move" | "rotate" | "scale" | "camera" | "focus" | "pivot";
export type ConflictInfo = { text: string; sha: string; doc: Doc; reason: string };
export type EditorState = {
  sceneId: string;
  base: Doc;
  sha?: string;
  pending: EditOp[][];
  transient: EditOp[];
  draft: Doc;
  issues: EditIssue[];
  notice?: { message: string };
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  selection: Selection;
  ui: EditorUi;
  save: SaveState;
  readOnly: boolean;
  conflict?: ConflictInfo;
  revision: number;
};
/** Transport for writes: the bridge client in connected mode. */
export type EditorWriter = (baseSha: string, ops: EditOp[], label: string) => Promise<
  { status: "ok"; sha: string } | { status: "conflict"; sha: string; text: string; doc: Doc } | { status: "invalid"; issues: EditIssue[] } | { status: "offline" }>;
export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 1000;
const EMPTY_SELECTION: Selection = { layers: [], tracks: [], keys: [], clips: [] };
export const DEFAULT_UI: EditorUi = { autoKey: false, snap: true, animatedOnly: false, view: "dope", zoom: 1, scroll: 0, solo: [], hidden: [], armed: [], expanded: [], tool: "move", onion: false, paths: true };
const development = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type EditorStore = ReturnType<typeof createEditorStore>;
export function createEditorStore(options: { sceneId: string; base: Doc; sha?: string; readOnly: boolean; writer?: EditorWriter; ui?: Partial<EditorUi>;
  now?: () => number; persistUi?: (ui: EditorUi) => void; retryMs?: (attempt: number) => number; schedule?: (run: () => void, ms: number) => void }) {
  const listeners = new Set<() => void>();
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((run: () => void, ms: number) => { setTimeout(run, ms); });
  let state: EditorState = {
    sceneId: options.sceneId, base: options.base, sha: options.sha, pending: [], transient: [], draft: options.base, issues: [], undo: [], redo: [],
    selection: EMPTY_SELECTION, ui: { ...DEFAULT_UI, ...options.ui }, save: options.readOnly ? "unsaved" : "saved", readOnly: options.readOnly, revision: 0,
  };
  let inFlight = false, attempt = 0;
  const set = (patch: Partial<EditorState>) => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    if (patch.ui) options.persistUi?.(state.ui);
    listeners.forEach(listener => listener());
  };
  /** The committed document (base plus every pending batch). */
  const committed = (): Doc => committedDoc(state.pending, state.base) ?? state.base;
  // The committed draft (base + pending) is cached so gesture previews only apply their own ops.
  let committedCache: { base: Doc; pending: EditOp[][]; doc: Doc } | undefined;
  const committedDoc = (pending: EditOp[][], base: Doc): Doc | undefined => {
    if (committedCache && committedCache.base === base && committedCache.pending === pending) return committedCache.doc;
    if (!pending.length) return base;
    const result = applyEdits(base, pending.flat());
    if (!result.ok) return undefined;
    committedCache = { base, pending, doc: result.recipe as Doc };
    return committedCache.doc;
  };
  const derive = (pending: EditOp[][], transient: EditOp[], base = state.base): { draft: Doc; issues: EditIssue[] } | undefined => {
    if (!pending.length && !transient.length) return { draft: development ? deepFreeze(base) : base, issues: [] };
    const start = committedDoc(pending, base);
    if (!start) return undefined;
    if (!transient.length) return { draft: development ? deepFreeze(start) : start, issues: [] };
    // In-gesture previews check motion only; the commit re-validates the whole recipe.
    const result = applyEdits(start, transient, { validation: "motion" });
    if (!result.ok) return undefined;
    return { draft: development ? deepFreeze(result.recipe as Doc) : result.recipe as Doc, issues: [] };
  };
  const pump = () => {
    if (inFlight || state.readOnly || !options.writer || !state.pending.length || state.save === "conflict") return;
    if (!state.sha) { set({ save: "offline" }); return; }
    inFlight = true;
    const batch = state.pending[0];
    set({ save: "saving" });
    void options.writer(state.sha, batch, batch.map(describeOp).join("; ")).then(reply => {
      inFlight = false;
      if (reply.status === "ok") {
        attempt = 0;
        const applied = applyEdits(state.base, batch);
        const pending = state.pending.slice(1);
        set({ base: applied.ok ? applied.recipe as Doc : state.base, sha: reply.sha, pending, save: pending.length ? "saving" : "saved" });
        pump();
      } else if (reply.status === "conflict") rebase(reply.doc, reply.sha, reply.text, "The file changed on disk while saving.");
      else if (reply.status === "invalid") {
        // The bridge refused this batch: roll it back (and its history entry) and show why.
        const pending = state.pending.slice(1);
        const derived = derive(pending, state.transient) ?? derive(pending, []);
        const undo = state.undo.length && same(state.undo[state.undo.length - 1].ops, batch) ? state.undo.slice(0, -1) : state.undo;
        set({ pending, undo, ...(derived ?? {}), issues: reply.issues, save: pending.length ? "saving" : "saved" });
        pump();
      } else {
        set({ save: "offline" });
        schedule(pump, (options.retryMs ?? (n => Math.min(30_000, 500 * 2 ** n)))(attempt++));
      }
    });
  };
  /** Re-apply pending ops on a new base; conflict when they no longer apply. */
  const rebase = (doc: Doc, sha: string | undefined, text: string, reason: string) => {
    const derived = derive(state.pending, state.transient, doc) ?? derive(state.pending, [], doc);
    if (derived) { set({ base: doc, sha, ...derived, save: state.pending.length ? (state.readOnly ? "unsaved" : "saving") : state.readOnly ? "unsaved" : "saved", conflict: undefined }); pump(); return; }
    set({ save: "conflict", conflict: { doc, sha: sha ?? "", text, reason } });
  };
  const commitOps = (ops: EditOp[], label?: string, merge = false): EditIssue[] => {
    if (!ops.length) return [];
    const result = applyEdits(committed(), ops);
    if (!result.ok) { set({ transient: [], ...(derive(state.pending, []) ?? {}), issues: result.issues }); return result.issues; }
    const restored = result.inverse.filter(op => op.op === "restore" && "clip" in op.at);
    const after = new Map<string, Doc>();
    const collect = (clips?: Doc[]) => (clips ?? []).forEach(clip => { after.set(clip.id, clip); collect(clip.clips); });
    if (restored.length) collect((result.recipe as Doc).definition?.motion?.clips);
    const detached = (clip?: Doc): boolean => !!clip && (after.has(clip.id) && !!clip.source && !after.get(clip.id)?.source || (clip.clips ?? []).some(detached));
    const notice = restored.some(op => op.op === "restore" && detached(op.value as Doc | undefined)) ? { message: "Editing the generated tracks cleared their clip source." } : undefined;
    const entry: HistoryEntry = { label: label ?? ops.map(describeOp).join("; "), ops, inverse: result.inverse, at: now() };
    let undo = [...state.undo, entry];
    // Rapid single-op edits of one target (arrow nudges, typed values) are one history step.
    const previous = state.undo[state.undo.length - 1];
    if (merge && previous && ops.length === 1 && previous.ops.length === 1 && entry.at - previous.at < COALESCE_MS) {
      const joined = coalesce(previous.ops[0], ops[0]);
      if (joined) undo = [...state.undo.slice(0, -1), { label: describeOp(joined), ops: [joined], inverse: [...result.inverse, ...previous.inverse], at: entry.at }];
    }
    const pending = [...state.pending, ops];
    set({ pending, transient: [], undo: undo.slice(-HISTORY_LIMIT), redo: [], issues: [], ...(derive(pending, []) ?? {}), notice, save: state.readOnly ? "unsaved" : state.save === "conflict" ? "conflict" : "saving" });
    pump();
    return [];
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** The document every new op applies to (base plus pending, without the gesture). */
    committed,
    /** Apply in-gesture ops to the draft only (pointer-rate drags); invalid steps keep the last valid draft. */
    preview(ops: EditOp[]) {
      const derived = derive(state.pending, ops);
      if (derived) set({ transient: ops, ...derived });
    },
    /** Cancel the gesture (Esc): restore the pre-gesture draft. */
    cancel() { if (state.transient.length) set({ transient: [], ...(derive(state.pending, []) ?? {}) }); },
    /** Commit one gesture as one history entry and one write. */
    commit(ops: EditOp[], label?: string, options_: { merge?: boolean } = {}): EditIssue[] { return commitOps(ops, label, options_.merge); },
    undo() {
      const entry = state.undo[state.undo.length - 1];
      if (!entry) return;
      const result = applyEdits(committed(), entry.inverse);
      if (!result.ok) { set({ issues: result.issues }); return; }
      const pending = [...state.pending, entry.inverse];
      set({ undo: state.undo.slice(0, -1), redo: [...state.redo, { ...entry, inverse: result.inverse }], pending, transient: [], ...(derive(pending, []) ?? {}), save: state.readOnly ? "unsaved" : "saving" });
      pump();
    },
    redo() {
      const entry = state.redo[state.redo.length - 1];
      if (!entry) return;
      const result = applyEdits(committed(), entry.ops);
      if (!result.ok) { set({ issues: result.issues }); return; }
      const pending = [...state.pending, entry.ops];
      set({ redo: state.redo.slice(0, -1), undo: [...state.undo, { ...entry, inverse: result.inverse }], pending, transient: [], ...(derive(pending, []) ?? {}), save: state.readOnly ? "unsaved" : "saving" });
      pump();
    },
    /** Undo back to (and including) a history entry. */
    jump(index: number) { while (state.undo.length > index) { const before = state.undo.length; this.undo(); if (state.undo.length === before) break; } },
    /** An external revision of the file (watcher event or HMR): ignore our own echo, adopt, rebase or conflict. */
    external(doc: Doc, sha: string | undefined, text: string) {
      if (sha && sha === state.sha) return;
      if (same(doc, committed()) || (!state.pending.length && same(doc, state.base))) { if (sha) set({ sha }); return; }
      if (!state.pending.length && !state.transient.length) { set({ base: doc, sha, draft: development ? deepFreeze(doc) : doc, issues: [], conflict: undefined, save: state.readOnly ? "unsaved" : "saved" }); return; }
      rebase(doc, sha, text, "The file changed outside the editor.");
    },
    /** Resolve a conflict: keep mine (re-apply on the disk version) or take the disk version. */
    resolve(choice: "mine" | "disk") {
      const conflict = state.conflict;
      if (!conflict) return;
      if (choice === "disk") { set({ base: conflict.doc, sha: conflict.sha, pending: [], transient: [], draft: conflict.doc, conflict: undefined, save: state.readOnly ? "unsaved" : "saved" }); return; }
      // Keep mine: re-apply each pending batch that still applies; drop the rest.
      let doc = conflict.doc;
      const kept: EditOp[][] = [];
      for (const batch of state.pending) {
        const result = applyEdits(doc, batch);
        if (result.ok) { doc = result.recipe as Doc; kept.push(batch); }
      }
      set({ base: conflict.doc, sha: conflict.sha, pending: kept, transient: [], ...(derive(kept, [], conflict.doc) ?? { draft: conflict.doc, issues: [] }), conflict: undefined, save: kept.length ? "saving" : "saved" });
      pump();
    },
    select(next: Partial<Selection>) { set({ selection: { ...state.selection, ...next } }); },
    setUi(next: Partial<EditorUi>) { set({ ui: { ...state.ui, ...next } }); },
    /** Every committed op batch (for Copy as command in read-only mode). */
    unsavedOps(): EditOp[] { return state.pending.flat(); },
    retry() { attempt = 0; pump(); },
    setReadOnly(readOnly: boolean, sha?: string) { set({ readOnly, ...(sha ? { sha } : {}), save: readOnly ? "unsaved" : state.pending.length ? "saving" : "saved" }); pump(); },
  };
}
