import type { Measurement, TransformInput, SceneIssue, AnimatableSpec } from "../core";
import type { DepthReport } from "./depth";

/** SOURCE OF TRUTH: React registration and untransformed layout measurements.
 * WHAT: one ephemeral registry per Scene; entries use mount identity, not public IDs.
 * WHY: duplicate IDs must reach core validation, and StrictMode cleanup must remove
 * only its own binding. No component instances or host data enter scene metadata.
 * WHERE: index.tsx supplies bindings; core owns all spatial policy and evaluation.
 */
export type Binding = {
  token: symbol;
  id: string;
  parent?: symbol;
  element: HTMLDivElement;
  transform?: TransformInput;
};
/** A declared animatable as consumers (the inspector) see it: specs only, never component instances. */
export type AnimatableEntry = { readonly id: string; readonly spec: AnimatableSpec; readonly owner?: string; readonly readingTimeMs?: number; readonly kind?: "three"; readonly label?: string };
type AnimatableDeclaration = { id: string; spec: AnimatableSpec; key: string; owner?: symbol; explicitOwner?: string; readingTimeMs?: number; kind?: "three"; label?: string };
export type StageAnchor = readonly [number, number, number];
export type AnchorSampler = (channels: Readonly<Record<string, number>>) => StageAnchor | undefined;
export type GizmoMode = "translate" | "rotate" | "scale";
export type GizmoPoint = { x: number; y: number };
export type GizmoDrag = {
  move(point: GizmoPoint): Readonly<Record<string, number>>;
  end(): void;
};
export type SceneGizmo = {
  pick(point: GizmoPoint): string | undefined;
  hover(point: GizmoPoint): void;
  begin(point: GizmoPoint): GizmoDrag | undefined;
};
const gizmos = new WeakMap<Element, SceneGizmo>();
export function registerGizmo(element: Element, gizmo: SceneGizmo) {
  gizmos.set(element, gizmo);
  return () => { if (gizmos.get(element) === gizmo) gizmos.delete(element); };
}
export function sceneGizmo(element: Element): SceneGizmo | undefined { return gizmos.get(element); }

function sameObject(a: object | undefined, b: object | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(Reflect.get(a, key), Reflect.get(b, key)))
  );
}

type Point = { x: number; y: number };
const ZERO = { x: 0, y: 0 };

// Offset geometry excludes transforms. Share offset and scroll ancestors within
// one measurement so every layer does not query the same layout geometry.
export function layoutReader() {
  const offsets = new Map<HTMLElement, Point>();
  const scrolls = new Map<HTMLElement, Point>();
  const boxes = new Map<HTMLElement, { width: number; height: number }>();
  const offset = (element: HTMLElement | null): Point => {
    if (!element) return ZERO;
    const known = offsets.get(element);
    if (known) return known;
    const parent = element.offsetParent as HTMLElement | null;
    const base = offset(parent);
    const point = {
      x: base.x + element.offsetLeft + (parent?.clientLeft ?? 0),
      y: base.y + element.offsetTop + (parent?.clientTop ?? 0),
    };
    offsets.set(element, point);
    return point;
  };
  const scroll = (element: HTMLElement | null): Point => {
    if (!element) return ZERO;
    const known = scrolls.get(element);
    if (known) return known;
    const outer = scroll(element.parentElement);
    const point = { x: outer.x + element.scrollLeft, y: outer.y + element.scrollTop };
    scrolls.set(element, point);
    return point;
  };
  return {
    origin(element: HTMLElement) {
      const point = offset(element), ancestor = scroll(element.parentElement);
      return { x: point.x - ancestor.x, y: point.y - ancestor.y };
    },
    size(element: HTMLElement) {
      const known = boxes.get(element);
      if (known) return known;
      const box = { width: element.offsetWidth, height: element.offsetHeight };
      boxes.set(element, box);
      return box;
    },
  };
}


// SOURCE OF TRUTH: unfiltered group content diagnostics. Spatial ancestors cannot
// be filtered without flattening descendants. Check actual rendered host content,
// including custom React components; never silently leave labels/media sharp.
function uncoveredContent(root:Element):boolean {
  for (const child of root.childNodes) {
    if (child.nodeType===3 && child.textContent?.trim()) return true;
    if (!(child instanceof Element)) continue;
    if (child.hasAttribute("data-velora-id") || child.hasAttribute("data-velora-content") || child.matches('[data-velora-depth-proxies],svg[width="0"],script,style,template')) continue;
    const css=getComputedStyle(child);
    if(css.display==='none'||css.visibility==='hidden') continue;
    if(child.matches('img,svg,canvas,video,input,textarea,select') || (css.backgroundImage && css.backgroundImage!=='none')) return true;
    if(uncoveredContent(child)) return true;
  }
  return false;
}

