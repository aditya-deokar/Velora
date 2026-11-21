import { useMemo, useRef } from "react";
import { presentPreview, reviewAuthoring } from "../core";
import { useEditor, useEditorState } from "./context";
import { addressOf } from "./model";
import type { Doc } from "./store";

/** Advisories popover (EDITOR-UX §4.8): reviewAuthoring advice and issues, Scene diagnostics (including
 * animatable conflicts) and the last refused edit. Each entry selects the offending track or layer. */
export type Advisory = { code: string; path: string; message: string; severity: "issue" | "advice" | "scene" };
export function useAdvisories(): Advisory[] {
  const { store, snapshot } = useEditor();
  const state = useEditorState(store);
  const last = useRef<Advisory[]>([]);
  // During a gesture the advisories of the committed document stay on screen (no review per pointer move).
  const doc = state.transient.length ? undefined : state.draft;
  // The snapshot changes every frame during playback; only its issues matter here.
  const sceneIssues = JSON.stringify(snapshot?.issues ?? []);
  const textReadings = JSON.stringify((snapshot?.animatables ?? []).flatMap(entry => entry.readingTimeMs ? [{ id: entry.id, minMs: entry.readingTimeMs }] : []));
  const result = useMemo(() => {
    if (!doc) return undefined;
    const out: Advisory[] = [];
    const preview = presentPreview((doc as Doc).definition);
    if (preview.valid) {
      const review = reviewAuthoring({ scene: preview.definition.scene, motion: preview.definition.motion ?? { durationMs: 0, tracks: [] }, textReadings: JSON.parse(textReadings) });
      out.push(...review.issues.map(entry => ({ ...entry, severity: "issue" as const })), ...review.advice.map(entry => ({ ...entry, severity: "advice" as const })));
    } else out.push(...preview.issues.map(issue => ({ code: "invalid", path: issue.path, message: issue.message, severity: "issue" as const })));
    out.push(...(JSON.parse(sceneIssues) as { path: string; message: string }[]).map(issue => ({ code: "scene", path: issue.path, message: issue.message, severity: "scene" as const })));
    out.push(...state.issues.map(issue => ({ code: issue.code, path: issue.path, message: issue.message, severity: "issue" as const })));
    return out;
  }, [doc, state.issues, sceneIssues, textReadings]);
  if (result) last.current = result;
  return result ?? last.current;
}
export function Advisories({ onClose }: { onClose(): void }) {
  const { store, snapshot } = useEditor();
  const state = useEditorState(store);
  const advisories = useAdvisories();
  const reveal = (advisory: Advisory) => {
    const doc = state.draft as Doc;
    let container = doc.definition?.motion, clipId: string | undefined;
    for (const match of advisory.path.matchAll(/(?:^|\.)clips\.(\d+)/g)) {
      container = container?.clips?.[Number(match[1])];
      clipId = container?.id;
    }
    const track = /(?:^|\.)tracks\.(\d+)/.exec(advisory.path);
    const entry = track ? container?.tracks?.[Number(track[1])] : undefined;
    if (entry) {
      const address = addressOf(entry, clipId);
      store.select({ tracks: [address], keys: [], clips: clipId ? [clipId] : [], layers: [clipId ? `clip:${clipId}` : "id" in address.target ? address.target.id : address.target.kind] });
    } else if (advisory.path.startsWith("animatable.")) {
      const owner = snapshot?.animatables.find(entry => entry.id === advisory.path.slice("animatable.".length))?.owner;
      if (owner) store.select({ layers: [owner], clips: [], tracks: [], keys: [] });
    }
    else {
      const id = /^(?:motion\.)?([A-Za-z0-9][\w.:-]*)$/.exec(advisory.path)?.[1];
      if (id && (doc.definition?.scene?.nodes ?? []).some((node: { id: string }) => node.id === id)) store.select({ layers: [id] });
    }
    onClose();
  };
  return <div className="ve-popover ve-panel" role="dialog" aria-label="Advisories" style={{ top: 52, right: 16 }} data-velora-preview-chrome=""
    onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
    <div className="ve-h"><span>Advisories ({advisories.length})</span><button className="ve-btn" onClick={onClose}>Close</button></div>
    {advisories.length === 0 ? <p style={{ padding: 8 }}>No advisories. The scene validates and the review is clean.</p> :
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{advisories.map((advisory, index) =>
        <li key={index}><button className="ve-btn" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", margin: "2px 0", whiteSpace: "normal" }} onClick={() => reveal(advisory)}>
          <strong style={{ color: advisory.severity === "issue" ? "var(--ve-danger)" : advisory.severity === "scene" ? "var(--ve-key)" : "var(--ve-dim)" }}>{advisory.code}</strong>&nbsp;{advisory.message}
        </button></li>)}</ul>}
  </div>;
}
