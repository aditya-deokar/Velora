import { FOCUS_BANDS, focusMask, type EvaluatedNode } from "../core";
import DEPTH_X from "./depth-x.png";
import DEPTH_Y from "./depth-y.png";
/** SOURCE OF TRUTH: FocusFilter presentation.
 * WHAT: two cached linear depth textures and native SVG tables blend live Gaussian samples.
 * WHY: reuse cached raster ramps; never encode/decode image documents per frame.
 * WHERE: core/spatial supplies the canonical weights; Surface filters visual leaves.
 * Uses native feImage sampling and feComponentTransfer table interpolation.
 */
export function FocusFilter({ id, node }: { id: string; node: EvaluatedNode }) {
  const { focus: f, width, height } = node;
  const pad = (3 * f.maxBlur) / f.scale;
  const masks = Array.from({ length: FOCUS_BANDS + 1 }, (_, i) =>
    focusMask(f, width, height, i),
  );
  const mask = masks[0];
  // Zero-weight kernels contribute no pixels. Keep only active bands so many
  // small live layers do not pay for every possible blur radius.
  const bands = masks.map((mask, index) => ({mask, index}))
    .filter(({mask}) => mask.stops.some(weight => weight > 0));

  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <defs>
        <filter
          id={id}
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
          x={-pad}
          y={-pad}
          width={width + 2 * pad}
          height={height + 2 * pad}
          colorInterpolationFilters="sRGB"
        >
          <feImage href={DEPTH_X} x={-pad} y={-pad} width={width+2*pad} height={height+2*pad} preserveAspectRatio="none" result="axisX" />
          <feComponentTransfer in="axisX" result="depthX"><feFuncA type="table" tableValues={mask.reverseX ? "1 0" : "0 1"} /></feComponentTransfer>
          <feImage href={DEPTH_Y} x={-pad} y={-pad} width={width+2*pad} height={height+2*pad} preserveAspectRatio="none" result="axisY" />
          <feComponentTransfer in="axisY" result="depthY"><feFuncA type="table" tableValues={mask.reverseY ? "1 0" : "0 1"} /></feComponentTransfer>
          <feComposite in="depthX" in2="depthY" operator="arithmetic" k2={mask.xWeight} k3={mask.yWeight} result="depth" />
          {bands.map(({mask, index: i}, position) => (
            <FilterBand
              key={i}
              index={i}
              node={node}
              weights={mask.stops}
              previous={position ? bands[position - 1].index : undefined}
            />
          ))}
        </filter>
      </defs>
    </svg>
  );
}

type BandRect = { x: number; y: number; width: number; height: number; band: number };
export type DepthMapBase = number | { from: [number, number]; to: [number, number]; samples: number[] };
let depthFilterId = 0;
const svgNs = "http://www.w3.org/2000/svg";

