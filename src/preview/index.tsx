import { useMemo, useSyncExternalStore, useState, type ReactNode } from "react";
import { Surface } from "../react";
import type { PreviewDefinitionInput } from "../core";
import { ScenePreview } from "./ScenePreview";
import {SceneModuleLibrary,type SceneModules,type CompositionModules} from "./modules";
import { QuickShot } from "./QuickShot";
export {SceneLibrary} from "./SceneLibrary";
export type {SceneLibraryProps} from "./SceneLibrary";
export type {SceneModules,CompositionModules} from "./modules";
export { TemplateGallery } from "./TemplateGallery";
export { QuickShot, quickShotSearch } from "./QuickShot";
export { CompositionPlayer } from "./CompositionPlayer";
import type { PreviewHot } from "./connection";
export { ScenePreview } from "./ScenePreview";
export type { ScenePreviewProps } from "./ScenePreview";
export type { PreviewHot } from "./connection";

/** SOURCE OF TRUTH: ProjectPreview installed application adapter.
 * WHAT: retain the explicit development/query guard around original host children.
 * WHY: the real product shell frames live UI without copying data or changing normal routes.
 * WHERE: CLI injects this adapter; ScenePreview owns all playback and chrome.
 * The host's children reach the library so quick shots frame the live app; compositions and
 * asset URLs are DEV-only adapter globs for the composition player.
 */
export type ProjectPreviewProps = {children?: ReactNode; projectId: string; enabled: boolean; active?: boolean; hot?: PreviewHot; sceneModules?: SceneModules;
  compositionModules?: CompositionModules; assetUrls?: Record<string, string>};
const initialDefinition: PreviewDefinitionInput = {
  scene: {camera: {perspective:1800,rotateX:4,rotateY:-7},focus:{distance:1800,fStop:8,maxBlur:6},nodes:[{id:"velora-application"}]},
};
export function ProjectPreview({children, projectId, enabled, active, hot, sceneModules, compositionModules, assetUrls}: ProjectPreviewProps): ReactNode {
  const [locationAtMount] = useState(() => typeof window === "undefined" ? "" : window.location.href);
  const location = useSyncExternalStore(() => () => {}, () => locationAtMount, () => "");
  const entry = useMemo(() => {
    if (!location) return null;
    const url = new URL(location);
    const requested = url.searchParams.get("velora-preview") === "1";
    url.searchParams.delete("velora-preview");
    const quick = url.searchParams.has("velora-quick");
    for (const key of ["velora-scene", "velora-tab", "velora-quick", "velora-route", "velora-params", "velora-composition"]) url.searchParams.delete(key);
    return {requested, quick, back: url.pathname + url.search + url.hash};
  }, [location]);
  const content = useMemo(() => <Surface id="velora-application" style={{width:"100%",minHeight:980}}>{children}</Surface>, [children]);
  if (!enabled || !(active ?? entry?.requested)) return children;
  if(sceneModules) return <div data-velora-project={projectId}><SceneModuleLibrary modules={sceneModules} compositionModules={compositionModules} assetUrls={assetUrls} hot={hot} backHref={entry?.back}>{children}</SceneModuleLibrary></div>;
  if(entry?.quick) return <div data-velora-project={projectId}><QuickShot hot={hot} backHref={entry.back}>{children}</QuickShot></div>;
  return <div data-velora-project={projectId}><ScenePreview title="Your application" definition={initialDefinition} backHref={entry?.back} hot={hot}>
    {content}
  </ScenePreview></div>;
}
