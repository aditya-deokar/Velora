import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { WebGLSceneSchema } from "../core/three";
import type { SceneIssue } from "../core/scene";

/** WebGLSurface: a time-disciplined WebGL leaf for Three.js scenes.
 * WHAT: hosts a canvas whose scene update is a pure function of video time.
 * WHY: WebGL content must replay deterministically under the frame clock.
 * WHERE: scenes wrap it in a Surface leaf; recipe motion animates that leaf.
 * No rAF loop, no ticker, no wall-clock: the render callback receives exactly
 * {t, seed, width, height} and must paint synchronously. Capture samples the
 * canvas like any Surface. Without a context it reports ERR_WEBGL_CONTEXT and
 * shows fallback content instead of throwing.
 */
export type WebGLTime = { t: number; seed: number; width: number; height: number };
export type WebGLSurfaceProps = {
  scene?: unknown;
  timeMs: number;
  render: (gl: WebGLRenderingContext | WebGL2RenderingContext, time: WebGLTime) => void;
  fallback?: ReactNode;
  onDiagnostics?: (issues: SceneIssue[]) => void;
  className?: string;
  style?: CSSProperties;
};
export function WebGLSurface({ scene, timeMs, render, fallback, onDiagnostics, className, style }: WebGLSurfaceProps): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const renderRef = useRef(render);
  renderRef.current = render;
  const diagnosticsRef = useRef(onDiagnostics);
  diagnosticsRef.current = onDiagnostics;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parsed = WebGLSceneSchema.safeParse(scene ?? {});
    if (!parsed.success) {
      diagnosticsRef.current?.(parsed.error.issues.map((issue) => ({ path: `scene.${issue.path.join(".")}`, message: issue.message })));
      return;
    }
    const options = parsed.data;
    const ratio = Math.min(typeof window === "undefined" || !window.devicePixelRatio ? 1 : window.devicePixelRatio, options.pixelRatioCap);
    canvas.width = Math.max(2, Math.round((options.width * ratio) / 2) * 2);
    canvas.height = Math.max(2, Math.round((options.height * ratio) / 2) * 2);
    const gl = canvas.getContext("webgl2", { antialias: options.antialias })
      ?? canvas.getContext("webgl", { antialias: options.antialias });
    if (!gl) {
      diagnosticsRef.current?.([{ path: "canvas", message: "WebGL context creation failed (ERR_WEBGL_CONTEXT). This device cannot render WebGL; supply fallback content." }]);
      return;
    }
    try {
      renderRef.current(gl, { t: timeMs, seed: options.seed, width: options.width, height: options.height });
    } catch (error) {
      diagnosticsRef.current?.([{ path: "render", message: error instanceof Error ? error.message : "WebGL render callback threw." }]);
    }
  }, [scene, timeMs]);
  return <canvas ref={ref} className={className} style={{ display: "block", ...(style ?? {}) }}>{fallback ?? null}</canvas>;
}
