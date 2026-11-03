import { useId, useMemo, type ReactNode } from "react";
import { channelValue, gradeColorMatrix, gradeTransferTable, grainOffset, hasBrowserLook, resolveLook, type LookInput } from "../core";

/** SOURCE OF TRUTH: LookLayer, GRAIN_FPS.
 * WHAT: the browser layer of a look around the rendered scene: an SVG grade (feColorMatrix for
 * contrast/saturation/temperature/tint, feComponentTransfer for lift/gamma/gain), a radial vignette,
 * letterbox bars and a seeded grain tile whose offset changes per grain frame.
 * WHY: these are captured with the frame, so the preview is the export; the scene root is flat at this
 * level, so the filter never flattens the 3D hierarchy inside it.
 * WHERE: ScenePreview and the composition player wrap Scene in it; export finishing (bloom, halation,
 * aberration, sharpen, LUT) is applied later per frame by export/compositor.
 */
// Grain refreshes at a film cadence independent of the export frame rate, so stills match video.
export const GRAIN_FPS = 24;
const NOISE = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 1.6 -.3"/></filter><rect width="256" height="256" filter="url(#n)"/></svg>`);
export function LookLayer({ look: input, timeMs, width, height, seed = 0, children }: { look?: LookInput; timeMs: number; width: number; height: number; seed?: number; children?: ReactNode }) {
  const filterId = "velora-look-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const look = useMemo(() => { try { return resolveLook(input); } catch { return undefined; } }, [input]);
  if (!look || !hasBrowserLook(look)) return <>{children}</>;
  const { grade } = look;
  const graded = grade.contrast !== 0 || grade.saturation !== 0 || grade.temperature !== 0 || grade.tint !== 0 || JSON.stringify([grade.lift, grade.gamma, grade.gain]) !== "[0,1,1]";
  const frame = Math.floor((Math.max(0, timeMs) * GRAIN_FPS) / 1000);
  const offset = grainOffset(seed, frame);
  const bars = look.letterbox && width / height < look.letterbox.aspect ? Math.round((height - width / look.letterbox.aspect) / 2) : 0;
  return <div data-velora-look="" style={{ position: "relative", width, height }}>
    {graded && <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden="true">
      <filter id={filterId} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={gradeColorMatrix(grade).join(" ")}/>
        <feComponentTransfer>
          {(["R", "G", "B"] as const).map((channel, index) => {
            const Func = channel === "R" ? "feFuncR" : channel === "G" ? "feFuncG" : "feFuncB";
            return <Func key={channel} type="table" tableValues={gradeTransferTable(channelValue(grade.lift, index), channelValue(grade.gamma, index), channelValue(grade.gain, index)).join(" ")}/>;
          })}
        </feComponentTransfer>
      </filter>
    </svg>}
    <div style={{ position: "absolute", inset: 0, filter: graded ? `url(#${filterId})` : undefined }}>{children}</div>
    {look.grain && look.grain.amount > 0 && <div data-velora-grain={frame} style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: `url("${NOISE}")`,
      backgroundSize: `${256 * look.grain.size}px ${256 * look.grain.size}px`, backgroundPosition: `${offset.x * look.grain.size}px ${offset.y * look.grain.size}px`, opacity: Math.min(1, look.grain.amount * 1.6), mixBlendMode: "overlay" }}/>}
    {look.vignette && look.vignette.amount > 0 && <div data-velora-vignette="" style={{ position: "absolute", inset: 0, pointerEvents: "none",
      background: `radial-gradient(ellipse at 50% 50%, transparent ${Math.round(35 + look.vignette.softness * 30)}%, rgba(0,0,0,${look.vignette.amount.toFixed(3)}) 100%)` }}/>}
    {bars > 0 && <>
      <div data-velora-letterbox="top" style={{ position: "absolute", left: 0, right: 0, top: 0, height: bars, background: "#000" }}/>
      <div data-velora-letterbox="bottom" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bars, background: "#000" }}/>
    </>}
  </div>;
}
