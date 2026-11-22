import { AnchorNameSchema, elementKey, type AnchorMeasurement, type AnchorMeasurements, type AnchorReport, type ElementTarget } from "../core/targets";
import type { DepthMatch } from "../core/depth";
import { depthMatch } from "./depth/snapshot";
import { layoutPlacement, layoutReader, type Binding } from "./registry";

/** SOURCE OF TRUTH: measureAnchors.
 * WHAT: read transform-free anchor geometry and the depth layer that carries it.
 * WHY: reflow, scrolling and depth animation must not require new authored coordinates.
 * WHERE: Scene registration supplies previews, capture, Studio and CLI with these measurements.
 */
type Layer = { element: Element; z: number; base: number; tier: string; match?: DepthMatch };
type Route = { frame: HTMLIFrameElement; document: Document; owner: symbol };
type DepthReader = { layers: () => Layer[]; withoutTransform?: <T>(read: () => T) => T };
const depthReaders = new WeakMap<Element, DepthReader>();
const anchorAttr = "data-velora-anchor";
const owned = "[data-velora-depth-proxies],[data-velora-focus-filters],[data-velora-preview-chrome]";
export function bindTargetDepth(root: Element, layers: DepthReader["layers"], withoutTransform?: DepthReader["withoutTransform"]) {
  const reader = { layers, withoutTransform };
  depthReaders.set(root, reader);
  return () => { if (depthReaders.get(root) === reader) depthReaders.delete(root); };
}

