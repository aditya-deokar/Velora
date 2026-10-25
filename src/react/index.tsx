import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  RESOURCES,
  SCENE_BACKGROUND,
  cameraToCss,
  transformToCss,
  uniformFocusBlur,
  motionTime,
  type CameraInput,
  type EvaluatedNode,
  type FocusInput,
  type Measurements,
  type SceneIssue,
  type TransformInput,
} from "../core";
import { SURFACE_VISUAL_PROPERTIES, type MotionInput, type MotionState, type SurfaceVisualProperty } from "../core/motion";
import { FocusFilter } from "./FocusFilter";
import { createRegistry, type Registry } from "./registry";

/** SOURCE OF TRUTH: Scene / Surface / Motion live DOM adapter.
 * WHAT: bind existing React subtrees to the canonical core spatial operation.
 * WHY: providers, events and state stay in their original React tree during focus
 * and transform edits. Core alone validates configuration and computes focal depth.
 * WHERE: registry.ts owns DOM layout; ../core owns schema and transform order.
 * Composition: content is an isolated visual leaf; children may contain spatial
 * groups. Without content, ordinary children blur until a nested node registers.
 * Spatial containers ignore pointer hits; live visual leaves receive events.
 * A grouping wrapper never filters descendants. Put group backgrounds in content.
 * Host intermediary filters, opacity, paint containment, clipping/overflow and CSS
 * transforms can flatten or change 3D geometry: use Surface/Motion for transforms,
 * and put clipping, opacity and decoration on content leaves. Layout styles belong
 * on wrappers. Arbitrary host layout shifts require resize or a React commit.
 */
