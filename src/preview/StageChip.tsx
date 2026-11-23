import { useEffect, useState } from "react";
import { stageFromViewport, type Stage } from "../core/stage";

export function StageChip({ sceneId, stage, apply }: { sceneId: string; stage?: Stage; apply?: (stage: Stage) => void }) {
  const [basis, setBasis] = useState<"window" | "screen">("window");
  const [detected, setDetected] = useState<Stage>();
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    const read = () => {
      const screen = window.screen;
      setDetected(stageFromViewport({
        innerWidth: Math.max(1, window.innerWidth), innerHeight: Math.max(1, window.innerHeight),
        screenWidth: screen.width || screen.availWidth || Math.max(1, window.innerWidth),
        screenHeight: screen.height || screen.availHeight || Math.max(1, window.innerHeight),
        devicePixelRatio: window.devicePixelRatio || 1, atIso: new Date().toISOString(),
      }, { basis }));
      setFeedback("");
    };
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(read, 250); };
    read();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); clearTimeout(timer); };
  }, [basis]);
  if (!detected) return null;
  const { width, height, dpr } = detected;
  const matches = stage?.width === width && stage.height === height && stage.dpr === dpr;
  const saved = stage?.preset === "user-native" && matches && stage.detected?.basis === basis;
  const command = `npx velora edit stage --scene ${sceneId} --preset user-native --size ${width}x${height}@${dpr} --write`;
  return <div data-velora-preview-chrome="" className="velora-stage-chip">
    <span>Your laptop: {width} × {height} @{dpr}×</span>{" "}
    <select aria-label="Stage detection basis" value={basis} onChange={event => setBasis(event.currentTarget.value === "screen" ? "screen" : "window")}>
      <option value="window">Window</option><option value="screen">Screen</option>
    </select>{" "}
    <button className="velora-control" disabled={saved} onClick={async () => {
      if (apply) { apply(detected); return; }
      try { await navigator.clipboard.writeText(command); setFeedback("Stage command copied."); }
      catch { setFeedback(command); }
    }}>{saved ? "Stage in use" : "Use as stage"}</button>
    {feedback && <output role="status">{feedback}</output>}
  </div>;
}
