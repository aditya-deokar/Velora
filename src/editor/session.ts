import type { EditorCheckpoint } from "./store";

export function readEditorSession<T>(key: string): { editor: EditorCheckpoint; view?: T } | undefined {
  try {
    const text = sessionStorage.getItem(key);
    return text ? JSON.parse(text) : undefined;
  } catch { return undefined; }
}

export function saveEditorSession<T>(key: string, editor: EditorCheckpoint, view?: T) {
  try {
    try { sessionStorage.setItem(key, JSON.stringify({ editor, view })); }
    catch { sessionStorage.setItem(key, JSON.stringify({ editor: { ...editor, undo: [], redo: [] }, view })); }
  } catch { /* The bridge still saves normally when browser storage is unavailable. */ }
}
