import { createContext, useContext, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { depthIntensity, evaluateDepthLayers, hashDepthLayers, sampleDepthFocus, type DepthConfig, type DepthEvidence, type DepthFocusSample, type ResolvedDepth } from "../../core/depth";
import type { CameraDefinition, FocusDefinition, SceneIssue } from "../../core/scene";
import { multiply, type Matrix } from "../../core/spatial";
import { layoutPlacement, type Registry } from "../registry";
import { bindTargetDepth } from "../anchors";
import { useCaptureSettle } from "../capture";
import { createStyleLedger, type DepthElement } from "./ledger";
import { describeDepth, depthMatch, readDepthSnapshot } from "./snapshot";
import { projectedStyles, px } from "./Projected";
import { makeDepthProxy } from "./Volumetric";
import { registerDepthEvidence } from "./evidence";
import { createLayerFocus } from "./focus";

const useLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;
export type DepthDisplay = { tint: boolean; explode?: number };
export type DepthReport = DepthEvidence & { volumetric: boolean; issues: SceneIssue[]; explicitTiers: number[]; source: "surface" | "route" };
type DepthPose = { world?: Matrix; camera?: CameraDefinition; width?: number; height?: number; elevation: number; display?: DepthDisplay;
  light?: DepthConfig["light"]; intensity?: DepthConfig["intensity"]; focus?: FocusDefinition };
export type SurfaceDepth = DepthPose & { surface: string; config: DepthConfig; root: HTMLDivElement | null; registry: Registry; leafGrouping?: string };
export const DepthSurfaceContext = createContext<SurfaceDepth | undefined>(undefined);
export const useSurfaceDepthActive = () => {
  const depth = useContext(DepthSurfaceContext);
  return !!depth && depth.config.mode !== "off";
};
const controllers = new Set<() => void>();
import.meta.hot?.dispose(() => { for (const dispose of controllers) dispose(); });

function hostRoot(surface: HTMLElement) {
  const content = [...surface.children].filter(element => !element.hasAttribute("data-velora-depth-proxies"));
  const leaf = content.length === 1 ? content[0] : undefined;
  const app = leaf?.children.length === 1 ? leaf.firstElementChild : undefined;
  return app?.hasAttribute("data-velora-app-stage") ? app as HTMLElement : surface;
}
function placementFor(surface: HTMLElement, anchor: HTMLElement) {
  const { x, y, sx, sy } = layoutPlacement(surface, anchor);
  return { x, y, sx, sy, css: `translate(${px(x)}, ${px(y)}) scale(${sx}, ${sy})` };
}

const empty: ResolvedDepth = { hash: hashDepthLayers([]), layers: [] };
function mountDepth(depth: SurfaceDepth, target: HTMLElement, proxyRoot?: HTMLDivElement, finishCapture?: () => void) {
  const { surface, config, registry } = depth;
  const route = target.localName === "iframe";
  const anchor = route ? target : hostRoot(target);
  const root = route ? (target as HTMLIFrameElement).contentDocument?.body : anchor;
  const doc = root?.ownerDocument, view = doc?.defaultView;
  if (!root || !doc || !view || !depth.root) return;
  const surfaceRoot = depth.root;
  const token = Symbol(surface);
  const issue = (code: string, message: string, detail?: string): SceneIssue => ({ code, path: `definition.depth.${surface}${detail ? "." + detail : ""}`, message });
  const contested = new Map<string, SceneIssue>();
  const ledger = createStyleLedger(doc, (element, property) => {
    const match = depthMatch(element);
    const label = "anchor" in match ? match.anchor : match.selector;
    contested.set(`${label}:${property}`, issue("depth-contested", `Host kept changing ${property} on ${label}.`));
    report();
  });
  let resolved = empty;
  let diagnostics: SceneIssue[] = [];
  let explicitTiers: number[] = [];
  let volumes = false;
  let projections = false;
  let focusSamples: DepthFocusSample[] | undefined;
  let focusEvidence = () => focusSamples;
  let approximate = false;
  let snapshotSize = { width: 0, height: 0 };
  let invalid = true;
  let disposed = false;
  let scheduled: number | undefined;
  let geometry = placementFor(surfaceRoot, anchor);
  let layers: ReturnType<typeof describeDepth>["layers"] = [];
  let usable = new Map<number, { element: DepthElement; volume: boolean; radius: string; color: string;
    origin: [number, number]; paintedZ?: number; proxy?: ReturnType<typeof makeDepthProxy> }>();
  let pose: DepthPose = depth;
  const unbindTargets = bindTargetDepth(target, () => layers.map((layer, index) => ({ element: usable.get(layer.order)!.element, z: layer.z * depthIntensity(pose.intensity), base: (layer.z - layer.localZ) * depthIntensity(pose.intensity), tier: layer.tier, match: resolved.layers[index]?.match })),
    route ? read => ledger.withoutTransform(read) : undefined);
  const optics = createLayerFocus(target, ledger, proxyRoot);
  const report = () => {
    const issues = [...diagnostics, ...contested.values(), ...(approximate ? [issue("dof-approximate", "Terminal layers approximate focus where a depth veil would flatten or blur the wrong region.")] : [])];
    registry.reportDepth(token, layers.length || issues.length ? { surface, ...resolved, ...(focusSamples ? { focus: focusSamples } : {}), volumetric: volumes, source: route ? "route" : "surface", issues, explicitTiers } : undefined);
  };
  function rebuild() {
    invalid = false;
    optics.reset();
    ledger.revert();
    proxyRoot?.replaceChildren();
    geometry = placementFor(surfaceRoot, anchor);
    const data = readDepthSnapshot(root!, config, route);
    snapshotSize = { width: data.snapshot.width, height: data.snapshot.height };
    const result = describeDepth(data, config);
    layers = result.layers;
    resolved = result.resolved;
    usable.clear();
    diagnostics = [];
    explicitTiers = [];
    const preserved = new Set<DepthElement>();
    for (const [index, layer] of layers.entries()) {
      const element = data.elements.get(layer.order)!;
      if (element.hasAttribute("data-velora-tier")) explicitTiers.push(index);
      const computed = view!.getComputedStyle(element);
      const property = layer.flattened?.property ?? depth.leafGrouping;
      const volume = !!proxyRoot && config.render !== "projected" && !property;
      if (!route && property && config.render !== "projected") {
        const obstacle = layer.flattened && data.elements.get(layer.flattened.order);
        const label = obstacle?.id ? `#${obstacle.id}` : obstacle?.localName ?? "ancestor";
        const match = resolved.layers[index]?.match;
        const name = match && ("anchor" in match ? match.anchor : match.selector);
        diagnostics.push(issue("depth-flattened", `${name ?? element.localName} is flattened by ${property} on ${label}. Move clipping or opacity to a content leaf, or mark the ancestor data-velora-tier="flat".`, String(layer.order)));
      }
      if (volume) for (let parent = element.parentElement; parent && parent !== surfaceRoot; parent = parent.parentElement) {
        if ("style" in parent) preserved.add(parent as DepthElement);
      }
      const [ox, oy] = computed.transformOrigin.split(" ").map(Number.parseFloat);
      const origin: [number, number] = [Number.isFinite(ox) ? ox : layer.rect.width / 2, Number.isFinite(oy) ? oy : layer.rect.height / 2];
      const color = computed.backgroundColor === "rgba(0, 0, 0, 0)" ? "#8492a7" : computed.backgroundColor || "#8492a7";
      usable.set(layer.order, { element, volume, origin, color, radius: computed.borderRadius || "0px", ...(volume && proxyRoot ? { proxy: makeDepthProxy(proxyRoot) } : {}) });
    }
    for (const element of preserved) ledger.apply(element, { "transform-style": "preserve-3d" });
    volumes = [...usable.values()].some(value => value.volume);
    projections = [...usable.values()].some(value => !value.volume);
    resize?.disconnect();
    resize?.observe(root!);
    if (surfaceRoot !== root && surfaceRoot.ownerDocument === doc) resize?.observe(surfaceRoot);
    for (const { element } of usable.values()) resize?.observe(element);
    registry.elementAnchors.schedule();
  }
  const paint = () => {
    if (disposed) return;
    const rebuilt = invalid;
    if (rebuilt) rebuild();
    if (!pose.world || !pose.camera || !layers.length) { focusSamples = undefined; approximate = false; report(); return; }
    const { x, y, sx, sy, css } = geometry;
    const matrix = multiply(pose.world, [sx, 0, 0, x - (pose.width ?? 0) / 2, 0, sy, 0, y - (pose.height ?? 0) / 2, 0, 0, 1, 0, 0, 0, 0, 1]);
    const elevation = pose.elevation * (pose.display?.explode ?? 1);
    const tint = pose.display?.tint === true;
    const evaluated = evaluateDepthLayers(matrix, layers, pose.camera, pose.light, pose.intensity, elevation, projections);
    for (const layer of evaluated) {
      const target = usable.get(layer.order)!;
      if (target.volume) {
        if (target.paintedZ !== layer.localZ) {
          ledger.apply(target.element, { transform: { prepend: `translateZ(${px(layer.localZ)})` }, "backface-visibility": "hidden" });
          target.paintedZ = layer.localZ;
        }
        target.proxy?.paint(layer, target.radius, target.color, tint, css);
      } else {
        ledger.apply(target.element, projectedStyles(layer, target.element, target.origin, tint));
      }
    }
    const currentFocus = pose.focus, currentCamera = pose.camera;
    const hadFocus = focusSamples !== undefined;
    const sampled = currentFocus && (currentFocus.maxBlur > 0 || hadFocus)
      ? optics.paint(evaluated.map(layer => ({ layer, ...usable.get(layer.order)! })), matrix, currentCamera, currentFocus, snapshotSize.width, snapshotSize.height, css) : undefined;
    focusSamples = sampled?.samples;
    approximate = sampled?.approximate ?? false;
    focusEvidence = () => focusSamples ?? (currentFocus && evaluated.map(layer => {
      const { depth, signed, blur } = sampleDepthFocus(matrix, layer.world, currentCamera, currentFocus);
      return { depth, signed, blur };
    }));
    if (rebuilt || hadFocus || sampled) report();
  };
  const invalidate = () => {
    invalid = true;
    if (scheduled === undefined) scheduled = view.requestAnimationFrame(() => { scheduled = undefined; paint(); });
  };
  const affectsLayout = (records: MutationRecord[]) => records.some(record => {
    const element = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
    if (!element || element.closest("[data-velora-depth-proxies],[data-velora-focus-filters]")) return false;
    const owner = element.closest("[data-velora-id]");
    if (owner && owner !== surfaceRoot) return false;
    if (record.type === "attributes" && record.attributeName === "style" && (element === surfaceRoot || ledger.ownsCurrentStyle(element))) return false;
    if (record.type !== "attributes") return true;
    const name = record.attributeName ?? "";
    return name === "class" || name === "id" || name === "style" || name === "role" || name === "popover" || name === "open" || name === "hidden" || name.startsWith("aria-") || name.startsWith("data-");
  });
  const mutation = new view.MutationObserver(records => { if (affectsLayout(records)) invalidate(); });
  mutation.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  const measured = new WeakMap<Element, string>();
  const resize = typeof view.ResizeObserver === "undefined" ? undefined : new view.ResizeObserver(entries => {
    let changes = false;
    for (const entry of entries) {
      const size = `${entry.contentRect.width}x${entry.contentRect.height}`;
      const previous = measured.get(entry.target);
      measured.set(entry.target, size);
      if (previous !== undefined && previous !== size) changes = true;
    }
    if (changes) invalidate();
  });
  doc.addEventListener("scroll", invalidate, true);
  doc.addEventListener("toggle", invalidate, true);
  view.addEventListener("resize", invalidate);
  const flush = async () => {
    if (affectsLayout(mutation.takeRecords())) invalid = true;
    if (scheduled !== undefined) view.cancelAnimationFrame(scheduled);
    scheduled = undefined;
    paint();
    ledger.settle();
    await optics.settle();
  };
  const unpublish = registerDepthEvidence(target, () => {
    const focus = focusEvidence();
    return { surface, ...resolved, ...(focus ? { focus } : {}) };
  }, () => {
    dispose();
    finishCapture?.();
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    mutation.disconnect();
    resize?.disconnect();
    doc!.removeEventListener("scroll", invalidate, true);
    doc!.removeEventListener("toggle", invalidate, true);
    view!.removeEventListener("resize", invalidate);
    view!.removeEventListener("pagehide", dispose);
    if (scheduled !== undefined) view!.cancelAnimationFrame(scheduled);
    optics.reset();
    ledger.revert();
    proxyRoot?.replaceChildren();
    unpublish();
    unbindTargets();
    registry.elementAnchors.schedule();
    controllers.delete(dispose);
    registry.reportDepth(token);
  }
  view.addEventListener("pagehide", dispose);
  controllers.add(dispose);
  paint();
  return { update(next: DepthPose) { if (next.intensity !== pose.intensity) registry.elementAnchors.schedule(); pose = next; paint(); }, flush, dispose };
}

function useDepth(depth: SurfaceDepth | undefined, target: RefObject<HTMLElement | null>, proxyRoot?: RefObject<HTMLDivElement | null>, doc?: Document, route = false, finishCapture?: () => void) {
  const controller = useRef<ReturnType<typeof mountDepth>>(undefined);
  const latest = useRef(depth);
  latest.current = depth;
  const captureCleanup = useRef(finishCapture);
  captureCleanup.current = finishCapture;
  const config = depth?.config;
  const key = config && JSON.stringify([config.mode, config.render, config.tiers, config.rules, config.maxLayers, config.resolved]);
  useLayout(() => {
    if (!target.current || !latest.current?.root || config?.mode === "off" || route && !doc) return;
    controller.current = mountDepth(latest.current, target.current, proxyRoot?.current ?? undefined, () => captureCleanup.current?.());
    return () => { controller.current?.dispose(); controller.current = undefined; };
  }, [key, doc, target, proxyRoot, depth?.root, depth?.surface, depth?.registry, depth?.leafGrouping, route]);
  useLayout(() => { if (depth) controller.current?.update(depth); });
  useCaptureSettle(() => controller.current?.flush(), undefined, !!depth && config?.mode !== "off");
}
export function useVolumetricDepth(depth: SurfaceDepth | undefined, surface: RefObject<HTMLDivElement | null>, proxies: RefObject<HTMLDivElement | null>) {
  useDepth(depth, surface, proxies);
}
export function useProjectedDepth(frame: RefObject<HTMLIFrameElement | null>, doc: Document | undefined, finishCapture: () => void) {
  const depth = useContext(DepthSurfaceContext);
  useDepth(depth, frame, undefined, doc, true, finishCapture);
}