/** Keep one native SVG pipeline and replace its stage-space mask only when its bands change. */
export function createDepthMapFilter(host: HTMLElement) {
  const doc = host.ownerDocument;
  const canvas = doc.createElement("canvas");
  const context = canvas.getContext("2d");
  const svg = doc.createElementNS(svgNs, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("data-velora-focus-filters", "");
  svg.style.cssText = "position:absolute;pointer-events:none";
  const id = `velora-depth-map-${++depthFilterId}`;
  const element = <K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>) => {
    const node = doc.createElementNS(svgNs, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };
  const filter = element("filter", { id, filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" });
  const image = element("feImage", { x: 0, y: 0, preserveAspectRatio: "none", result: "depthImage" });
  const depth = element("feColorMatrix", { in: "depthImage", type: "matrix", values: "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0", result: "depth" });
  filter.append(image, depth);
  const kernels: SVGFEGaussianBlurElement[] = [];
  for (let band = 0; band <= FOCUS_BANDS; band++) {
    const kernel = element("feGaussianBlur", { in: "SourceGraphic", result: `blur${band}` });
    kernels.push(kernel);
    const mask = element("feComponentTransfer", { in: "depth", result: `mask${band}` });
    mask.append(element("feFuncA", { type: "discrete", tableValues: Array.from({ length: FOCUS_BANDS + 1 }, (_, i) => i === band ? "1" : "0").join(" ") }));
    filter.append(kernel, mask, element("feComposite", { in: `blur${band}`, in2: `mask${band}`, operator: "in", result: `part${band}` }));
    if (band) filter.append(element("feComposite", { in: band === 1 ? "part0" : `sum${band - 1}`, in2: `part${band}`, operator: "arithmetic", k2: 1, k3: 1, result: `sum${band}` }));
  }
  svg.append(filter);
  host.append(svg);
  let previous = "", previousKernel = "", pending = Promise.resolve();
  const rgb = (band: number) => `rgb(${Math.round(band / FOCUS_BANDS * 255)},0,0)`;
  return {
    id,
    paint(width: number, height: number, maximum: number, base: DepthMapBase, layers: readonly BandRect[]) {
      if (!context || width < 1 || height < 1) return;
      const dimensions = `${width}/${height}/${maximum}`;
      if (dimensions !== previousKernel) {
        previousKernel = dimensions;
        const pad = 3 * maximum;
        for (const [key, value] of Object.entries({ x: -pad, y: -pad, width: width + 2 * pad, height: height + 2 * pad })) filter.setAttribute(key, String(value));
        image.setAttribute("width", String(width));
        image.setAttribute("height", String(height));
        kernels.forEach((node, i) => node.setAttribute("stdDeviation", String(maximum * i / FOCUS_BANDS)));
      }
      const key = JSON.stringify([width, height, base, layers]);
      if (key === previous) return;
      previous = key;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      if (typeof base === "number") context.fillStyle = rgb(base);
      else {
        const gradient = context.createLinearGradient(...base.from, ...base.to);
        gradient.addColorStop(0, rgb(base.samples[0]));
        for (let index = 1; index < base.samples.length; index++) {
          if (base.samples[index] === base.samples[index - 1]) continue;
          const position = (index - 0.5) / (base.samples.length - 1);
          gradient.addColorStop(position, rgb(base.samples[index - 1]));
          gradient.addColorStop(position, rgb(base.samples[index]));
        }
        gradient.addColorStop(1, rgb(base.samples.at(-1)!));
        context.fillStyle = gradient;
      }
      context.fillRect(0, 0, width, height);
      for (const rect of layers) {
        context.fillStyle = rgb(rect.band);
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      const href = canvas.toDataURL("image/png");
      image.setAttribute("href", href);
      const decoded = new Image();
      decoded.src = href;
      pending = decoded.decode().catch(() => undefined);
    },
    settle: () => pending,
    remove: () => svg.remove(),
  };
}
function FilterBand({
  index: i,
  node,
  weights,
  previous,
}: {
  index: number;
  node: EvaluatedNode;
  weights: number[];
  previous?: number;
}) {
  const { focus: f, width, height } = node;

  return (
    <>
      <feGaussianBlur
        in="SourceGraphic"
        stdDeviation={(f.maxBlur * i) / FOCUS_BANDS / f.scale}
        result={`blur${i}`}
      />
      <feComponentTransfer
        in="depth"
        x={(-3 * f.maxBlur) / f.scale}
        y={(-3 * f.maxBlur) / f.scale}
        width={width + (6 * f.maxBlur) / f.scale}
        height={height + (6 * f.maxBlur) / f.scale}
        result={`mask${i}`}
      >
        <feFuncA
          type="table"
          tableValues={weights.join(" ")}
        />
      </feComponentTransfer>
      <feComposite
        in={`blur${i}`}
        in2={`mask${i}`}
        operator="in"
        result={`part${i}`}
      />
      {previous === undefined ? (
        <feComposite
          in={`part${i}`}
          in2={`part${i}`}
          operator="arithmetic"
          k2={1}
          result={`sum${i}`}
        />
      ) : (
        <feComposite
          in={`sum${previous}`}
          in2={`part${i}`}
          operator="arithmetic"
          k2={1}
          k3={1}
          result={`sum${i}`}
        />
      )}
    </>
  );
}
