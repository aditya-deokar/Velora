import { createElement, Fragment, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { BrandSchema, type Brand, type LayoutElement, type LayoutNode } from "../core";
import { Surface } from "../react";
import * as kit from "../kit";

/** SOURCE OF TRUTH: TemplateLayout, useProjectBrand.
 * WHAT: render a Wave 2 composite layout live: one Surface per layout node, kit components by name,
 * the template slot filled by the caller (the live app, a route or a placeholder), inside BrandProvider.
 * WHY: the studio previews exactly the layout `velora new scene` would write as source, from the same data.
 * WHERE: QuickShot and the template gallery. Unknown element types render nothing (never host code).
 */
const KIT = kit as unknown as Record<string, ComponentType<Record<string, unknown>>>;
const ELEMENTS = new Set(["div", "span", "strong", "p"]);
function renderElement(element: LayoutElement | string, slot: (props: Record<string, unknown>) => ReactNode, key: number | string): ReactNode {
  if (typeof element === "string") return element;
  const children = element.children?.map((child, index) => renderElement(child, slot, index));
  if (element.type === "Slot") return <Fragment key={key}>{slot(element.props ?? {})}</Fragment>;
  if (ELEMENTS.has(element.type)) return createElement(element.type, { key, ...element.props }, ...(children ?? []));
  const Component = KIT[element.type];
  return Component ? createElement(Component, { key, ...element.props }, ...(children ?? [])) : null;
}
/** velora.brand.json served by the dev server (Vite serves the project root); defaults when absent. */
export function useProjectBrand(): Brand | undefined {
  const [brand, setBrand] = useState<Brand>();
  useEffect(() => {
    if (typeof fetch === "undefined" || typeof location === "undefined") return;
    let active = true;
    fetch(new URL("/velora.brand.json", location.origin)).then(response => response.ok ? response.json() : undefined).then(document => {
      const parsed = BrandSchema.safeParse(document);
      if (active && parsed.success) setBrand(parsed.data);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return brand;
}
export function TemplateLayout({ layout, brand, slot }: { layout: readonly LayoutNode[]; brand?: Brand; slot: (props: Record<string, unknown>) => ReactNode }) {
  return <kit.BrandProvider brand={brand}>
    {layout.map(node => <Surface key={node.id} id={node.id} style={{ position: "absolute", left: node.left, top: node.top, width: node.width, height: node.height }}>
      {renderElement(node.element, slot, node.id)}
    </Surface>)}
  </kit.BrandProvider>;
}
