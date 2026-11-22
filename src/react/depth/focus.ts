import { applyPoint, focusBand, focusVeils, FOCUS_BANDS, projectWorld, type Matrix } from "../../core/spatial";
import { sampleDepthFocus, type EvaluatedDepthLayer } from "../../core/depth";
import type { CameraDefinition, FocusDefinition } from "../../core/scene";
import { createDepthMapFilter, type DepthMapBase } from "../FocusFilter";
import { createStyleLedger, type DepthElement } from "./ledger";
import { px } from "./Projected";
import { makeOpticsProxy } from "./Volumetric";

type Entry = { layer: EvaluatedDepthLayer; element: DepthElement; volume: boolean };
type Ledger = ReturnType<typeof createStyleLedger>;
type Proxy = ReturnType<typeof makeOpticsProxy>;
type FrameBounds = { left: number; right: number; top: number; bottom: number };
type Veil = { depth: number; sigma: number; scale: number; bounds: FrameBounds; paint(sigma: number): void };
const sceneVeils = new WeakMap<Element, Map<symbol, Veil[]>>();

function updateVeils(scene: Element, owner: symbol, group: Veil[]) {
  let scopes = sceneVeils.get(scene);
  if (!scopes) { scopes = new Map(); sceneVeils.set(scene, scopes); }
  if (group.length) scopes.set(owner, group); else scopes.delete(owner);
  if (scopes.size === 1) {
    for (const band of focusVeils(scopes.values().next().value!)) band.paint(band.sigma);
    return;
  }
  const bands = [...scopes.entries()].flatMap(([scope, entries]) => entries.map(entry => ({ scope, ...entry }))).sort((a, b) => a.depth - b.depth);
  const painted: { band: typeof bands[number]; variance: number }[] = [];
  for (const band of bands) {
    const { left, right, top, bottom } = band.bounds;
    // A nearer veil already blurs the entire deeper plane only if it covers the projected rectangle.
    const combined = painted.reduce((sum, prior) => {
      const bounds = prior.band.bounds;
      const covers = prior.band.scope === band.scope || bounds.left <= left + 1 && bounds.right >= right - 1 && bounds.top <= top + 1 && bounds.bottom >= bottom - 1;
      return sum + (covers ? prior.variance : 0);
    }, 0);
    const variance = Math.max(0, (band.sigma * band.scale) ** 2 - combined);
    band.paint(Math.sqrt(variance) / band.scale);
    painted.push({ band, variance });
  }
}

function baseMap(matrix: Matrix, camera: CameraDefinition, focus: FocusDefinition, width: number, height: number, maximum: number, flatSigma: number): DepthMapBase {
  const dx = -matrix[8], dy = -matrix[9], norm = dx ** 2 + dy ** 2;
  if (norm < 1e-9) return focusBand(flatSigma, maximum);
  const from: [number, number] = [dx < 0 ? width : 0, dy < 0 ? height : 0];
  const span = (Math.abs(dx) * width + Math.abs(dy) * height) / norm;
  const delta = [dx * span, dy * span];
  const to: [number, number] = [from[0] + delta[0], from[1] + delta[1]];
  const samples = Array.from({ length: 129 }, (_, index) => {
    const t = index / 128;
    const point = applyPoint(matrix, [from[0] + delta[0] * t, from[1] + delta[1] * t, 0]);
    return focusBand(sampleDepthFocus(matrix, point, camera, focus).sigma, maximum);
  });
  return { from, to, samples };
}

