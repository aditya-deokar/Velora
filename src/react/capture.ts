import { CaptureManifestSchema, type CaptureBridge } from "../core/export";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
/** SOURCE OF TRUTH: useSceneCapture, useCaptureSettle.
 * WHAT: expose a single explicitly registered live viewport to local frame capture, and let
 * components that paint asynchronously (iframes, lazy media) settle each seek before capture.
 * WHY: exports seek the same controller/Scene clock; no second animation evaluator.
 * WHERE: Node export services read this bridge (awaiting a returned promise); callers mark their capture viewport.
 * No network listener, file access, or authentication lives in this browser adapter.
 */
type Settle = () => Promise<void> | void;
const settlers = new Set<{ current: Settle }>();
/** Register work that must finish after every capture seek (for example: an iframe scrolled to the
 * new time has decoded its visible images). Without registered settlers seeks stay synchronous. */
export function useCaptureSettle(settle: Settle): void {
  const current = useRef(settle);
  current.current = settle;
  useEffect(() => {
    const entry = current;
    settlers.add(entry);
    return () => { settlers.delete(entry); };
  }, []);
}
export function useSceneCapture({durationMs,seek,selector='[data-velora-capture="scene"]'}:
  {durationMs:number;seek:(elapsedMs:number)=>void;selector?:string}) {
  const current=useRef(seek);
  current.current=seek;
  useEffect(()=>{
    const host=window as typeof window & {__VELORA_CAPTURE__?:unknown};
    if(host.__VELORA_CAPTURE__) throw new Error("Only one capture viewport can be registered per page.");
    const verify=()=>{
      const viewport=document.querySelector(selector);
      if(viewport?.matches('[data-velora-valid="false"]') || viewport?.querySelector('[data-velora-valid="false"]'))
        throw new Error("Correct scene diagnostics before exporting; some content may bypass depth of field.");
    };
    const bridge:CaptureBridge={...CaptureManifestSchema.parse({version:1,durationMs,selector}),seek:(elapsedMs:number)=>{
      if(!Number.isFinite(elapsedMs)||elapsedMs<0||elapsedMs>durationMs) throw new Error("Capture time is outside the scene.");
      flushSync(()=>current.current(elapsedMs));
      if(!settlers.size){verify();return;}
      return Promise.all([...settlers].map(entry=>entry.current())).then(verify);
    }};
    host.__VELORA_CAPTURE__=bridge;
    return ()=>{if(host.__VELORA_CAPTURE__===bridge)delete host.__VELORA_CAPTURE__};
  },[durationMs,selector]);
}
