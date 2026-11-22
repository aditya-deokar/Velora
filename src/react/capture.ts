import { CaptureManifestSchema, type CaptureBridge } from "../core/export";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { Stage } from "../core/stage";
import { captureDepth, revertCaptureDepth } from "./depth/evidence";
import { captureTargets, refreshTargetScenes } from "./anchors";
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
export function useCaptureSettle(settle: Settle, beforeSeek?: () => void, enabled = true): void {
  const current = useRef({ settle, beforeSeek });
  current.current = { settle, beforeSeek };
  useEffect(() => {
    if (!enabled) return;
    const entry = current;
    settlers.add(entry);
    return () => { settlers.delete(entry); };
  }, [enabled]);
}
export function useSceneCapture({durationMs,seek,selector='[data-velora-capture="scene"]',look,stage}:
  {durationMs:number;seek:(elapsedMs:number)=>void;selector?:string;look?:unknown;stage?:Stage}) {
  const current=useRef(seek);
  const velocityBlur = useRef(true);
  current.current=seek;
  useEffect(()=>{
    const host=window as typeof window & {__VELORA_CAPTURE__?:unknown};
    if(host.__VELORA_CAPTURE__) throw new Error("Only one capture viewport can be registered per page.");
    let activeViewport: Element | null = null;
    const applyBlur = (viewport: Element | null) => viewport?.toggleAttribute("data-velora-velocity-blur-disabled", !velocityBlur.current);
    const verify=(inventory?: boolean)=>{
      const viewport=document.querySelector(selector);
      if(viewport?.matches('[data-velora-view="director"]') || viewport?.querySelector('[data-velora-view="director"]'))
        throw new Error("Return to camera view before exporting.");
      if (viewport?.querySelector('[data-velora-depth-view]')) throw new Error("Close Depth view before exporting.");
      const target = viewport?.getAttribute('data-velora-target-error') ?? viewport?.querySelector('[data-velora-target-error]')?.getAttribute('data-velora-target-error');
      if (target && !inventory) throw new Error(`ERR_TARGET_MISSING: ${target}`);
      const invalid = inventory ? '[data-velora-valid="false"]:not([data-velora-target-only])' : '[data-velora-valid="false"]';
      if(viewport?.matches(invalid) || viewport?.querySelector(invalid))
        throw new Error("Correct scene diagnostics before exporting.");
    };
    const captureStage = stage && { width: stage.width, height: stage.height, dpr: stage.dpr, ...(stage.preset ? { preset: stage.preset } : {}) };
    const bridge:CaptureBridge={...CaptureManifestSchema.parse({version:1,durationMs,selector,...(look?{look}:{}),...(captureStage ? {stage:captureStage} : {})}),
      configure(options) {
        if (options.velocityBlur !== undefined) velocityBlur.current = options.velocityBlur;
        applyBlur(document.querySelector(selector));
      },
      get blurMode() { return this.look?.velocityBlur ? velocityBlur.current ? "velocity" : "shutter" : undefined; },
      get depth() {
        const depth = captureDepth(document.querySelector(selector));
        return depth.length ? depth : undefined;
      }, get anchors() {
        const targets = captureTargets(document.querySelector(selector));
        return targets.length ? targets : undefined;
      }, seek:(elapsedMs:number, options)=>{
      if(!Number.isFinite(elapsedMs)||elapsedMs<0||elapsedMs>durationMs) throw new Error("Capture time is outside the scene.");
      settlers.forEach(entry => entry.current.beforeSeek?.());
      activeViewport = document.querySelector(selector);
      if (!velocityBlur.current) applyBlur(activeViewport);
      flushSync(()=>current.current(elapsedMs));
      if(!settlers.size){flushSync(()=>refreshTargetScenes(activeViewport));verify(options?.inventory);return;}
      const settle = () => Promise.all([...settlers].map(entry=>entry.current.settle()));
      return settle().then(async () => {
        if (flushSync(() => refreshTargetScenes(activeViewport))) await settle();
        verify(options?.inventory);
      });
    }};
    host.__VELORA_CAPTURE__=bridge;
    return ()=>{
      if ((window as Window & { __VELORA_CAPTURING__?: boolean }).__VELORA_CAPTURING__) revertCaptureDepth(activeViewport ?? document.querySelector(selector));
      activeViewport?.removeAttribute("data-velora-velocity-blur-disabled");
      document.querySelector(selector)?.removeAttribute("data-velora-velocity-blur-disabled");
      if(host.__VELORA_CAPTURE__===bridge)delete host.__VELORA_CAPTURE__;
    };
  },[durationMs,selector,look,stage]);
}