export function createRegistry() {
  const entries = new Map<symbol, Binding>();
  const declarations = new Map<symbol, AnimatableDeclaration>();
  const anchors = new Map<symbol, { id: string; sample: AnchorSampler }>();
  const externalIssues = new Map<symbol, SceneIssue>();
  const depthReports = new Map<symbol, DepthReport>();
  let animatableView: ReadonlyMap<string, AnimatableEntry> = new Map();
  let animatableIssues: SceneIssue[] = [];
  // First declaration of an id wins; a later declaration with a different spec is a Scene issue.
  const rebuildAnimatables = () => {
    const view = new Map<string, AnimatableEntry>(), keys = new Map<string, string>(), issues: SceneIssue[] = [];
    for (const declaration of declarations.values()) {
      const known = keys.get(declaration.id);
      if (known === undefined) {
        keys.set(declaration.id, declaration.key);
        const owner = declaration.explicitOwner ?? (declaration.owner ? entries.get(declaration.owner)?.id : undefined);
        view.set(declaration.id, Object.freeze({ id: declaration.id, spec: declaration.spec, ...(owner ? { owner } : {}),
          ...(declaration.readingTimeMs ? { readingTimeMs: declaration.readingTimeMs } : {}),
          ...(declaration.kind ? { kind: declaration.kind } : {}), ...(declaration.label ? { label: declaration.label } : {}) }));
      } else if ((known !== declaration.key || declaration.kind === "three") && !issues.some(issue => issue.path === "animatable." + declaration.id))
        issues.push({ path: "animatable." + declaration.id, message: declaration.kind === "three"
          ? `3D animatable ${declaration.id} is declared twice. Give each object and clip its own id.`
          : `Animatable ${declaration.id} is declared twice with different specs. Give each component its own id or share one spec.` });
    }
    const changed = JSON.stringify(issues) !== JSON.stringify(animatableIssues) || JSON.stringify([...view.values()]) !== JSON.stringify([...animatableView.values()]);
    animatableView = view;
    animatableIssues = issues;
    return changed;
  };
  const measurements = new Map<symbol, Measurement>();
  const listeners = new Set<() => void>();
  let revision = 0;
  let coverageDirty=true;
  let coverageIssues:SceneIssue[]=[];
  let mutations:MutationObserver|undefined;
  let stage: HTMLDivElement | null = null;
  let observer: ResizeObserver | undefined;
  const publish = () => {
    revision++;
    listeners.forEach((listener) => listener());
  };
  const measure = () => {
    if (!stage) return false;
    const layout = layoutReader();
    let changed = false;
    for (const [token, entry] of entries) {
      const parent =
        (entry.parent && entries.get(entry.parent)?.element) || stage;
      const p = layout.origin(parent), e = layout.origin(entry.element);
      const { width, height } = layout.size(entry.element);
      const parentSize = layout.size(parent);
      const next = {
        width,
        height,
        offsetX: e.x + width / 2 - p.x - parentSize.width / 2,
        offsetY: e.y + height / 2 - p.y - parentSize.height / 2,
      };
      if (!sameObject(measurements.get(token), next)) {
        measurements.set(token, next);
        changed = true;
      }
    }
    if(coverageDirty) {
      coverageDirty=false;
      const groups=new Set(Array.from(entries.values()).map(b=>b.parent));
      const next=Array.from(entries.values()).filter(b=>groups.has(b.token)&&uncoveredContent(b.element)).map(b=>({path:b.id,message:"Unfiltered content in spatial group. Wrap each visible text/media region in a Surface, or put its paint in content. Group filters would flatten nested 3D."}));
      if(uncoveredContent(stage)) next.push({path:"scene",message:"Unfiltered scene content. Wrap visible text/media in a Surface so camera depth of field can apply."});
      if(JSON.stringify(next)!==JSON.stringify(coverageIssues)){coverageIssues=next;changed=true;}
    }
    return changed;
  };
  const refresh = () => {
    if (measure()) publish();
  };
  return {
    entries,
    measurements,
    get coverageIssues(){return coverageIssues;},
    /** Read-only view of declared animatables (id -> spec and owning Surface id). */
    get animatables(): ReadonlyMap<string, AnimatableEntry> { return animatableView; },
    get animatableIssues(): SceneIssue[] { return [...animatableIssues, ...externalIssues.values()]; },
    depthReports,
    reportDepth(token: symbol, report?: DepthReport) {
      if (report) {
        if (JSON.stringify(depthReports.get(token)) === JSON.stringify(report)) return;
        depthReports.set(token, report);
      } else if (!depthReports.delete(token)) return;
      publish();
    },
    reportIssue(token: symbol, issue?: SceneIssue) {
      if (issue) {
        if (sameObject(externalIssues.get(token), issue)) return;
        externalIssues.set(token, issue);
      } else if (!externalIssues.delete(token)) return;
      publish();
    },
    registerAnchor(token: symbol, id: string, sample: AnchorSampler) {
      const entry = { id, sample };
      anchors.set(token, entry);
      publish();
      return () => {
        if (anchors.get(token) !== entry) return;
        anchors.delete(token);
        publish();
      };
    },
    sampleAnchors(channels: Readonly<Record<string, number>>) {
      const samples = new Map<string, StageAnchor>();
      for (const { id, sample } of anchors.values()) {
        if (samples.has(id)) continue;
        const point = sample(channels);
        if (point && point.every(Number.isFinite)) samples.set(id, point);
      }
      return samples;
    },
    declareAnimatable(token: symbol, declaration: AnimatableDeclaration) {
      const previous = declarations.get(token);
      if (previous && previous.id === declaration.id && previous.key === declaration.key && previous.owner === declaration.owner && previous.explicitOwner === declaration.explicitOwner && previous.readingTimeMs === declaration.readingTimeMs && previous.kind === declaration.kind && previous.label === declaration.label) return;
      declarations.set(token, declaration);
      if (rebuildAnimatables()) publish();
    },
    releaseAnimatable(token: symbol) {
      if (!declarations.delete(token)) return;
      if (rebuildAnimatables()) publish();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => revision,
    refresh,
    mount(element: HTMLDivElement) {
      stage = element;
      if(typeof MutationObserver!=="undefined") {
        mutations=new MutationObserver(records=>{
          if(records.some(r=>!(r.target instanceof Element ? r.target : r.target.parentElement)?.closest('[data-velora-content],[data-velora-depth-proxies],svg[width="0"]'))) {
            coverageDirty=true; refresh();
          }
        });
        mutations.observe(element,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["data-velora-content"]});
      }
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(refresh);
        observer.observe(element);
        entries.forEach((entry) => observer!.observe(entry.element));
      }
      window.addEventListener("resize", refresh);
      element.addEventListener("scroll", refresh, true);
      refresh();
      return () => {
        mutations?.disconnect();
        observer?.disconnect();
        observer = undefined;
        window.removeEventListener("resize", refresh);
        element.removeEventListener("scroll", refresh, true);
        stage = null;
      };
    },
    upsert(binding: Binding) {
      const previous = entries.get(binding.token);
      const changed =
        !previous ||
        previous.id !== binding.id ||
        previous.parent !== binding.parent ||
        previous.element !== binding.element ||
        !sameObject(previous.transform, binding.transform);
      if (changed) {
        if (previous && previous.element !== binding.element)
          observer?.unobserve(previous.element);
        entries.set(binding.token, {
          ...binding,
          transform: binding.transform && { ...binding.transform },
        });
        observer?.observe(binding.element);
      }
      // Playback re-renders every binding. Unchanged registration must not perform
      // N full layout walks; Scene refreshes once after the commit, while resize
      // and scroll observers handle external geometry changes.
      if (changed) {
        coverageDirty=true;
        measure();
        rebuildAnimatables();
        publish();
      }
    },
    remove(token: symbol) {
      const previous = entries.get(token);
      if (!previous) return;
      observer?.unobserve(previous.element);
      entries.delete(token);
      coverageDirty=true;
      measurements.delete(token);
      measure();
      rebuildAnimatables();
      publish();
    },
  };
}
export type Registry = ReturnType<typeof createRegistry>;