export function createLayerFocus(target: HTMLElement, ledger: Ledger, proxyRoot?: HTMLDivElement) {
  const route = target.localName === "iframe";
  const supportsVeils = target.ownerDocument.defaultView?.CSS?.supports?.("backdrop-filter", "blur(1px)") === true;
  const frameLedger = route ? createStyleLedger(target.ownerDocument) : undefined;
  const filtered = new Set<DepthElement>();
  const scene = target.closest("[data-velora-scene]") ?? target;
  const owner = Symbol();
  const markers: Proxy[] = [];
  const veils: Proxy[] = [];
  let map: ReturnType<typeof createDepthMapFilter> | undefined;
  let routeGroup: Proxy | undefined;

  const trim = (list: Proxy[], count: number) => {
    while (list.length > count) list.pop()?.element.remove();
  };
  const nodeAt = (list: Proxy[], index: number, parent: HTMLElement) => {
    if (list[index]?.element.isConnected) return list[index];
    const node = makeOpticsProxy(parent);
    list[index] = node;
    return node;
  };
  const filterTargets = (desired: Map<DepthElement, number>) => {
    for (const element of filtered) if (!desired.has(element)) { ledger.clear(element, "filter"); filtered.delete(element); }
    for (const [element, sigma] of desired) {
      ledger.apply(element, { filter: { prepend: `blur(${px(sigma)})` } });
      filtered.add(element);
    }
  };
  const reset = () => {
    filterTargets(new Map());
    trim(markers, 0);
    trim(veils, 0);
    if (sceneVeils.get(scene)?.has(owner)) updateVeils(scene, owner, []);
    frameLedger?.revert();
    map?.remove();
    map = undefined;
    routeGroup?.element.remove();
    routeGroup = undefined;
  };
  return {
    reset,
    settle: () => map?.settle(),
    paint(entries: readonly Entry[], matrix: Matrix, camera: CameraDefinition, focus: FocusDefinition, width: number, height: number, placement: string) {
      if (!entries.length || !focus.maxBlur) { if (markers.length || filtered.size || map) reset(); return; }
      const samples = entries.map(entry => ({ ...entry, ...sampleDepthFocus(matrix, entry.layer.world, camera, focus) }));
      const base = sampleDepthFocus(matrix, applyPoint(matrix, [width / 2, height / 2, 0]), camera, focus);
      const container = route ? target.parentElement : proxyRoot;
      if (route && container && !routeGroup) {
        routeGroup = makeOpticsProxy(container);
        routeGroup.paint("position:absolute;inset:0;pointer-events:none");
        routeGroup.element.setAttribute("data-velora-focus-filters", "");
      }
      const markerParent = routeGroup?.element ?? proxyRoot;
      const rects = samples.map(({ layer, volume }) => {
        if (volume) return layer.rect;
        const width = layer.rect.width * layer.projected.absoluteScale, height = layer.rect.height * layer.projected.absoluteScale;
        return { x: layer.projected.centerX - width / 2, y: layer.projected.centerY - height / 2, width, height };
      });
      if (markerParent) samples.forEach(({ volume, layer, blur, signed }, index) => {
        const marker = nodeAt(markers, index, markerParent);
        const { x, y, width, height } = rects[index];
        const transform = `${route ? "" : placement} translate3d(${px(x)},${px(y)},${px(volume ? layer.z + 0.4 : 0)})`;
        marker.paint(`position:absolute;left:0;top:0;width:${px(width)};height:${px(height)};pointer-events:none;transform-origin:top left;transform:${transform};`);
        marker.element.setAttribute("data-velora-depth-focus", String(index));
        marker.element.setAttribute("data-velora-blur", String(blur));
        marker.element.setAttribute("data-velora-focus-distance", String(signed));
      });
      trim(markers, samples.length);

      let approximate = false;
      if (route && frameLedger && target.parentElement) {
        const maximum = focus.maxBlur / Math.max(1e-6, Math.hypot(matrix[0], matrix[4], matrix[8]));
        const behind = samples.map((sample, index) => {
          const rect = rects[index];
          const plane = applyPoint(matrix, [rect.x + rect.width / 2, rect.y + rect.height / 2, 0]);
          const scale = camera.perspective / Math.max(1, camera.perspective - plane[2]) * (camera.zoom ?? 1);
          return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
            band: focusBand(sample.blur / scale / Math.max(1e-6, Math.hypot(matrix[0], matrix[4], matrix[8])), maximum), z: sample.layer.z, index };
        }).sort((a, b) => a.z - b.z || a.index - b.index);
        const main = baseMap(matrix, camera, focus, width, height, maximum, base.sigma);
        const visible = (typeof main === "number" ? main > 0 : main.samples.some(band => band > 0)) || behind.some(item => item.band);
        if (visible) {
          map ??= createDepthMapFilter(target.parentElement);
          map.paint(width, height, maximum, main, behind);
          frameLedger.apply(target, { filter: { prepend: `url(#${map.id})` } });
        } else frameLedger.clear(target, "filter");
      } else {
        const descendants = new Map<number, typeof samples>();
        for (const sample of samples.slice().reverse()) {
          if (sample.layer.parent === undefined) continue;
          const siblings = descendants.get(sample.layer.parent) ?? [];
          descendants.set(sample.layer.parent, [...siblings, sample, ...(descendants.get(sample.layer.order) ?? [])]);
        }
        const sharp = 0.05;
        // Blur terminal layers directly. A backdrop filter in a preserve-3d tree can miss these
        // layers on software compositors even when CSS.supports reports that the filter is available.
        const allBands = [...samples.filter(item => item.volume && item.signed > 0 && item.sigma > sharp && descendants.has(item.layer.order))
          .map(item => ({ z: item.layer.z, sigma: item.sigma })),
          ...(base.signed > 0 && base.sigma > sharp && samples.some(item => item.volume) ? [{ z: 0, sigma: base.sigma }] : [])];
        const depthBands = new Map<number, number>();
        for (const band of allBands) depthBands.set(band.z, Math.max(depthBands.get(band.z) ?? 0, band.sigma));
        const bands = [...depthBands].sort(([a], [b]) => b - a).map(([z, sigma]) => ({ z, sigma }));
        const canVeil = supportsVeils && !!proxyRoot && bands.every((entry, i) => i === 0 || entry.sigma + 0.1 >= bands[i - 1].sigma);
        const planes = canVeil ? bands.map(({ z, sigma }, index) => {
          const veil = nodeAt(veils, index, proxyRoot!);
          const next = samples.reduce((above, entry) => entry.volume && entry.layer.z > z ? Math.min(above, entry.layer.z) : above, Infinity);
          const nudge = Math.min(0.45, (next - z) / 2);
          veil.element.setAttribute("data-velora-focus-veil", "");
          const center = applyPoint(matrix, [width / 2, height / 2, z]);
          const depth = camera.perspective - center[2];
          const scale = Math.max(1e-6, Math.hypot(matrix[0], matrix[4], matrix[8])) * camera.perspective / Math.max(1, depth) * (camera.zoom ?? 1);
          const corners = [[0, 0], [width, 0], [width, height], [0, height]].flatMap(([x, y]) => {
            const point = projectWorld(camera, { width: 0, height: 0 }, applyPoint(matrix, [x, y, z]), "view");
            return point ? [point] : [];
          });
          const bounds = { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
            top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) };
          return { depth, sigma, scale, bounds, paint: (amount: number) => veil.paint(`position:absolute;left:0;top:0;width:${px(width)};height:${px(height)};pointer-events:none;transform-origin:top left;transform:${placement} translateZ(${px(z + nudge)});backdrop-filter:blur(${px(amount)});`) };
        }) : [];
        trim(veils, planes.length);
        if (planes.length || sceneVeils.get(scene)?.has(owner)) updateVeils(scene, owner, planes);
        const desired = new Map<DepthElement, number>(), covered = new Set<number>();
        approximate = !canVeil && samples.some(item => item.volume && item.sigma > sharp);
        for (const item of samples) {
          if (covered.has(item.layer.order) || item.sigma <= sharp) continue;
          const branch = descendants.get(item.layer.order) ?? [];
          if (canVeil && item.volume && item.signed > 0 && branch.length) continue;
          if (branch.length && !(canVeil && item.volume && branch.every(child => child.signed < 0 && child.sigma > sharp))) {
            approximate = true;
            continue;
          }
          let sigma = item.sigma;
          if (canVeil && item.volume && item.signed > 0) {
            const inherited = bands.reduce((sigma, band) => band.z >= item.layer.z ? Math.max(sigma, band.sigma) : sigma, 0);
            // Subtract the variance contributed by veils in front of this plane.
            sigma = Math.sqrt(Math.max(0, sigma ** 2 - inherited ** 2));
          }
          if (branch.length) {
            const total = [item, ...branch].reduce(({ area, weighted }, child) => {
              const weight = child.layer.rect.width * child.layer.rect.height / Math.max(1, child.depth) ** 2;
              return { area: area + weight, weighted: weighted + weight * child.sigma };
            }, { area: 0, weighted: 0 });
            sigma = total.weighted / total.area;
            for (const child of branch) covered.add(child.layer.order);
          }
          if (!canVeil && item.volume) {
            const maximum = focus.maxBlur / Math.max(1e-6, Math.hypot(matrix[0], matrix[4], matrix[8]));
            sigma = focusBand(sigma, maximum) / FOCUS_BANDS * maximum;
          }
          if (sigma > 0) desired.set(item.element, sigma);
        }
        filterTargets(desired);
      }
      return { approximate, samples: samples.map(({ depth, signed, blur }) => ({ depth, signed, blur })) };
    },
  };
}
