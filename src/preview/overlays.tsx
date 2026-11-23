import { useLayoutEffect, useState, type RefObject } from "react";

/** SOURCE OF TRUTH: StudioOverlays, OverlayMenu, useOverlays.
 * WHAT: framing aids drawn over the preview frame: rule-of-thirds, title/action-safe areas,
 * approximate 9:16 platform UI zones, focus peaking and an aspect-crop preview.
 * WHY: editors judge composition and focus against guides; none of that may reach a delivered frame.
 * WHERE: ScenePreview and CompositionPlayer render them inside the scaled frame. Every layer is
 * chrome-marked (hidden by export) and toggles live in component memory only, so a fresh export page never has them.
 */
export type OverlayState = { thirds: boolean; safe: boolean; platform: boolean; peaking: boolean; crop: "" | "16:9" | "9:16" | "1:1" | "4:5" };
export const NO_OVERLAYS: OverlayState = { thirds: false, safe: false, platform: false, peaking: false, crop: "" };
export function useOverlays() { return useState<OverlayState>(NO_OVERLAYS); }
const RATIOS = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 } as const;
/** The centered region kept when this frame is cropped (cover) to another aspect. */
export function cropRect(width: number, height: number, aspect: keyof typeof RATIOS) {
  const ratio = RATIOS[aspect];
  return width / height > ratio ? { x: (width - height * ratio) / 2, y: 0, width: height * ratio, height } : { x: 0, y: (height - width / ratio) / 2, width, height: width / ratio };
}
// Leaves whose depth-of-field blur is below half a pixel read as in focus.
export const PEAKING_THRESHOLD = 0.5;
export function StudioOverlays({ width, height, state, root, timeMs }: { width: number; height: number; state: OverlayState; root?: RefObject<HTMLElement | null>; timeMs?: number }) {
  useLayoutEffect(() => {
    const scope = root?.current;
    if (!scope) return;
    const leaves = Array.from(scope.querySelectorAll<HTMLElement>("[data-velora-blur]"));
    for (const leaf of leaves) {
      const sharp = state.peaking && Number(leaf.dataset.veloraBlur) < PEAKING_THRESHOLD && !leaf.querySelector("[data-velora-depth-focus]");
      if (sharp) leaf.setAttribute("data-velora-peak", ""); else leaf.removeAttribute("data-velora-peak");
    }
    return () => { for (const leaf of leaves) leaf.removeAttribute("data-velora-peak"); };
  }, [root, state.peaking, timeMs]);
  const peaking = state.peaking && <style>{"[data-velora-peak]{outline:3px solid rgba(80,255,140,.85);outline-offset:-3px}"}</style>;
  if (!state.thirds && !state.safe && !state.platform && !state.crop) return peaking || null;
  const inset = (fraction: number) => ({ x: (width * (1 - fraction)) / 2, y: (height * (1 - fraction)) / 2, width: width * fraction, height: height * fraction });
  const title = inset(0.9), action = inset(0.93);
  const line = { stroke: "rgba(255,255,255,.55)", strokeWidth: Math.max(1, width / 960), fill: "none" };
  const crop = state.crop ? cropRect(width, height, state.crop) : undefined;
  // Approximate social overlays for 9:16: top bar, right action rail, bottom caption block.
  const portrait = { top: height * 0.1, bottom: height * 0.22, right: width * 0.16 };
  return <>
    {peaking}
    <svg data-velora-preview-chrome="" data-velora-overlay="" aria-hidden="true" viewBox={`0 0 ${width} ${height}`} width={width} height={height}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }}>
      {crop && <path data-overlay="crop" fillRule="evenodd" fill="rgba(0,0,0,.6)" d={`M0 0H${width}V${height}H0Z M${crop.x} ${crop.y}h${crop.width}v${crop.height}h${-crop.width}Z`}/>}
      {state.thirds && <g data-overlay="thirds" {...line}>
        {[1, 2].map(i => <line key={"v" + i} x1={(width * i) / 3} y1={0} x2={(width * i) / 3} y2={height}/>)}
        {[1, 2].map(i => <line key={"h" + i} x1={0} y1={(height * i) / 3} x2={width} y2={(height * i) / 3}/>)}
      </g>}
      {state.safe && <g data-overlay="safe" {...line}>
        <rect {...action} strokeDasharray="12 8"/><rect {...title}/>
      </g>}
      {state.platform && <g data-overlay="platform" fill="rgba(255,80,120,.22)" stroke="rgba(255,80,120,.7)">
        <rect x={0} y={0} width={width} height={portrait.top}/>
        <rect x={width - portrait.right} y={portrait.top} width={portrait.right} height={height - portrait.top - portrait.bottom}/>
        <rect x={0} y={height - portrait.bottom} width={width} height={portrait.bottom}/>
        <text x={width / 2} y={portrait.top / 2} fill="#fff" stroke="none" fontSize={Math.max(14, width / 40)} textAnchor="middle">Platform UI (approximate)</text>
      </g>}
    </svg>
  </>;
}
export function OverlayMenu({ state, onChange }: { state: OverlayState; onChange: (next: OverlayState) => void }) {
  const toggle = (key: "thirds" | "safe" | "platform" | "peaking", label: string) =>
    <label key={key}><input type="checkbox" checked={state[key]} onChange={event => onChange({ ...state, [key]: event.target.checked })}/>{label}</label>;
  // Lives inside the chrome-marked controls footer.
  return <details className="velora-guides">
    <summary className="velora-control">Guides</summary>
    <div className="velora-guides-panel velora-chrome" role="group" aria-label="Framing guides">
      {toggle("thirds", "Rule of thirds")}{toggle("safe", "Title / action safe")}{toggle("platform", "9:16 platform zones")}{toggle("peaking", "Focus peaking")}
      <label>Aspect crop<select aria-label="Aspect crop preview" value={state.crop} onChange={event => onChange({ ...state, crop: event.target.value as OverlayState["crop"] })}>
        <option value="">Off</option>{Object.keys(RATIOS).map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
      </select></label>
    </div>
  </details>;
}
