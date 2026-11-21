import type { EditorCheckpoint } from "../store";
import type { CutSelection, CutTool } from "./tools";

export type CutView = { cursor: number; tool: CutTool; selected?: CutSelection };
type CutCheckpoint = { editor: EditorCheckpoint; view?: CutView };
const keyFor = (file: string) => `velora:composition:${location.pathname}:${file}`;
export function readCutCheckpoint(file: string): CutCheckpoint | undefined {
  try {
    const text = sessionStorage.getItem(keyFor(file));
    return text ? JSON.parse(text) as CutCheckpoint : undefined;
  } catch { return undefined; }
}
export function saveCutCheckpoint(file: string, editor: EditorCheckpoint, view?: CutView) {
  try {
    const key = keyFor(file);
    // Try to retain exact undo across host reloads. Keep the pending edits first
    // if a large edit history runs into the tab's storage quota.
    try { sessionStorage.setItem(key, JSON.stringify({ editor, view })); }
    catch { sessionStorage.setItem(key, JSON.stringify({ editor: { ...editor, undo: [], redo: [] }, view })); }
  } catch { /* Normal saving still works when browser storage is unavailable. */ }
}
