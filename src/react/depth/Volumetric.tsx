import type { EvaluatedDepthLayer } from "../../core/depth";
import { px, TIER_COLORS } from "./Projected";

const surface = "position:absolute;left:0;top:0;pointer-events:none;transform-origin:top left;backface-visibility:hidden;";
const translate = (x: number, y: number, z: number) => `translate3d(${px(x)},${px(y)},${px(z)})`;

/** All these elements are owned by Velora and are siblings of the host content tree. */
export function makeDepthProxy(container: HTMLDivElement) {
  const group = container.ownerDocument.createElement("div");
  group.style.cssText = "position:absolute;inset:0;pointer-events:none;transform-origin:top left;transform-style:preserve-3d;";
  const planes = Array.from({ length: 6 }, () => container.ownerDocument.createElement("div"));
  const highlight = container.ownerDocument.createElement("div");
  highlight.style.cssText = "position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse,white,transparent 70%);will-change:transform,opacity";
  planes[5].append(highlight);
  group.append(...planes);
  container.append(group);
  let previousGeometry = "", previousSheen = "";
  return {
    group,
    paint(layer: EvaluatedDepthLayer, radius: string, color: string, tint: boolean, placement: string) {
      const { rect: { x, y, width, height }, z, shadow, edge } = layer;
      const thickness = edge.thickness;
      const key = JSON.stringify([x, y, width, height, z, shadow, edge, radius, color, placement]);
      const image = tint ? TIER_COLORS[layer.tier] : "";
      if (key !== previousGeometry) {
        previousGeometry = key;
        previousSheen = "";
        group.style.transform = placement;
        const rect = `width:${px(width)};height:${px(height)};border-radius:${radius};`;
        const shadowZ = shadow.z + Math.min(0.25, layer.localZ / 2);
        const ink = `rgba(7,14,27,${shadow.opacity})`;
        planes[0].style.cssText = surface + rect + `transform:${translate(x + shadow.x, y + shadow.y, shadowZ)};background:${ink};box-shadow:0 0 ${px(shadow.blur)} ${ink};`;
        const walls = [
          { x, y, width, height: thickness, rotate: `rotateX(90deg) translateY(${px(-thickness)})` },
          { x: x + width, y, width: thickness, height, rotate: "rotateY(90deg)" },
          { x, y: y + height, width, height: thickness, rotate: "rotateX(-90deg)" },
          { x, y, width: thickness, height, rotate: `rotateY(-90deg) translateX(${px(-thickness)})` },
        ];
        // Outward normals let the compositor discard the hidden walls.
        walls.forEach((wall, index) => {
          planes[index + 1].style.cssText = surface + `width:${px(wall.width)};height:${px(wall.height)};transform:${translate(wall.x, wall.y, z)} ${wall.rotate};background:color-mix(in srgb, ${color} ${Math.round(edge.shades[index] * 100)}%, black);`;
        });
        planes[5].style.cssText = surface + rect + `transform:${translate(x, y, z + 0.25)};overflow:clip;`;
      }
      const sheen = layer.sheen;
      const highlightKey = `${image}/${sheen.u}/${sheen.v}/${sheen.opacity}`;
      if (highlightKey !== previousSheen) {
        previousSheen = highlightKey;
        highlight.style.transform = `translate(${sheen.u - 50}%, ${sheen.v - 50}%)`;
        highlight.style.opacity = tint ? "0" : String(sheen.opacity);
        planes[5].style.backgroundColor = image ? `color-mix(in srgb, ${image} 34%, transparent)` : "transparent";
      }
    },
  };
}
