import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import {
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
  transformOriginCss,
  uniformFocusBlur,
  motionTime,
  withAdditive,
  withCameraAdditive,
  FocusSchema,
  TransformSchema,
  type CameraInput,
  type SceneConstraintInput,
  type FocusInput,
  type Measurements,
  type SceneIssue,
  type TransformInput,
} from "../core";
import { SURFACE_VISUAL_PROPERTIES, motionFingerprint, type MotionInput, type MotionState } from "../core/motion";
import { FocusFilter } from "./FocusFilter";
import { createRegistry } from "./registry";
import { ParentContext, SceneContext, type SurfaceVisuals, type ThreeSelection } from "./context";
import { AppStageContext } from "./stage";
import type { Stage } from "../core/stage";
import type { DepthConfig, DepthMap } from "../core/depth";
import { DepthSurfaceContext, useVolumetricDepth, type DepthDisplay } from "./depth";
export { useSceneTime, type ThreeSelection } from "./context";
import type { SceneInspector } from "./inspector";
import { isElementTarget, type ElementTarget } from "../core/targets";
import { registerTargetScene } from "./anchors";
import { liveRacks } from "../core/shots";

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
const noStrings: Readonly<Record<string, string>> = Object.freeze({});
// DEV-only: motion inputs are immutable (core caches their compiled form). Warn once when a host
// mutates a motion object in place instead of passing a new one.
const development = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
const seenMotion = new WeakMap<object, string>();
let warnedMutation = false;
function checkMotionMutation(motion: MotionInput | undefined) {
  if (!development || warnedMutation || typeof motion !== "object" || motion === null) return;
  const print = motionFingerprint(motion), prior = seenMotion.get(motion);
  seenMotion.set(motion, print);
  if (prior !== undefined && prior !== print) {
    warnedMutation = true;
    console.warn("Velora: a motion object was mutated in place. Pass a new motion object for each change; evaluated frames are cached per object.");
  }
}
const visualKeys: ReadonlySet<string> = new Set(SURFACE_VISUAL_PROPERTIES);
const depthDefault: DepthConfig = Object.freeze({ mode: "auto" });
// Static bases for add-clip offsets on properties without a replace owner.
const FOCUS_BASE = FocusSchema.parse({}), TRANSFORM_BASE = TransformSchema.parse({});
const VISUAL_BASE: Record<string, number> = { opacity: 1, blur: 0, brightness: 1, contrast: 1, saturate: 1, hueRotate: 0, grayscale: 0, clipTop: 0, clipRight: 0, clipBottom: 0, clipLeft: 0 };
const pick = (values: Record<string, number> | undefined, visual: boolean) =>
  values ? Object.fromEntries(Object.entries(values).filter(([key]) => key !== "elevation" && visualKeys.has(key) === visual)) : undefined;
const emptyMotion: MotionState = { surfaces: {}, camera: {}, focus: {}, channels: {}, issues: [] };
const useLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;
const noTargets: readonly ElementTarget[] = [];
export type SceneProps = {
  stage?: Stage;
  depth?: DepthMap;
  depthDisplay?: DepthDisplay;
  motion?: MotionInput;
  timeMs?: number;
  children?: ReactNode;
  camera?: CameraInput;
  focus?: FocusInput;
  /** Scene constraints (lookAt, focusFollow) resolved by the spatial owner from live layout. */
  constraints?: SceneConstraintInput[];
  /** Publish read-only snapshots for editor consumers (see useSceneInspector). */
  inspector?: SceneInspector;
  /** Editor-only director viewpoint: replaces the evaluated camera for display (no constraints, no
   * depth of field). The real camera still drives `inspector` snapshots; capture refuses this view. */
  viewCamera?: CameraInput;
  threeSelection?: ThreeSelection;
  className?: string;
  style?: CSSProperties;
  onDiagnostics?: (issues: SceneIssue[]) => void;
};
export type SurfaceProps = {
  id: string;
  transform?: TransformInput;
  depth?: DepthConfig | "auto" | "off";
  children?: ReactNode;
  content?: ReactNode;
  /** Render the original subtree without a wrapper when used outside a Scene. */
  passthrough?: boolean;
  /** Internal projection override for a full-frame surface that renders its own camera. */
  projectionTransform?: string;
  /** Style the isolated paint wrapper when content needs an explicit size. */
  contentStyle?: CSSProperties;
  className?: string;
  style?: CSSProperties;
};

