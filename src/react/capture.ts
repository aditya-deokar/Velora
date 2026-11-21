import { CaptureManifestSchema, type CaptureBridge } from "../core/export";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { Stage } from "../core/stage";
/** SOURCE OF TRUTH: useSceneCapture, useCaptureSettle.
 * WHAT: expose a single explicitly registered live viewport to local frame capture, and let
 * components that paint asynchronously (iframes, lazy media) settle each seek before capture.
 * WHY: exports seek the same controller/Scene clock; no second animation evaluator.
 * WHERE: Node export services read this bridge (awaiting a returned promise); callers mark their capture viewport.
 * No network listener, file access, or authentication lives in this browser adapter.
 */
type Settle = () => Promise<void> | void;
const settlers = new Set<{ current: { settle: Settle; beforeSeek?: () => void } }>();
/** Register work that must finish after every capture seek (for example: an iframe scrolled to the
 * new time has decoded its visible images). Without registered settlers seeks stay synchronous. */
export function useCaptureSettle(settle: Settle, beforeSeek?: () => void): void {
  const current = useRef({ settle, beforeSeek });
  current.current = { settle, beforeSeek };
  useEffect(() => {
    const entry = current;
    settlers.add(entry);
    return () => { settlers.delete(entry); };
  }, []);
}
export function useSceneCapture({durationMs,seek,selector='[data-velora-capture="scene"]',look,stage}:
  {durationMs:number;seek:(elapsedMs:number)=>void;selector?:string;look?:unknown;stage?:Stage}) {
  const current=useRef(seek);
  current.current=seek;
  useEffect(()=>{
    const host=window as typeof window & {__VELORA_CAPTURE__?:unknown};
    if(host.__VELORA_CAPTURE__) throw new Error("Only one capture viewport can be registered per page.");
    const verify=()=>{
      const viewport=document.querySelector(selector);
      if(viewport?.matches('[data-velora-view="director"]') || viewport?.querySelector('[data-velora-view="director"]'))
        throw new Error("Return to camera view before exporting.");
      if(viewport?.matches('[data-velora-valid="false"]') || viewport?.querySelector('[data-velora-valid="false"]'))
        throw new Error("Correct scene diagnostics before exporting.");
    };
    const captureStage = stage && { width: stage.width, height: stage.height, dpr: stage.dpr, ...(stage.preset ? { preset: stage.preset } : {}) };
    const bridge:CaptureBridge={...CaptureManifestSchema.parse({version:1,durationMs,selector,...(look?{look}:{}),...(captureStage ? {stage:captureStage} : {})}),seek:(elapsedMs:number)=>{
      if(!Number.isFinite(elapsedMs)||elapsedMs<0||elapsedMs>durationMs) throw new Error("Capture time is outside the scene.");
      settlers.forEach(entry => entry.current.beforeSeek?.());
      flushSync(()=>current.current(elapsedMs));
      if(!settlers.size){verify();return;}
      return Promise.all([...settlers].map(entry=>entry.current.settle())).then(verify);
    }};
    host.__VELORA_CAPTURE__=bridge;
    return ()=>{if(host.__VELORA_CAPTURE__===bridge)delete host.__VELORA_CAPTURE__};
  },[durationMs,selector,look,stage]);
}
