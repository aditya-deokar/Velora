import type { EvaluatedDepthLayer } from "../../core/depth";
import type { DepthElement, DepthStyles } from "./ledger";

export const TIER_COLORS = { base: "#8ca0ae", container: "#50bba5", card: "#5d9cff", control: "#a282ff", floating: "#f7aa56", cursor: "#f07899" };
export const px = (value: number) => `${Math.round(value * 1000) / 1000}px`;
const number = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
export function sheenImage(layer: EvaluatedDepthLayer, tint: boolean) {
  return tint
    ? `linear-gradient(color-mix(in srgb, ${TIER_COLORS[layer.tier]} 45%, transparent), color-mix(in srgb, ${TIER_COLORS[layer.tier]} 22%, transparent))`
    : `radial-gradient(ellipse at ${number(layer.sheen.u)}% ${number(layer.sheen.v)}%, rgba(255, 255, 255, ${number(layer.sheen.opacity)}), transparent 70%)`;
}

export function projectedStyles(layer: EvaluatedDepthLayer, element: DepthElement, origin: readonly [number, number], tint: boolean): DepthStyles {
  const { projected, shadow, edge } = layer;
  const [originX, originY] = origin;
  const x = projected.x + (projected.scale - 1) * (originX - layer.rect.width / 2);
  const y = projected.y + (projected.scale - 1) * (originY - layer.rect.height / 2);
  const viewX = Math.sign(projected.x || shadow.x), viewY = Math.sign(projected.y || shadow.y);
  const steps = Math.min(4, Math.ceil(edge.thickness));
  const bevel = Array.from({ length: steps }, (_, index) => {
    const step = edge.thickness * (index + 1) / steps;
    return `${px(viewX * step)} ${px(viewY * step)} 0 rgba(27, 37, 54, ${number(0.15 + edge.shades[1] * 0.4)})`;
  });
  const shades = [...bevel, `${px(shadow.x)} ${px(shadow.y)} ${px(shadow.blur)} rgba(7, 14, 27, ${number(shadow.opacity)})`];
  const css: DepthStyles = {
    transform: { prepend: `translate(${px(x)}, ${px(y)}) scale(${number(projected.scale)})` },
    "backface-visibility": "hidden",
    "box-shadow": { prepend: shades.join(", "), separator: ", " },
  };
  // Replaced elements have no paintable background above their own pixels.
  if (!element.matches("canvas,img,video,svg,input")) Object.assign(css, {
    "background-image": { prepend: sheenImage(layer, tint), separator: ", " },
    "background-size": { prepend: "100% 100%", separator: ", " },
    "background-position": { prepend: "0% 0%", separator: ", " },
    "background-repeat": { prepend: "no-repeat", separator: ", " },
  } satisfies DepthStyles);
  return css;
}