type SurfaceVisuals = Partial<Record<SurfaceVisualProperty, number>>;
type SceneContextValue = {
  registry: Registry;
  nodes: Map<string, EvaluatedNode>;
  transforms: Map<string, TransformInput>;
  visuals: Map<string, SurfaceVisuals>;
  channels: Readonly<Record<string, number>>;
  timeMs: number;
};
const visualKeys: ReadonlySet<string> = new Set(SURFACE_VISUAL_PROPERTIES);
const emptyMotion: MotionState = { surfaces: {}, camera: {}, focus: {}, channels: {}, issues: [] };
const SceneContext = createContext<SceneContextValue | null>(null);
const ParentContext = createContext<symbol | undefined>(undefined);
const useLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;
export type SceneProps = {
  motion?: MotionInput;
  timeMs?: number;
  children?: ReactNode;
  camera?: CameraInput;
  focus?: FocusInput;
  className?: string;
  style?: CSSProperties;
  onDiagnostics?: (issues: SceneIssue[]) => void;
};
export type SurfaceProps = {
  id: string;
  transform?: TransformInput;
  children?: ReactNode;
  content?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

export function Scene({
  children,
  camera,
  focus,
  motion,
  timeMs = 0,
  className,
  style,
  onDiagnostics,
}: SceneProps) {
  const [registry] = useState(createRegistry);
  const revision = useSyncExternalStore(
    registry.subscribe,
    registry.snapshot,
    registry.snapshot,
  );
  const stage = useRef<HTMLDivElement>(null);
  useLayout(() => registry.mount(stage.current!), [registry]);
  useLayout(() => {
    registry.refresh();
  });
  const result = useMemo(() => {
    const bindings = Array.from(registry.entries.values());
    const state = motion ? RESOURCES["evaluate-motion"](motion, timeMs) : emptyMotion;
    const input = {
      camera: { ...camera, ...state.camera },
      focus: { ...focus, ...state.focus },
      nodes: bindings.map((binding) => ({
        id: binding.id,
        parentId: binding.parent
          ? registry.entries.get(binding.parent)?.id
          : undefined,
        transform: {
          ...binding.transform,
          // Visual properties style the content leaf; only transform keys reach the spatial node.
          ...Object.fromEntries(
            Object.entries(state.surfaces[binding.id] ?? {}).filter(
              ([key]) => !visualKeys.has(key),
            ),
          ),
        },
      })),
    };
    const validated = RESOURCES["validate-definition"](input);
    const measurements: Measurements = Object.fromEntries(
      bindings.flatMap((binding) => {
        const measurement = registry.measurements.get(binding.token);
        return measurement ? [[binding.id, measurement] as const] : [];
      }),
    );
    const evaluation = RESOURCES["evaluate-spatial"](input, measurements);
    const ids = new Set(bindings.map((b) => b.id));
    evaluation.issues.push(
      ...state.issues,
      ...(validated.success && validated.data.focus.maxBlur>0 ? registry.coverageIssues : []),
      ...Object.keys(state.surfaces)
        .filter((id) => !ids.has(id))
        .map((id) => ({
          path: "motion." + id,
          message: "Motion target is not registered: " + id,
        })),
    );
    if (!Number.isFinite(timeMs))
      evaluation.issues.push({
        path: "timeMs",
        message: "Scene time must be finite.",
      });
    return { evaluation, validated, state };
  }, [registry, revision, camera, focus, motion, timeMs]);
  const context = useMemo(
    () => ({
      registry,
      timeMs: motion ? motionTime(motion, timeMs) : Number.isFinite(timeMs) ? timeMs : 0,
      visuals: new Map(
        Object.entries(result.state.surfaces).map(([id, s]) => [
          id,
          Object.fromEntries(Object.entries(s).filter(([key]) => visualKeys.has(key))) as SurfaceVisuals,
        ]),
      ),
      channels: result.state.channels,
      nodes: new Map(result.evaluation.nodes.map((node) => [node.id, node])),
      transforms: new Map(
        result.validated.success
          ? result.validated.data.nodes.map((node) => [node.id, node.transform])
          : [],
      ),
    }),
    [registry, result, timeMs, motion],
  );
  // Callback identity can change when the host stores diagnostics in state. Only
  // issue changes notify it, including a single empty report after correction.
  const callback = useRef(onDiagnostics);
  callback.current = onDiagnostics;
  const issueKey = JSON.stringify(result.evaluation.issues);
  const lastReported = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastReported.current !== issueKey) {
      lastReported.current = issueKey;
      callback.current?.(JSON.parse(issueKey) as SceneIssue[]);
    }
  }, [issueKey]);
  const validCamera = result.validated.success
    ? result.validated.data.camera
    : undefined;
  return (
    <SceneContext.Provider value={context}>
      <ParentContext.Provider value={undefined}>
        <div
          className={className}
          data-velora-scene=""
          data-velora-valid={result.evaluation.issues.length===0 ? "true" : "false"}
          style={{
            ...style,
            background: SCENE_BACKGROUND,
            backgroundColor: SCENE_BACKGROUND,
            backgroundImage: "none",
            position: style?.position ?? "relative",
            pointerEvents: "none",
            perspective: validCamera?.perspective ?? 1400,
            perspectiveOrigin: "50% 50%",
            // Keep the backdrop outside the 3D sorting context so negative-z UI stays visible.
            // The inner camera stage preserves depth among all surfaces.
            transformStyle: "flat",
          }}
        >
          <div
            ref={stage}
            data-velora-stage=""
            style={{
              position: "relative",
              pointerEvents: "none",
              width: "100%",
              height: "100%",
              transformStyle: "preserve-3d",
              transformOrigin: "50% 50%",
              transform: cameraToCss(validCamera),
            }}
          >
            {children}
          </div>
        </div>
        {result.evaluation.issues.length > 0 && (
          <div role="alert" data-velora-diagnostics="">
            <strong>Velora scene needs a correction.</strong>
            <ul>
              {result.evaluation.issues.map((issue, index) => (
                <li key={index}>
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
            <p>
              Correct the scene props or registered IDs; the scene updates
              automatically.
            </p>
          </div>
        )}
      </ParentContext.Provider>
    </SceneContext.Provider>
  );
}

export function Surface({
  id,
  transform,
  children,
  content,
  className,
  style,
}: SurfaceProps) {
  const filterId = "velora-focus-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const context = useContext(SceneContext);
  const parent = useContext(ParentContext);
  const [token] = useState(() => Symbol("velora-binding"));
  const element = useRef<HTMLDivElement>(null);
  if (!context)
    throw new Error(
      "Surface and Motion must be rendered inside a Velora Scene.",
    );
  const { registry, nodes, transforms } = context;
  useLayout(() => {
    registry.upsert({
      token,
      id,
      parent,
      element: element.current!,
      transform,
    });
  });
  useLayout(() => () => registry.remove(token), [registry, token]);
  const node = nodes.get(id);
  const grouped = Array.from(registry.entries.values()).some(
    (binding) => binding.parent === token,
  );
  const blur = node?.blur ?? 0;
  const filtering =
    node &&
    node.width > 0 &&
    node.height > 0 &&
    node.focus.maxBlur > 0 &&
    (content !== undefined || !grouped);
  const uniformBlur = filtering ? uniformFocusBlur(node.focus, node.width, node.height) : 0;
  const visual = context.visuals.get(id) ?? {};
  const leafStyle: CSSProperties = {
    pointerEvents: style?.pointerEvents ?? "auto",
    opacity: visual.opacity ?? 1,
    filter: leafFilter(!filtering || uniformBlur === 0 ? "none" : uniformBlur !== undefined ? uniformBlur : `url(#${filterId})`, visual.blur ?? 0),
    ...(leafClip(visual) ? { clipPath: leafClip(visual) } : {}),
  };
  return (
    <ParentContext.Provider value={token}>
      {filtering && uniformBlur === undefined && <FocusFilter id={filterId} node={node} />}
      <div
        ref={element}
        className={className}
        data-velora-id={id}
        data-velora-blur={blur}
        data-velora-depth={node?.worldPosition.z ?? 0}
        style={{
          ...style,
          position: style?.position ?? "relative",
          transform: transformToCss(transforms.get(id)),
          transformOrigin: "50% 50%",
          transformStyle: "preserve-3d",
          filter: "none",
          opacity: 1,
          overflow: "visible",
          pointerEvents: "none",
        }}
      >
        {content !== undefined && (
          <div data-velora-content="" style={leafStyle}>
            {content}
          </div>
        )}
        <div
          data-velora-content={
            content === undefined && !grouped ? "" : undefined
          }
          style={{
            transformStyle: "preserve-3d",
            ...(content === undefined && !grouped
              ? leafStyle
              : { filter: "none", pointerEvents: "none" }),
          }}
        >
          {children}
        </div>
      </div>
    </ParentContext.Provider>
  );
}

// Depth-of-field and artistic blur compose: two Gaussians combine in quadrature, and a
// depth kernel filter chains the artistic blur after it.
function leafFilter(focus: "none" | number | string, artistic: number): string {
  if (artistic <= 0) return focus === "none" ? "none" : typeof focus === "number" ? `blur(${focus}px)` : focus;
  if (focus === "none") return `blur(${artistic}px)`;
  if (typeof focus === "number") return `blur(${Math.hypot(focus, artistic)}px)`;
  return `${focus} blur(${artistic}px)`;
}
// True masks on the visual leaf: a circle (iris) takes precedence over an inset (wipe).
function leafClip(visual: SurfaceVisuals): string | undefined {
  if (visual.clipRadius !== undefined) return `circle(${visual.clipRadius}% at 50% 50%)`;
  const { clipTop: top, clipRight: right, clipBottom: bottom, clipLeft: left } = visual;
  if (top === undefined && right === undefined && bottom === undefined && left === undefined) return undefined;
  return `inset(${top ?? 0}% ${right ?? 0}% ${bottom ?? 0}% ${left ?? 0}%)`;
}
/** Opt-in component adapters read the same explicit time used by spatial tracks. */
export function useSceneTime(): number {
  const context = useContext(SceneContext);
  if (!context) throw new Error("useSceneTime requires a Velora Scene.");
  return context.timeMs;
}
/** A named channel's value at the current scene time (cursor paths, counters, scroll offsets).
 * Channels come from recipe motion tracks, so components follow the one eased clock. */
export function useChannel(id: string, fallback = 0): number {
  const context = useContext(SceneContext);
  if (!context) throw new Error("useChannel requires a Velora Scene.");
  return Object.hasOwn(context.channels, id) ? context.channels[id] : fallback;
}
/** Motion shares Surface registration; Scene supplies canonical evaluated tracks. */
export const Motion = Surface;

export type SceneErrorBoundaryProps = {
  children?: ReactNode;
  resetKey?: unknown;
  onError?: (error: unknown) => void;
  onReset?: () => void;
};
/** SOURCE OF TRUTH: scene render recovery.
 * WHAT: SceneErrorBoundary owns the scene fallback and resetKey adapter.
 * WHY: preserve a consistent recovery action for failed host components.
 * WHERE: react-error-boundary catches render failures; callers keep their existing API.
 */
export function SceneErrorBoundary({ children, resetKey, onError, onReset }: SceneErrorBoundaryProps) {
  return (
    <ErrorBoundary FallbackComponent={SceneErrorFallback} resetKeys={[resetKey]} onError={onError} onReset={onReset}>
      {children}
    </ErrorBoundary>
  );
}

function SceneErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" data-velora-error="">
      <strong>Unable to render the Velora scene.</strong>
      <p>{message}</p>
      <p>Correct the component or scene configuration, then retry.</p>
      <button type="button" onClick={resetErrorBoundary}>
        Retry scene
      </button>
    </div>
  );
}

export { useSceneCapture } from "./capture";
export { KineticText, kineticStyle, kineticWordIds, type KineticTextProps } from "./kinetic-text";
export { WebGLSurface, type WebGLSurfaceProps, type WebGLTime } from "./three-bridge";
