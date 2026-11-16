import { Suspense, lazy, type ReactNode } from "react";
import type { PreviewHot } from "./connection";

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
};
const Editor = lazy(() => import("../editor/Editor").then(module => ({ default: module.Editor })));
export function EditMode(props: EditModeProps) {
  return <Suspense fallback={<div role="status" data-velora-preview-chrome="" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "#000", color: "#ddd", font: "14px system-ui" }}>Loading the editor…</div>}>
    <Editor {...props}/>
  </Suspense>;
}
/** True when the URL asks for Edit mode. */
export function editModeRequested(href: string): boolean {
  try { return new URL(href).searchParams.get("velora-edit") === "1"; } catch { return false; }
}
