/** SOURCE OF TRUTH: parseCssColor, mixColors.
 * WHAT: a pure CSS color parser (hex, rgb/rgba, hsl/hsla, oklab, oklch, transparent) and the one color
 * interpolator: OKLab with premultiplied alpha, gamut-clamped to sRGB, printed as canonical rgb(R G B / A).
 * WHY: animated CSS variables and color channels must blend perceptually (no muddy sRGB midpoints) and
 * print identical strings on every machine and locale, so a frame at time t is byte-deterministic.
 * WHERE: core/motion compiles color keyframes through this owner; kit tint (color-mix) stays presentation.
 * Named colors are rejected with a hint to use hex, so recipes never depend on a browser's name table.
 */
export type CssColor = { readonly L: number; readonly a: number; readonly b: number; readonly alpha: number };
export type ParsedColor = { ok: true; color: CssColor } | { ok: false; message: string };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
/** Gamma-encoded sRGB 0..1 to OKLab (Ottosson 2020). */
function fromSrgb(r: number, g: number, b: number, alpha: number): CssColor {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha,
  };
}
/** OKLab to gamma-encoded sRGB, clamped into the sRGB gamut. */
function toSrgb({ L, a, b }: CssColor): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map(c => clamp(toGamma(clamp(c, 0, 1)), 0, 1)) as [number, number, number];
}
function hslToSrgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + hue / 30) % 12;
  const chroma = s * Math.min(l, 1 - l);
  return [0, 8, 4].map(n => l - chroma * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) as [number, number, number];
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
function number(token: string): number | undefined {
  return NUMBER.test(token) ? Number(token) : undefined;
}
/** A number, or a percentage mapped onto `percentScale` (100% = percentScale). */
function component(token: string, percentScale: number): number | undefined {
  if (token.endsWith("%")) {
    const value = number(token.slice(0, -1));
    return value === undefined ? undefined : (value / 100) * percentScale;
  }
  return number(token);
}
function hue(token: string): number | undefined {
  const match = /^(.*?)(deg|turn|rad|grad)?$/i.exec(token)!;
  const value = number(match[1]);
  if (value === undefined) return undefined;
  const unit = match[2]?.toLowerCase();
  return unit === "turn" ? value * 360 : unit === "rad" ? (value * 180) / Math.PI : unit === "grad" ? value * 0.9 : value;
}
/** Split function arguments: legacy commas or modern spaces with an optional "/ alpha". */
function argumentsOf(body: string): { values: string[]; alpha?: string } | undefined {
  const text = body.trim();
  if (text.includes(",")) {
    const parts = text.split(",").map(part => part.trim());
    if (parts.some(part => !part)) return undefined;
    return parts.length === 4 ? { values: parts.slice(0, 3), alpha: parts[3] } : { values: parts };
  }
  const [main, alpha, extra] = text.split("/").map(part => part.trim());
  if (extra !== undefined || alpha === "") return undefined;
  return { values: main.split(/\s+/).filter(Boolean), alpha };
}
function alphaOf(token: string | undefined): number | undefined {
  if (token === undefined) return 1;
  const value = component(token, 1);
  return value === undefined ? undefined : clamp(value, 0, 1);
}