const studioElements = ":is([id],button,a,input,textarea,select,canvas,svg,svg [data-velora-anchor],img,[role],h1,h2,h3,h4,h5,h6,header,article,section,main,figure,div,span,p,li,td,label)";
function anchorBox(element: Element, layout: ReturnType<typeof layoutReader>) {
  if ("offsetLeft" in element) return { host: element as HTMLElement, ...layout.size(element as HTMLElement), left: 0, top: 0 };
  if (!("getBBox" in element) || !("getScreenCTM" in element)) return;
  const graphic = element as SVGGraphicsElement;
  const svg = graphic.ownerSVGElement ?? graphic as SVGSVGElement;
  const host = svg.parentElement;
  if (!host || !("offsetLeft" in host)) return;
  const svgStyle = svg.ownerDocument.defaultView?.getComputedStyle(svg);
  const left = host.clientLeft + (parseFloat(svgStyle?.marginLeft ?? "") || 0);
  const top = host.clientTop + (parseFloat(svgStyle?.marginTop ?? "") || 0);
  if (element === svg) return { host, left, top, width: svg.clientWidth, height: svg.clientHeight };
  try {
    const box = graphic.getBBox(), root = svg.getScreenCTM(), current = graphic.getScreenCTM();
    if (!root || !current) return;
    const matrix = (svg.getCTM() ?? root).multiply(root.inverse()).multiply(current);
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]]
      .map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }));
    const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y));
    return { host, left: left + x, top: top + y, width: Math.max(...corners.map(point => point.x)) - x, height: Math.max(...corners.map(point => point.y)) - y };
  } catch { return; }
}
const empty: AnchorMeasurements = { entries: [], matches: {} };
export function measureAnchors(bindings: ReadonlyMap<symbol, Binding>, routes: readonly Route[], targets: readonly ElementTarget[],
  elevations: ReadonlyMap<string, number>, onMeasure?: (element: Element) => void, pickable = false): AnchorMeasurements {
  const entries: AnchorMeasurement[] = [], matches: Record<string, AnchorMeasurement[]> = Object.create(null);
  const layout = layoutReader();
  for (const [token, { element: surface, id }] of bindings) {
    const size = layout.size(surface);
    const inspect = (scope: HTMLElement, route?: Route) => {
      const lookup = depthReaders.get(route?.frame ?? surface);
      const layers = new Map((lookup?.layers() ?? []).map(layer => [layer.element, layer]));
      const factor = elevations.get(id) ?? 1;
      const routePlace = route && layoutPlacement(surface, route.frame, layout);
      const measured = new Map<Element, AnchorMeasurement | undefined>();
      const find = (element: Element): AnchorMeasurement | undefined => {
        if (measured.has(element)) return measured.get(element);
        measured.set(element, undefined);
        if (element.closest(owned) || !route && element.closest("[data-velora-id]") !== surface ||
          element.checkVisibility && !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
        const box = route ? element.getBoundingClientRect() : anchorBox(element, layout);
        if (!box?.width || !box.height) return;
        const placement = routePlace ?? layoutPlacement(surface, "host" in box ? box.host : surface, layout);
        const x = placement.x + (box.left + (route?.frame.clientLeft ?? 0)) * placement.sx - size.width / 2;
        const y = placement.y + (box.top + (route?.frame.clientTop ?? 0)) * placement.sy - size.height / 2;
        let layer: Layer | undefined;
        for (let node: Element | null = element; node && !layer && node !== surface; node = node.parentElement) layer = layers.get(node);
        const anchor = AnchorNameSchema.safeParse(element.getAttribute(anchorAttr));
        const match = anchor.success ? undefined : depthMatch(element, false, scope);
        const target = anchor.success ? { surface: id, anchor: anchor.data } : { surface: id, selector: match && "selector" in match ? match.selector : "" };
        const layerMatch = layers.get(element)?.match;
        const measurement = { target, rect: { x, y, width: box.width * placement.sx, height: box.height * placement.sy },
          elevation: (layer?.z ?? 0) * factor, baseElevation: (layer?.base ?? 0) * factor, ...(layer ? { tier: layer.tier } : {}), ...(layerMatch ? { layerMatch } : {}) };
        measured.set(element, measurement);
        onMeasure?.(element);
        return measurement;
      };
      const read = () => {
        const named = scope.querySelectorAll(`[${anchorAttr}]`);
        const add = (measurement: AnchorMeasurement, target = measurement.target) => (matches[elementKey(target)] ??= []).push({ ...measurement, target });
        const candidates = pickable ? Array.from(scope.querySelectorAll(studioElements)) : [];
        for (const element of new Set([...named, ...layers.keys(), ...candidates])) {
          const measurement = find(element);
          if (!measurement || ("selector" in measurement.target && (!measurement.target.selector || measurement.target.selector.length > 256))) continue;
          entries.push(measurement);
          add(measurement);
        }
        const checked = new Set<string>();
        for (const target of targets) {
          if (target.surface !== id || !("selector" in target)) continue;
          const key = elementKey(target);
          if (checked.has(key)) continue;
          checked.add(key);
          try {
            for (const element of scope.querySelectorAll(target.selector)) {
              const measurement = find(element);
              if (!measurement) continue;
              if (elementKey(measurement.target) === key && entries.includes(measurement)) continue;
              add(measurement, target);
            }
          } catch { /* Invalid CSS matches no elements. */ }
        }
      };
      if (lookup?.withoutTransform) lookup.withoutTransform(read); else read();
    };
    inspect(surface);
    for (const route of routes) if (route.owner === token && route.document.body) inspect(route.document.body, route);
  }
  return { entries, matches };
}

export function createAnchorRegistry(bindings: ReadonlyMap<symbol, Binding>, stage: () => HTMLElement | null, publish: () => void) {
  let snapshot = empty, snapshotKey = "", configKey = "", enabled = false, pickable = false;
  let targets: readonly ElementTarget[] = [], elevations: ReadonlyMap<string, number> = new Map();
  const routes = new Map<Route, MutationObserver | undefined>();
  let rootObserver: MutationObserver | undefined, resize: ResizeObserver | undefined, scheduled: number | undefined;
  let observed = new Set<Element>();
  const refresh = () => {
    if (!enabled || !stage()) return;
    if (scheduled !== undefined) cancelAnimationFrame(scheduled);
    scheduled = undefined;
    const next = new Set<Element>();
    const measured = measureAnchors(bindings, [...routes.keys()], targets, elevations, element => next.add(element), pickable);
    // The route ledger temporarily removes its own transform while measuring.
    for (const observer of routes.values()) observer?.takeRecords();
    for (const element of observed) if (!next.has(element)) resize?.unobserve(element);
    for (const element of next) if (!observed.has(element)) resize?.observe(element);
    observed = next;
    const key = JSON.stringify(measured);
    if (key === snapshotKey) return;
    snapshot = measured;
    snapshotKey = key;
    publish();
  };
  const schedule = () => { if (enabled && scheduled === undefined) scheduled = requestAnimationFrame(refresh); };
  const observe = (root: Element) => {
    const Observer = root.ownerDocument.defaultView?.MutationObserver;
    if (!Observer) return;
    const observer = new Observer(records => {
      if (records.some(record => !(record.target.nodeType === 1 ? record.target as Element : record.target.parentElement)?.closest(owned))) schedule();
    });
    observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
    return observer;
  };
  return {
    snapshot: () => enabled ? snapshot : undefined,
    configure(next: readonly ElementTarget[], active: boolean, factors: ReadonlyMap<string, number>, inspect = false) {
      const key = JSON.stringify([next, active, [...factors], inspect]);
      if (key === configKey) return;
      configKey = key;
      targets = next;
      pickable = inspect;
      elevations = factors;
      enabled = active || next.length > 0;
      if (enabled && stage() && !rootObserver) rootObserver = observe(stage()!);
      if (!enabled) { rootObserver?.disconnect(); rootObserver = undefined; snapshot = empty; snapshotKey = ""; }
      else refresh();
    },
    refresh, schedule,
    mount(root: HTMLElement) {
      if (enabled) rootObserver = observe(root);
      resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
      resize?.observe(root);
      root.addEventListener("scroll", schedule, true);
      root.addEventListener("load", schedule, true);
      root.ownerDocument.fonts?.addEventListener("loadingdone", schedule);
      return () => {
        rootObserver?.disconnect(); rootObserver = undefined;
        resize?.disconnect(); resize = undefined; observed.clear();
        if (scheduled !== undefined) cancelAnimationFrame(scheduled);
        scheduled = undefined;
        root.removeEventListener("scroll", schedule, true);
        root.removeEventListener("load", schedule, true);
        root.ownerDocument.fonts?.removeEventListener("loadingdone", schedule);
      };
    },
    route(route: Route) {
      routes.set(route, route.document.body ? observe(route.document.body) : undefined);
      const { document } = route;
      document.addEventListener("scroll", schedule, true);
      document.addEventListener("load", schedule, true);
      document.fonts?.addEventListener("loadingdone", schedule);
      document.defaultView?.addEventListener("resize", schedule);
      schedule();
      return () => {
        routes.get(route)?.disconnect();
        routes.delete(route);
        document.removeEventListener("scroll", schedule, true);
        document.removeEventListener("load", schedule, true);
        document.fonts?.removeEventListener("loadingdone", schedule);
        document.defaultView?.removeEventListener("resize", schedule);
        schedule();
      };
    },
  };
}

type TargetScene = { scope: Element; refresh(): void; reports(): AnchorReport[] };
const scenes = new Set<TargetScene>();
export function registerTargetScene(scene: TargetScene) { scenes.add(scene); return () => { scenes.delete(scene); }; }
export function refreshTargetScenes(viewport: Element | null) {
  const active = [...scenes].filter(scene => viewport?.contains(scene.scope));
  active.forEach(scene => scene.refresh());
  return active.length > 0;
}
export function captureTargets(viewport: Element | null) { return [...scenes].flatMap(scene => viewport?.contains(scene.scope) ? scene.reports() : []); }