export function Scene({
  children,
  stage: appStage,
  depth,
  depthDisplay,
  camera,
  focus,
  constraints,
  inspector,
  viewCamera,
  threeSelection,
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
  const measureTargets = !!inspector || typeof window !== "undefined" && !!(window as Window & { __VELORA_MEASURE_TARGETS__?: boolean }).__VELORA_MEASURE_TARGETS__;
  const racks = useMemo(() => liveRacks(motion), [motion]);
  const lockedTargets = useMemo(() => [...(constraints ?? []).map(({ target }) => target), ...racks.flatMap(rack => [rack.from, rack.to])]
    .filter(isElementTarget), [constraints, racks]);
  const inspectTargets = typeof window === "undefined" ? noTargets : (window as Window & { __VELORA_TARGET_QUERIES__?: ElementTarget[] }).__VELORA_TARGET_QUERIES__ ?? noTargets;
  const measuredTargets = useMemo(() => [...lockedTargets, ...inspectTargets], [lockedTargets, inspectTargets]);
  const haveElementTargets = measureTargets || measuredTargets.length > 0;
  useLayout(() => registry.mount(stage.current!), [registry]);
  useLayout(() => {
    registry.refresh();
  });
  checkMotionMutation(motion);
  const result = useMemo(() => {
    const bindings = Array.from(registry.entries.values());
    const state = motion ? RESOURCES["evaluate-motion"](motion, timeMs) : emptyMotion;
    const additive = state.additive;
    const input = {
      camera: withCameraAdditive({ ...camera, ...state.camera }, additive?.camera, state.cameraPositionSpace),
      focus: withAdditive({ ...focus, ...state.focus }, additive?.focus, FOCUS_BASE),
      ...(constraints ? { constraints } : {}),
      nodes: bindings.map((binding) => ({
        id: binding.id,
        parentId: binding.parent
          ? registry.entries.get(binding.parent)?.id
          : undefined,
        transform: withAdditive({
          ...binding.transform,
          // Visual properties style the content leaf; only transform keys reach the spatial node.
          ...Object.fromEntries(
            Object.entries(state.surfaces[binding.id] ?? {}).filter(
              ([key]) => key !== "elevation" && !visualKeys.has(key),
            ),
          ),
        }, pick(additive?.surfaces?.[binding.id], false), TRANSFORM_BASE),
      })),
    };
    const validated = RESOURCES["validate-definition"](input);
    const measurements: Measurements = Object.fromEntries(
      bindings.flatMap((binding) => {
        const measurement = registry.measurements.get(binding.token);
        return measurement ? [[binding.id, measurement] as const] : [];
      }),
    );
    const frame = haveElementTargets || constraints?.length ? stage.current && { width: stage.current.offsetWidth, height: stage.current.offsetHeight } : undefined;
    const elements = haveElementTargets ? registry.elementAnchors.snapshot() : undefined;
    const authored = racks.length && motion ? motionTime(motion, timeMs) : 0;
    const rack = racks.filter(item => item.startMs <= authored).at(-1) ?? racks[0];
    const evaluation = RESOURCES["evaluate-spatial"](input, measurements, { channels: state.channels, anchors: registry.sampleAnchors(state.channels),
      elements, frame: frame ?? undefined, inspectTargets: measuredTargets, ...(rack ? { rack: { ...rack, progress: Math.max(0, Math.min(1, state.channels[rack.channel] ?? 0)) } } : {}) });
    if (!validated.success) for (const target of lockedTargets) if (!bindings.some(binding => binding.id === target.surface)) {
      const issue = evaluation.issues.find(issue => issue.path.startsWith("constraints.") && issue.path.endsWith(".target.surface") && issue.message.endsWith(`: ${target.surface}`));
      if (issue) issue.code = "target-missing";
    }
    const ids = new Set(bindings.map((b) => b.id));
    evaluation.issues.push(
      ...state.issues,
      ...(validated.success && validated.data.focus.maxBlur>0 ? registry.coverageIssues : []),
      ...registry.animatableIssues,
      ...Object.keys(state.surfaces)
        .filter((id) => !ids.has(id))
        .map((id) => ({
          path: "motion." + id,
          message: "Motion target is not registered: " + id,
        })),
      ...Object.keys(state.styles ?? {})
        .filter((id) => !ids.has(id))
        .map((id) => ({
          path: "motion." + id,
          message: "Style target is not registered: " + id,
        })),
    );
    if (!Number.isFinite(timeMs))
      evaluation.issues.push({
        path: "timeMs",
        message: "Scene time must be finite.",
      });
    // Director view: the same nodes seen from the editor's viewpoint, sharp (focus would mislead).
    const view = viewCamera
      ? RESOURCES["evaluate-spatial"]({ camera: viewCamera, focus: { ...input.focus, maxBlur: 0 }, nodes: input.nodes }, measurements, { channels: state.channels, elements, frame: frame ?? undefined, inspectTargets: measuredTargets })
      : undefined;
    return { evaluation, validated, state, view };
  }, [registry, revision, camera, focus, constraints, motion, timeMs, viewCamera, haveElementTargets, measuredTargets, racks]);
  const context = useMemo(
    () => ({
      registry,
      depth,
      depthDisplay,
      elevations: new Map([...new Set([...Object.keys(result.state.surfaces), ...Object.keys(result.state.additive?.surfaces ?? {})])].flatMap(id => {
        const value = result.state.surfaces[id]?.elevation, additive = result.state.additive?.surfaces?.[id]?.elevation;
        return value === undefined && additive === undefined ? [] : [[id, Math.max(0, Math.min(4, (value ?? 1) + (additive ?? 0)))] as const];
      })),
      displayCamera: (result.view ?? result.evaluation).camera ?? (result.validated.success ? result.validated.data.camera : undefined),
      displayFocus: (result.view ?? result.evaluation).focus,
      frameSize: () => stage.current ? { width: stage.current.offsetWidth, height: stage.current.offsetHeight } : undefined,
      threeSelection,
      timeMs: motion ? motionTime(motion, timeMs) : Number.isFinite(timeMs) ? timeMs : 0,
      visuals: new Map(
        [...new Set([...Object.keys(result.state.surfaces), ...Object.keys(result.state.additive?.surfaces ?? {})])].map((id) => [
          id,
          withAdditive(
            Object.fromEntries(Object.entries(result.state.surfaces[id] ?? {}).filter(([key]) => visualKeys.has(key))),
            pick(result.state.additive?.surfaces?.[id], true), VISUAL_BASE,
          ) as SurfaceVisuals,
        ]),
      ),
      channels: result.state.channels,
      colorChannels: result.state.colorChannels ?? noStrings,
      styles: result.state.styles ?? {},
      nodes: new Map((result.view ?? result.evaluation).nodes.map((node) => [node.id, node])),
      transforms: new Map(
        result.validated.success
          ? result.validated.data.nodes.map((node) => [node.id, node.transform])
          : [],
      ),
    }),
    [registry, result, timeMs, motion, threeSelection, depth, depthDisplay],
  );
  const depthReports = [...registry.depthReports.values()];
  const depthAdvisories = [...depthReports.flatMap(report => report.issues), ...(result.evaluation.advisories ?? [])];
  const targetErrors = result.evaluation.issues.filter(issue => issue.code === "target-missing" || issue.code === "target-ambiguous");
  const targetError = targetErrors[0];
  const reportRef = useRef(result.evaluation.targets);
  reportRef.current = result.evaluation.targets;
  useLayout(() => registry.elementAnchors.configure(measuredTargets, measureTargets, context.elevations, !!inspector), [registry, measuredTargets, measureTargets, context.elevations, inspector]);
  useLayout(() => haveElementTargets && stage.current ? registerTargetScene({ scope: stage.current,
    refresh: registry.refresh, reports: () => reportRef.current ?? [] }) : undefined, [registry, haveElementTargets]);
  // Editor consumers observe the committed evaluation; no instances, elements or callbacks leave the Scene.
  useLayout(() => {
    if (!inspector) return;
    const nodes = (result.view ?? result.evaluation).nodes;
    inspector.publish({
      timeMs: context.timeMs,
      bindings: Array.from(registry.entries.values()).map(binding => {
        const measurement = registry.measurements.get(binding.token);
        const parentId = binding.parent ? registry.entries.get(binding.parent)?.id : undefined;
        return { id: binding.id, ...(parentId ? { parentId } : {}), ...(binding.transform ? { transform: { ...binding.transform } } : {}), ...(measurement ? { measurement: { ...measurement } } : {}), mounted: true as const };
      }),
      nodes: nodes.map(node => ({ id: node.id, world: [...node.world], blur: node.blur, depth: node.worldPosition.z, width: node.width, height: node.height })),
      animatables: [...registry.animatables.values()],
      motion: result.state,
      issues: result.evaluation.issues,
      ...(depthAdvisories.length ? { advisories: depthAdvisories } : {}),
      ...(depthReports.length ? { depth: depthReports.map(({ surface, hash, layers, explicitTiers, focus }) => ({ surface, hash, layers, explicitTiers, ...(focus ? { focus } : {}) })) } : {}),
      ...(result.evaluation.targets ? { targets: result.evaluation.targets } : {}),
      ...(result.view?.targets ? { viewTargets: result.view.targets } : {}),
      ...(result.evaluation.camera ? { camera: { ...result.evaluation.camera } } : {}),
      ...(result.evaluation.focus ? { focus: { ...result.evaluation.focus } } : {}),
      ...(result.view?.camera ? { view: { ...result.view.camera } } : {}),
    });
  });
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
  // The resolved camera (after constraints) drives the stage; it equals the input without constraints.
  const validCamera = result.validated.success
    ? (result.view ?? result.evaluation).camera ?? result.validated.data.camera
    : undefined;
  return (
    <SceneContext.Provider value={context}>
      <ParentContext.Provider value={undefined}>
        <div
          className={className}
          data-velora-scene=""
          data-velora-view={viewCamera ? "director" : undefined}
          data-velora-depth-view={depthDisplay && (depthDisplay.tint || depthDisplay.explode !== undefined) ? "" : undefined}
          data-velora-target-error={targetError?.message}
          data-velora-target-only={targetError && targetErrors.length === result.evaluation.issues.length ? "" : undefined}
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
            ...(validCamera?.zoom === undefined ? {} : { scale: validCamera.zoom }),
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
            <AppStageContext.Provider value={appStage}>{children}</AppStageContext.Provider>
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
        {depthAdvisories.length > 0 && <ul data-velora-preview-chrome="" data-velora-depth-advisories="">
          {depthAdvisories.map((issue, index) => <li key={index} data-velora-depth-issue={issue.code}>{issue.message}</li>)}
        </ul>}
      </ParentContext.Provider>
    </SceneContext.Provider>
  );
}

export function Surface({
  id,
  transform,
  depth: authoredDepth,
  children,
  content,
  passthrough,
  projectionTransform,
  contentStyle,
  className,
  style,
}: SurfaceProps) {
  const filterId = "velora-focus-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const context = useContext(SceneContext);
  const parent = useContext(ParentContext);
  const [token] = useState(() => Symbol("velora-binding"));
  const element = useRef<HTMLDivElement>(null);
  const proxies = useRef<HTMLDivElement>(null);
  const registry = context?.registry;
  const recipeDepth = context?.depth && Object.hasOwn(context.depth, id) ? context.depth[id] : undefined;
  const config = recipeDepth ?? (authoredDepth === "auto" ? depthDefault : authoredDepth === "off" ? undefined : authoredDepth);
  const node = context?.nodes.get(id);
  const visual = context?.visuals.get(id) ?? {};
  const paintFilter = contentStyle?.filter ?? leafGrade(leafFilter("none", visual.blur ?? 0), visual);
  const opacity = contentStyle?.opacity ?? visual.opacity ?? 1;
  const alpha = typeof opacity === "number" ? opacity : Number.parseFloat(opacity) / (opacity.endsWith("%") ? 100 : 1);
  const leafGrouping = alpha < 1 ? "opacity" : paintFilter !== "none" ? "filter"
    : contentStyle?.clipPath && contentStyle.clipPath !== "none" || leafClip(visual) ? "clip-path" : undefined;
  const activeDepth = context && config && config.mode !== "off" ? { root: element.current, config, surface: id, registry: context.registry,
    camera: context.displayCamera, focus: context.displayFocus, world: node?.world, width: node?.width, height: node?.height, elevation: context.elevations?.get(id) ?? 1,
    display: context.depthDisplay, light: config.light, intensity: config.intensity, leafGrouping } : undefined;
  useVolumetricDepth(activeDepth, element, proxies);
  useLayout(() => {
    if (!registry || !element.current) return;
    registry.upsert({
      token,
      id,
      parent,
      element: element.current!,
      transform,
    });
  });
  useLayout(() => () => registry?.remove(token), [registry, token]);
  if (!context) {
    if (passthrough) return <>{content}{children}</>;
    throw new Error("Surface and Motion must be rendered inside a Velora Scene.");
  }
  const { transforms } = context;
  const depthFocus = !!activeDepth && [...context.registry.depthReports.values()].some(report => report.surface === id && report.focus?.length);
  const grouped = Array.from(context.registry.entries.values()).some(
    (binding) => binding.parent === token,
  );
  const blur = node?.blur ?? 0;
  const filtering =
    node &&
    node.width > 0 &&
    node.height > 0 &&
    node.focus.maxBlur > 0 &&
    !depthFocus &&
    (content !== undefined || !grouped);
  const uniformBlur = filtering ? uniformFocusBlur(node.focus, node.width, node.height) : 0;
  const variables = Object.hasOwn(context.styles, id) ? context.styles[id] : undefined;
  const leafStyle: CSSProperties = {
    pointerEvents: style?.pointerEvents ?? "auto",
    opacity: visual.opacity ?? 1,
    filter: leafGrade(leafFilter(!filtering || uniformBlur === 0 ? "none" : uniformBlur !== undefined ? uniformBlur : `url(#${filterId})`, visual.blur ?? 0), visual),
    ...(leafClip(visual) ? { clipPath: leafClip(visual) } : {}),
  };
  return (
    <ParentContext.Provider value={token}><DepthSurfaceContext.Provider value={activeDepth}>
      {filtering && uniformBlur === undefined && <FocusFilter id={filterId} node={node} />}
      <div
        ref={element}
        className={className}
        data-velora-id={id}
        data-velora-blur={blur}
        data-velora-depth={node?.worldPosition.z ?? 0}
        style={{
          ...style,
          // Animated CSS custom properties cascade to descendants (var(--name)) without flattening 3D.
          ...variables,
          position: style?.position ?? "relative",
          transform: projectionTransform ?? transformToCss(transforms.get(id)),
          transformOrigin: transformOriginCss(transforms.get(id)),
          transformStyle: "preserve-3d",
          filter: "none",
          opacity: 1,
          overflow: "visible",
          pointerEvents: "none",
        }}
      >
        {content !== undefined && (
          <div data-velora-content="" style={{ ...leafStyle, ...contentStyle }}>
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
        {activeDepth && <div data-velora-depth-proxies="" ref={proxies} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", transformStyle: "preserve-3d" }}/>}
      </div>
    </DepthSurfaceContext.Provider></ParentContext.Provider>
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
// Per-element grade on the visual leaf, after focus and artistic blur, in a fixed order. With no
// grade property the filter string is unchanged.
function leafGrade(filter: string, visual: SurfaceVisuals): string {
  const grade = [
    visual.brightness !== undefined ? `brightness(${visual.brightness})` : "",
    visual.contrast !== undefined ? `contrast(${visual.contrast})` : "",
    visual.saturate !== undefined ? `saturate(${visual.saturate})` : "",
    visual.hueRotate !== undefined ? `hue-rotate(${visual.hueRotate}deg)` : "",
    visual.grayscale !== undefined ? `grayscale(${visual.grayscale})` : "",
  ].filter(Boolean).join(" ");
  if (!grade) return filter;
  return filter === "none" ? grade : `${filter} ${grade}`;
}
// True masks on the visual leaf: a circle (iris) takes precedence over an inset (wipe).
function leafClip(visual: SurfaceVisuals): string | undefined {
  if (visual.clipRadius !== undefined) return `circle(${visual.clipRadius}% at 50% 50%)`;
  const { clipTop: top, clipRight: right, clipBottom: bottom, clipLeft: left } = visual;
  if (top === undefined && right === undefined && bottom === undefined && left === undefined) return undefined;
  return `inset(${top ?? 0}% ${right ?? 0}% ${bottom ?? 0}% ${left ?? 0}%)`;
}
/** A named channel's value at the current scene time (cursor paths, counters, scroll offsets).
 * Channels come from recipe motion tracks, so components follow the one eased clock. */
export function useChannel(id: string, fallback = 0): number {
  const context = useContext(SceneContext);
  if (!context) throw new Error("useChannel requires a Velora Scene.");
  return Object.hasOwn(context.channels, id) ? context.channels[id] : fallback;
}
/** A color channel's canonical rgb() value at the current scene time, or the fallback without a track. */
export function useColorChannel(id: string, fallback: string): string {
  const context = useContext(SceneContext);
  if (!context) throw new Error("useColorChannel requires a Velora Scene.");
  return Object.hasOwn(context.colorChannels, id) ? context.colorChannels[id] : fallback;
}
/** Motion shares Surface registration; Scene supplies canonical evaluated tracks. */
export const Motion = Surface;

export type SceneErrorBoundaryProps = {
  children?: ReactNode;
  resetKey?: unknown;
  fallback?: ReactNode;
  onError?: (error: unknown) => void;
  onReset?: () => void;
};
/** SOURCE OF TRUTH: scene render recovery.
 * WHAT: SceneErrorBoundary owns the scene fallback and resetKey adapter.
 * WHY: preserve a consistent recovery action for failed host components.
 * WHERE: react-error-boundary catches render failures; callers keep their existing API.
 */
export function SceneErrorBoundary({ children, resetKey, fallback, onError, onReset }: SceneErrorBoundaryProps) {
  return (
    <ErrorBoundary fallbackRender={props => fallback === undefined ? <SceneErrorFallback {...props}/> : fallback} resetKeys={[resetKey]} onError={onError} onReset={onReset}>
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

export { useSceneCapture, useCaptureSettle } from "./capture";
export { KineticText, kineticStyle, kineticWordIds, type KineticTextProps } from "./kinetic-text";
export { WebGLSurface, type WebGLSurfaceProps, type WebGLTime } from "./three-bridge";
export { useAnimatable, useAnimatableState, type AnimatableOptions } from "./animatable";
export { createSceneInspector, useSceneInspector, type SceneInspector, type SceneSnapshot, type InspectedBinding, type InspectedNode } from "./inspector";
export { AppStage, useAppStage } from "./stage";
export type { AnimatableEntry } from "./registry";
