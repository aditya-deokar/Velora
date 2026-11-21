import { createContext, useContext, useSyncExternalStore } from "react";
import type { PreviewHost } from "../preview";
import type { SceneSnapshot } from "../react";
import type { EditorController } from "./commands";
import type { EditorState, EditorStore } from "./store";
import type { BridgeHello, createBridgeClient } from "./bridge";

/** Everything panels share: the store, the preview host (one session and inspector channel), the latest
 * Scene snapshot and the command controller. Provided once by Editor.tsx. */
export type EditorContextValue = {
  store: EditorStore;
  host: PreviewHost;
  snapshot: SceneSnapshot | undefined;
  controller: EditorController;
  hello?: BridgeHello;
  client?: ReturnType<typeof createBridgeClient>;
  sceneId: string;
  setFocused(focused: EditorController["focused"]): void;
  notify(message: string, action?: { label: string; run(): void }): void;
};
export const EditorContext = createContext<EditorContextValue | null>(null);
export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error("Editor panels render inside the Velora editor.");
  return value;
}
export function useEditorState(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
