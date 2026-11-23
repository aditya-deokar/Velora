import { Suspense, lazy, type ReactNode } from "react";
import type { PreviewHot } from "./connection";
import type { CompositionPlayerProps } from "./CompositionPlayer";

/** Edit mode entry: the only preview → editor edge, a dynamic import, so the editor ships as its own
 * chunk that production hosts never load (velora-edit=1 is development-only like the studio). */
export type EditModeProps = {
  sceneId: string;
  title: string;
  /** The recipe document exactly as authored (raw JSON, not the parsed definition). */
  recipe: unknown;
  children?: ReactNode;
  hot?: PreviewHot;
  backHref?: string;
  onBack?: () => void;
  backLabel?: string;
  initialTimeMs?: number;
};
const Editor = lazy(() => import("../editor/Editor").then(module => ({ default: module.Editor })));
const CompositionEditor = lazy(() => import("../editor/composition/CompositionEditor").then(module => ({ default: module.CompositionEditor })));
export function EditMode(props: EditModeProps) {
  return <Suspense fallback={<div role="status" data-velora-preview-chrome="" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "#000", color: "#ddd", font: "14px system-ui" }}>Loading the editor…</div>}>
    <Editor {...props}/>
  </Suspense>;
}
export type CompositionEditModeProps = Omit<CompositionPlayerProps, "renderEditor" | "editHref"> & { onOpenScene(recipe: string, localMs: number, globalMs: number): void };
export function CompositionEditMode(props: CompositionEditModeProps) {
  return <Suspense fallback={<div role="status" data-velora-preview-chrome="" style={{ padding: 24 }}>Loading the composition editor…</div>}>
    <CompositionEditor {...props}/>
  </Suspense>;
}
/** True when the URL asks for Edit mode. */
export function editModeRequested(href: string): boolean {
  try { return new URL(href).searchParams.get("velora-edit") === "1"; } catch { return false; }
}
