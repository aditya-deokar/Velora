import type { EditorCheckpoint } from "../store";
import { readEditorSession, saveEditorSession } from "../session";
import type { CutSelection, CutTool } from "./tools";

export type CutView = { cursor: number; tool: CutTool; selected?: CutSelection };
type CutCheckpoint = { editor: EditorCheckpoint; view?: CutView };
const keyFor = (file: string) => `velora:composition:${location.pathname}:${file}`;
export function readCutCheckpoint(file: string): CutCheckpoint | undefined {
  return readEditorSession<CutView>(keyFor(file));
}
export function saveCutCheckpoint(file: string, editor: EditorCheckpoint, view?: CutView) {
  saveEditorSession(keyFor(file), editor, view);
}