/** Parse one CSS color. The color is held in OKLab so out-of-sRGB oklab/oklch inputs interpolate truthfully. */
export function parseCssColor(input: string): ParsedColor {
  const text = typeof input === "string" ? input.trim().toLowerCase() : "";
  const invalid = (message: string): ParsedColor => ({ ok: false, message });
  if (!text) return invalid("Use a CSS color such as #3b82f6, rgb(59 130 246) or oklch(0.62 0.19 260).");
  if (text === "transparent") return { ok: true, color: { L: 0, a: 0, b: 0, alpha: 0 } };
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(hex)) return invalid(`"${input}" is not a #rgb, #rgba, #rrggbb or #rrggbbaa color.`);
    const full = hex.length <= 4 ? [...hex].map(c => c + c).join("") : hex;
    const channels = (full.match(/../g) ?? []).map(pair => parseInt(pair, 16) / 255);
    return { ok: true, color: fromSrgb(channels[0], channels[1], channels[2], channels[3] ?? 1) };
  }
  const call = /^([a-z]+)\((.*)\)$/.exec(text);
  if (!call) return invalid(/^[a-z]+$/.test(text)
    ? `Named color "${input}" is not supported: use hex (for example #ff0000) so recipes never depend on a browser name table.`
    : `"${input}" is not a supported CSS color (hex, rgb(), hsl(), oklab(), oklch() or transparent).`);
  const [, name, body] = call;
  const args = argumentsOf(body);
  const alpha = alphaOf(args?.alpha);
  if (!args || args.values.length !== 3 || alpha === undefined) return invalid(`"${input}" needs three components and an optional alpha.`);
  const [first, second, third] = args.values;
  if (name === "rgb" || name === "rgba") {
    const channels = [first, second, third].map(token => component(token, 255));
    if (channels.some(value => value === undefined)) return invalid(`"${input}" has a non-numeric rgb component.`);
    const [r, g, b] = channels.map(value => clamp(value! / 255, 0, 1));
    return { ok: true, color: fromSrgb(r, g, b, alpha) };
  }
  if (name === "hsl" || name === "hsla") {
    const h = hue(first), s = component(second, 1), l = component(third, 1);
    if (h === undefined || s === undefined || l === undefined) return invalid(`"${input}" needs hsl(hue saturation% lightness%).`);
    const [r, g, b] = hslToSrgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
    return { ok: true, color: fromSrgb(r, g, b, alpha) };
  }
  if (name === "oklab") {
    const L = component(first, 1), a = component(second, 0.4), b = component(third, 0.4);
    if (L === undefined || a === undefined || b === undefined) return invalid(`"${input}" needs oklab(L a b).`);
    return { ok: true, color: { L: clamp(L, 0, 1), a, b, alpha } };
  }
  if (name === "oklch") {
    const L = component(first, 1), C = component(second, 0.4), h = hue(third);
    if (L === undefined || C === undefined || h === undefined) return invalid(`"${input}" needs oklch(L C hue).`);
    const radians = (h * Math.PI) / 180;
    return { ok: true, color: { L: clamp(L, 0, 1), a: Math.max(0, C) * Math.cos(radians), b: Math.max(0, C) * Math.sin(radians), alpha } };
  }
  return invalid(`"${name}()" is not a supported color function: use hex, rgb(), hsl(), oklab() or oklch().`);
}

// Locale-independent fixed precision; never prints -0.
const fixed = (value: number) => {
  const rounded = Number(value.toFixed(3));
  return String(rounded === 0 ? 0 : rounded);
};
/** Canonical, deterministic output: rgb(R G B / A) with three decimals at most. */
export function formatCssColor(color: CssColor): string {
  const [r, g, b] = toSrgb(color);
  return `rgb(${fixed(r * 255)} ${fixed(g * 255)} ${fixed(b * 255)} / ${fixed(clamp(color.alpha, 0, 1))})`;
}
function resolve(color: CssColor | string): CssColor {
  if (typeof color !== "string") return color;
  const parsed = parseCssColor(color);
  if (!parsed.ok) throw new TypeError(parsed.message);
  return parsed.color;
}
/** Blend two colors at weight t (0..1) in OKLab with premultiplied alpha; endpoints print exactly. */
export function mixColors(from: CssColor | string, to: CssColor | string, t: number): string {
  const a = resolve(from), b = resolve(to);
  if (!(t > 0)) return formatCssColor(a);
  if (t >= 1) return formatCssColor(b);
  const alpha = a.alpha + (b.alpha - a.alpha) * t;
  const mix = (key: "L" | "a" | "b") => a[key] * a.alpha + (b[key] * b.alpha - a[key] * a.alpha) * t;
  if (alpha <= 0) return formatCssColor({ L: 0, a: 0, b: 0, alpha: 0 });
  return formatCssColor({ L: mix("L") / alpha, a: mix("a") / alpha, b: mix("b") / alpha, alpha });
}
/** Largest sRGB channel or alpha difference between two colors, in 0..255 units (loop seams, tests). */
export function colorDifference(from: CssColor | string, to: CssColor | string): number {
  const a = resolve(from), b = resolve(to);
  const [ar, ag, ab] = toSrgb(a), [br, bg, bb] = toSrgb(b);
  return 255 * Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb), Math.abs(a.alpha - b.alpha));
}
