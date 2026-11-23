import { classifyDepth, hashDepthLayers, type DepthConfig, type DepthMatch, type DepthSnapshot, type DepthSnapshotNode, type ResolvedDepth } from "../../core/depth";
import { layoutReader } from "../registry";
import type { DepthElement } from "./ledger";

const ignored = "script,style,template,link,meta,iframe,[data-velora-depth-proxies],[data-velora-focus-filters],[data-velora-preview-chrome]";
const number = (value: string) => Number.parseFloat(value) || 0;
function alpha(color: string) {
  if (!color || color === "transparent") return 0;
  const components = color.match(/[\d.]+/g);
  if (color.startsWith("rgba(") && components?.length === 4) return number(components[3]);
  const slash = color.lastIndexOf("/");
  return slash === -1 ? 1 : number(color.slice(slash + 1));
}
const ownsStyle = (element: Element): element is DepthElement => "style" in element;

/** Use offsets before camera, fit and layer transforms are applied. */
export function readDepthSnapshot(root: HTMLElement, config: DepthConfig, viewport = false) {
  const layout = layoutReader();
  const view = root.ownerDocument.defaultView;
  const width = viewport ? view?.innerWidth ?? root.clientWidth : root.offsetWidth;
  const height = viewport ? view?.innerHeight ?? root.clientHeight : root.offsetHeight;
  const snapshot: DepthSnapshot = { width, height, nodes: [] };
  const nodes: DepthSnapshotNode[] = [];
  const elements = new Map<number, DepthElement>();
  if (!view) return { snapshot, elements };
  const origin = viewport ? { x: 0, y: 0 } : layout.origin(root);
  const matches = new Set<string>();
  for (const { match } of config.resolved?.layers ?? config.rules ?? []) if ("selector" in match) matches.add(match.selector);
  const matched = new Map<Element, string[]>();
  for (const selector of matches) {
    try {
      for (const element of root.querySelectorAll(selector)) {
        const entries = matched.get(element) ?? [];
        entries.push(selector);
        matched.set(element, entries);
      }
    } catch { /* An invalid selector matches no layers. */ }
  }
  // Take the static structure once. A nested Surface and SVG artwork own their own descendants.
  const visit = (element: Element, parent?: number, fixedOffset = { x: 0, y: 0 }) => {
    if (element.matches(ignored) || element.hasAttribute("data-velora-id") || !ownsStyle(element)) return;
    const css = view.getComputedStyle(element);
    if (css.display === "none") return;
    const tag = element.localName;
    const html = "offsetLeft" in element;
    const host = html ? element as HTMLElement : element.parentElement;
    if (!host) return;
    const point = layout.origin(host), size = html ? layout.size(host) : { width: number(css.width), height: number(css.height) };
    // A fixed iframe layer with no containing block uses viewport coordinates.
    // Cancel scroll above that layer while keeping any scroll inside it.
    const scrollCorrection = viewport && html && css.position === "fixed" && !host.offsetParent
      ? { x: host.offsetLeft - point.x, y: host.offsetTop - point.y }
      : fixedOffset;
    const attrs: Record<string, string> = {};
    for (const attr of element.attributes) if (attr.name.startsWith("aria-") || attr.name === "popover" || attr.name === "data-badge") attrs[attr.name] = attr.value;
    const order = nodes.length;
    const owned = element.hasAttribute("data-velora-content") || element.hasAttribute("data-velora-app-stage");
    const tier = owned ? "none" : element.getAttribute("data-velora-tier") ?? undefined;
    const mask = [css.maskImage, css.getPropertyValue("-webkit-mask-image"), css.getPropertyValue("mask-border-source")].find(value => value && value !== "none") ?? "none";
    nodes.push({ order, parent, tag, role: element.getAttribute("role") ?? undefined, tier,
      anchor: element.getAttribute("data-velora-anchor") ?? undefined, attrs, selectors: matched.get(element),
      rect: { x: point.x - origin.x + scrollCorrection.x + (html ? 0 : number(css.left)),
        y: point.y - origin.y + scrollCorrection.y + (html ? 0 : number(css.top)), ...size },
      style: { position: css.position, zIndex: number(css.zIndex), display: css.display, visibility: css.visibility || "visible",
        backgroundAlpha: alpha(css.backgroundColor), boxShadow: css.boxShadow || "none",
        borderWidth: Math.max(number(css.borderTopWidth), number(css.borderRightWidth), number(css.borderBottomWidth), number(css.borderLeftWidth)),
        radius: Math.max(number(css.borderTopLeftRadius), number(css.borderTopRightRadius), number(css.borderBottomLeftRadius), number(css.borderBottomRightRadius)),
        overflow: `${css.overflowX || "visible"} ${css.overflowY || "visible"}`, opacity: css.opacity ? number(css.opacity) : 1,
        filter: owned ? "none" : css.filter || "none", clipPath: css.clipPath || "none", mask,
        isolation: css.isolation || "auto", mixBlendMode: css.mixBlendMode || "normal", contain: css.contain || "none" },
    });
    elements.set(order, element);
    if (tag !== "svg") for (const child of element.children) visit(child, order, scrollCorrection);
  };
  for (const child of root.children) visit(child);
  return { snapshot: { ...snapshot, nodes }, elements };
}

export function depthMatch(element: Element, preferAnchor = true, scope?: Element): DepthMatch {
  const doc = element.ownerDocument;
  const escape = (value: string) => doc.defaultView?.CSS?.escape?.(value) ?? value;
  const anchor = element.getAttribute("data-velora-anchor");
  if (preferAnchor && anchor && anchor.length <= 240 && doc.querySelectorAll(`[data-velora-anchor=${escape(anchor)}]`).length === 1) return { anchor };
  const parts: string[] = [];
  const root = scope ?? doc.body;
  for (let node: Element | null = element; node && node !== root && node !== doc.documentElement; node = node.parentElement) {
    if (node.id && (scope ?? doc).querySelectorAll(`#${escape(node.id)}`).length === 1) {
      parts.unshift(`#${escape(node.id)}`);
      break;
    }
    let index = 1;
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.localName === node.localName) index++;
    parts.unshift(`${escape(node.localName)}:nth-of-type(${index})`);
    if (node.parentElement === root) parts.unshift(scope ? ":scope" : "body");
  }
  return { selector: parts.join(" > ") || "body" };
}

export function describeDepth(snapshot: ReturnType<typeof readDepthSnapshot>, config: DepthConfig) {
  const layers = classifyDepth(snapshot.snapshot, config);
  const frozen = layers.map(({ order, tier, z }) => ({ match: depthMatch(snapshot.elements.get(order)!), tier, z }));
  const resolved: ResolvedDepth = { hash: hashDepthLayers(frozen), layers: frozen };
  return { layers, resolved };
}
