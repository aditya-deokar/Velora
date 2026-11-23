import { useState } from "react";
import type { EditOp } from "../core";
import { useEditor, useEditorState } from "./context";
import { commandForPlatform, editBatchCommand } from "./handoff";

/** The shell command that applies ops to a scene in the user's terminal. */
export function opsCommand(sceneId: string, ops: readonly EditOp[], sha?: string): { posix: string; powershell: string } {
  return editBatchCommand({ scene: sceneId }, ops, sha);
}
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
/** History panel (04.7): labeled entries, click to jump (undo to that point), Copy as command per entry. */
export function History({ onClose }: { onClose(): void }) {
  const { store, sceneId } = useEditor();
  const state = useEditorState(store);
  const [copied, setCopied] = useState<number>();
  return <div className="ve-popover ve-panel" role="dialog" aria-label="History" style={{ top: 52, right: 16 }} data-velora-preview-chrome=""
    onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
    <div className="ve-h"><span>History</span><button className="ve-btn" onClick={onClose}>Close</button></div>
    {state.undo.length === 0 && state.redo.length === 0 ? <p style={{ padding: 8 }}>No edits yet.</p> :
      <ol style={{ margin: 0, padding: "0 0 0 20px" }}>
        {state.undo.map((entry, index) => <li key={index} style={{ margin: "2px 0" }}>
          <button className="ve-btn" style={{ whiteSpace: "normal", textAlign: "left" }} onClick={() => store.jump(index)} title="Undo back to this edit">{entry.label}</button>{" "}
          <button className="ve-btn" onClick={async () => { if (await copyText(commandForPlatform(opsCommand(sceneId, entry.ops)))) setCopied(index); }}>{copied === index ? "Copied" : "Copy as command"}</button>
        </li>)}
        {[...state.redo].reverse().map((entry, index) => <li key={`redo-${index}`} style={{ margin: "2px 0", opacity: 0.5 }}>{entry.label} (undone)</li>)}
      </ol>}
  </div>;
}
