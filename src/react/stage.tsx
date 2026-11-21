import { createContext, useContext, type ReactNode } from "react";
import { fitStage, type Stage } from "../core/stage";

/** SOURCE OF TRUTH: AppStage, useAppStage.
 * WHAT: expose the recipe's logical stage and render a named CSS size container.
 * WHY: in-tree UI and iframe breakpoints need stable layout as the camera and video size change.
 * WHERE: Scene supplies the context and scaffolds put the hosted app inside the stage.
 */
export const AppStageContext = createContext<Stage | undefined>(undefined);

export function useAppStage() {
  const stage = useContext(AppStageContext);
  return stage && { width: stage.width, height: stage.height, dpr: stage.dpr,
    aspect: stage.width / stage.height, physicalWidthMm: stage.physicalWidthMm };
}

/** Keep the project's CSS viewport stable even when its plane fits a smaller region. */
export function AppStage({ children, fit }: { children?: ReactNode; fit?: { width: number; height: number } }) {
  const stage = useAppStage();
  if (!stage) return <>{children}</>;
  const placement = fit && fitStage(stage, fit);
  return <div data-velora-app-stage="" style={{
    width: stage.width, height: stage.height, containerType: "size", containerName: "velora-app-stage",
    ...(placement && { transformOrigin: "top left", transform: `translate(${placement.left}px, ${placement.top}px) scale(${placement.scale})` }),
  }}>{children}</div>;
}
