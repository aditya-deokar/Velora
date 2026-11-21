import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SceneErrorBoundary, Surface, useCaptureSettle } from "../react";
import { useSceneContext, useSceneTime } from "../react/context";
import { registerGizmo } from "../react/registry";
import { cancelStageCamera } from "./camera";
import { ThreeRuntimeContext, ThreeSeedContext } from "./clock";
import { ThreeRuntime, type FrameInput } from "./runtime";

type BaseProps = {
  id: string;
  seed?: number;
  pixelRatioCap?: number;
  antialias?: boolean;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
  children?: ReactNode;
};
export type ThreeSurfaceProps = BaseProps & ({ camera: "velora"; transform?: never } | { camera?: "local"; transform?: Parameters<typeof Surface>[0]["transform"] });

function FrameDriver({ frame, runtime }: { frame: FrameInput; runtime: ThreeRuntime }) {
  const get = useThree(state => state.get);
  // A resize also needs a fresh projection and paint, even with a stopped timeline.
  useThree(state => state.size);
  useThree(state => state.viewport.dpr);
  useThree(state => state.camera);
  const canvas = useThree(state => state.gl.domElement);

  useLayoutEffect(() => () => runtime.clear(), [runtime]);
  useLayoutEffect(() => {
    runtime.render(frame, get());
  });
  useLayoutEffect(() => {
    if (!canvas.closest('[data-velora-layout="editor"]')) return;
    return registerGizmo(canvas, {
      pick: point => runtime.pick(point),
      hover: point => runtime.hover(point),
      begin: point => runtime.begin(point),
    });
  }, [canvas, runtime]);
  return null;
}

export function ThreeSurface({ id, seed = 0, pixelRatioCap = 1.5, antialias = true, camera = "local", transform, className, style, fallback = null, children }: ThreeSurfaceProps) {
  const { context, parent } = useSceneContext();
  const t = useSceneTime();
  const unified = camera === "velora";
  if (!context) throw new Error("ThreeSurface requires a Velora Scene.");
  if (unified && parent) throw new Error("A ThreeSurface with camera=\"velora\" must be a top-level, full-frame surface.");
  if (!Number.isFinite(pixelRatioCap) || pixelRatioCap <= 0) throw new RangeError("ThreeSurface pixelRatioCap must be positive and finite.");
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("ThreeSurface seed must be an unsigned 32-bit integer.");
  const runtime = useMemo(() => new ThreeRuntime(context.registry, id, unified), [context.registry, id, unified]);
  const [issueToken] = useState(() => Symbol("three-surface"));
  const [dpr, setDpr] = useState(() => typeof window === "undefined" ? 1 : window.devicePixelRatio);
  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio);
    update();
    const media = window.matchMedia(`(resolution: ${dpr}dppx)`);
    media.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => { media.removeEventListener("change", update); window.removeEventListener("resize", update); };
  }, [dpr]);
  useEffect(() => () => runtime.registry.reportIssue(issueToken), [runtime, issueToken]);
  const view = context.displayCamera;
  const frame = useMemo<FrameInput>(() => ({
    seconds: t / 1000, seed, channels: context.channels, colorChannels: context.colorChannels,
    camera: unified ? view : undefined, selection: context.threeSelection,
  }), [t, seed, context.channels, context.colorChannels, unified, view, context.threeSelection]);
  // Loading a model can register new animatables or anchors and publish another Scene
  // snapshot at the same time. Settle against the latest committed input for that seek.
  const requested = useRef(frame);
  useLayoutEffect(() => { requested.current = frame; }, [frame]);
  useCaptureSettle(async () => {
    const deadline = performance.now() + 20_000;
    while (runtime.ready !== requested.current) {
      if (runtime.error) throw runtime.error;
      if (performance.now() > deadline) throw new Error(`ThreeSurface "${id}" did not settle before capture. Check its size and asset loaders.`);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }, () => runtime.hideForCapture());
  function report(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.error = new Error(`ThreeSurface "${id}": ${message}`);
    context!.registry.reportIssue(issueToken, { path: id, message: runtime.error.message });
  }
  const layerStyle: CSSProperties = unified ? {
    ...style, position: "absolute", inset: 0, width: "100%", height: "100%",
  } : { width: "100%", height: "100%", ...style };
  return (
    <Surface id={id} className={className} style={layerStyle} transform={transform} contentStyle={{ width: "100%", height: "100%" }}
      projectionTransform={unified && view ? cancelStageCamera(view) : undefined} content={
      <div data-velora-three-surface={id} data-velora-three-camera={camera} style={{ width: "100%", height: "100%" }}>
        <SceneErrorBoundary resetKey={runtime} fallback={fallback} onError={report}
          onReset={() => { runtime.error = undefined; runtime.registry.reportIssue(issueToken); }}>
          <Canvas frameloop="never" resize={{ offsetSize: true }} gl={{ preserveDrawingBuffer: true, antialias }}
            dpr={Math.min(dpr, pixelRatioCap)} camera={unified ? { near: 0.1, far: 100_000 } : undefined}
            style={{ width: "100%", height: "100%" }} fallback={fallback}>
            <ThreeRuntimeContext.Provider value={runtime}>
              <ThreeSeedContext.Provider value={seed}>
                <Suspense fallback={null}>
                  {children}
                  <FrameDriver runtime={runtime} frame={frame}/>
                </Suspense>
              </ThreeSeedContext.Provider>
            </ThreeRuntimeContext.Provider>
          </Canvas>
        </SceneErrorBoundary>
      </div>
    }/>
  );
}
