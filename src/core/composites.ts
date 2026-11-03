import { ASPECT_FRAMES, type Aspect, type ShotDefinition } from "./shots";
import { perspectiveForFocalLength } from "./lens";
import type { EasingInput } from "./easing";

/** SOURCE OF TRUTH: COMPOSITE_IDS, buildComposite, LayoutElement, LayoutNode, parseStat.
 * WHAT: Wave 2 layered real-UI and motion-graphics templates compiled into plain data: scene nodes and
 * motion (camera, surface and channel tracks) plus a layout of kit elements per Surface.
 * WHY: one description serves the scaffolder (which writes it as ordinary TSX the creator owns), the
 * studio quick shot (which renders the same layout live) and certification, so they never drift.
 * WHERE: core/templates manifests reference these by id; project/templates serializes layouts to JSX;
 * preview renders them through the kit. Text comes from template params; colors and motion
 * personality come from velora.brand.json at render time.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** A kit component (by export name), a plain element, or the template's slot ("Slot"). */
export type LayoutElement = { type: string; props?: Record<string, JsonValue>; children?: (LayoutElement | string)[] };
export type LayoutNode = { id: string; left: number; top: number; width: number; height: number; element: LayoutElement; transform?: { x?: number; y?: number; z?: number; rotateX?: number; rotateY?: number; rotateZ?: number; scale?: number } };
export type CompositeDefinition = ShotDefinition & {
  layout: LayoutNode[];
  /** Wrap the binding in BrandProvider (brand tokens drive the look). */
  brand: boolean;
  /** Node whose framing certification checks (the slot or the main text block). */
  primary: string;
  /** On-screen copy, for reading-time certification. */
  copy: string[];
};
export const COMPOSITE_IDS = Object.freeze([
  "exploded-stack", "parallax-planes", "cascade-build", "floating-focus", "device-showcase", "cursor-demo", "split-compare", "screen-wall",
  "title-reveal", "logo-sting", "kinetic-statement", "stat-counter", "feature-trio", "lower-third", "quote-card", "end-card", "countdown", "changelog-card",
] as const);
export type CompositeId = (typeof COMPOSITE_IDS)[number];
type Params = Record<string, string | number | { x: number; y: number; width: number; height: number }>;
type Key = [number, number, EasingInput?];
const el = (type: string, props: Record<string, JsonValue> = {}, children?: (LayoutElement | string)[]): LayoutElement => ({ type, props, ...(children ? { children } : {}) });
const round = (value: number) => Math.round(value * 100) / 100;
const keys = (list: Key[]) => list.map(([timeMs, value, easing]) => ({ timeMs: Math.round(timeMs), value: round(value), ...(easing ? { easing } : {}) }));
const cameraTrack = (property: string, list: Key[], ease: EasingInput = "cinematic") =>
  ({ target: { kind: "camera" }, property, keyframes: keys(list), ...(list.length > 1 ? { interpolation: "smooth", ease } : {}) });
const surfaceTrack = (id: string, property: string, list: Key[]) => ({ target: { kind: "surface", id }, property, keyframes: keys(list) });
const channelTrack = (id: string, list: Key[]) => ({ target: { kind: "channel", id }, property: "value", keyframes: keys(list) });
const text = (params: Params, name: string, fallback: string) => typeof params[name] === "string" && String(params[name]).trim() ? String(params[name]) : fallback;
const number = (params: Params, name: string, fallback: number) => typeof params[name] === "number" ? Number(params[name]) : fallback;
const list = (value: string) => value.split("|").map(item => item.trim()).filter(Boolean);
const words = (value: string) => value.split(/\s+/).filter(Boolean);
/** "$1.2M ARR" → prefix "$", value 1.2, suffix "M", label "ARR", decimals 1. */
export function parseStat(input: string): { prefix: string; value: number; suffix: string; label: string; decimals: number } {
  const match = /^\s*([^\d\s-]*)\s*(-?\d[\d,]*(?:\.\d+)?)\s*([^\s]*)\s*(.*)$/.exec(input);
  if (!match) return { prefix: "", value: 0, suffix: "", label: input.trim(), decimals: 0 };
  const digits = match[2].replace(/,/g, "");
  return { prefix: match[1], value: Number(digits), suffix: match[3], label: match[4].trim(), decimals: digits.includes(".") ? digits.split(".")[1].length : 0 };
}
type Frame = { W: number; H: number; portrait: boolean; S: { width: number; height: number }; p: number; duration: number };
function frameFor(aspect: Aspect, params: Params, fallbackMs: number, lens = 50): Frame {
  const f = ASPECT_FRAMES[aspect];
  return { W: f.width, H: f.height, portrait: f.height > f.width, S: f.subject, p: round(perspectiveForFocalLength(number(params, "lens", lens), f.height)), duration: number(params, "durationMs", fallbackMs) };
}
// A far backdrop sized to stay full-frame through the camera's travel at depth `z` (negative is away).
function backdropNode(f: Frame, variant: string, z = -1600, margin = 1.5): LayoutNode {
  const grow = ((f.p - z) / f.p) * margin;
  const width = Math.round(f.W * grow), height = Math.round(f.H * grow);
  return { id: "backdrop", left: Math.round((f.W - width) / 2), top: Math.round((f.H - height) / 2), width, height, transform: { z }, element: el("Backdrop", { variant, width, height }) };
}
const centered = (f: Frame, width: number, height: number, dx = 0, dy = 0) => ({ left: Math.round((f.W - width) / 2 + dx), top: Math.round((f.H - height) / 2 + dy), width: Math.round(width), height: Math.round(height) });
const slot = (width: number, height: number, extra: Record<string, JsonValue> = {}) => el("Slot", { name: "subject", width: Math.round(width), height: Math.round(height), ...extra });
function definition(f: Frame, camera: Record<string, number>, layout: LayoutNode[], tracks: unknown[], extra: { brand?: boolean; primary: string; copy?: string[]; focus?: Record<string, number> }): CompositeDefinition {
  return {
    width: f.W, height: f.H,
    scene: {
      camera: { perspective: f.p, ...camera },
      focus: { distance: round(f.p + (camera.z ?? 0)), fStop: 5.6, focalLength: 50, maxBlur: 8, ...extra.focus },
      nodes: layout.map(node => ({ id: node.id, transform: { x: 0, y: 0, z: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1, ...node.transform } })),
    },
    motion: { durationMs: f.duration, speed: 1, tracks: tracks as ShotDefinition["motion"]["tracks"] },
    layout, brand: extra.brand ?? false, primary: extra.primary, copy: extra.copy ?? [],
  };
}
// Motion graphics used as V2 overlays drop their backdrop (backdrop=off) so the picture shows through.
const backdropOf = (params: Params, make: () => LayoutNode): LayoutNode[] => text(params, "backdrop", "on") === "off" ? [] : [make()];
const level = (params: Params) => ({ subtle: 1, standard: 1.5, dramatic: 2 } as Record<string, number>)[String(params.intensity ?? "subtle")] ?? 1;

const builders: Record<CompositeId, (aspect: Aspect, params: Params) => CompositeDefinition> = {
  "exploded-stack": (aspect, params) => {
    const f = frameFor(aspect, params, 7000), a = level(params), sep = number(params, "separation", 220) * a, end = f.duration;
    const w = f.S.width * 0.86, h = f.S.height * 0.86;
    const layers: LayoutNode[] = [
      { id: "layer-base", ...centered(f, w, h, 0, 0), element: el("Panel", { width: Math.round(w), height: Math.round(h) }) },
      { id: "layer-mid", ...centered(f, w, h), element: el("Panel", { width: Math.round(w), height: Math.round(h), style: { opacity: 0.9 } }) },
      { id: "subject", ...centered(f, w, h), element: slot(w, h) },
    ];
    const tracks: unknown[] = layers.map((node, i) => surfaceTrack(node.id, "z", [[0, 0], [end * 0.35, (i - 2) * sep, "cinematic"], [end * 0.75, (i - 2) * sep], [end, 0, "cinematic"]]));
    const orbit = number(params, "orbit", 28) * Math.min(1.4, a);
    tracks.push(cameraTrack("rotateY", [[0, -orbit], [end, orbit * 0.4]]), cameraTrack("rotateX", [[0, 18], [end, 10]]));
    return definition(f, { z: round(f.p * 0.45), rotateX: 18, rotateY: -orbit }, [backdropNode(f, "grid-floor"), ...layers], tracks, { primary: "subject", brand: true, focus: { fStop: 8 } });
  },
  "parallax-planes": (aspect, params) => {
    const f = frameFor(aspect, params, 8000, 35), a = level(params), truck = number(params, "truck", 260) * a * Math.min(1, f.W / 1920), spacing = number(params, "spacing", 600);
    const w = f.S.width * 0.78, h = f.S.height * 0.78;
    const layout: LayoutNode[] = [
      backdropNode(f, "mesh", -spacing * 2.5, 1.8),
      { id: "glow", ...centered(f, f.W * 0.6, f.W * 0.6, f.W * 0.25, -f.H * 0.2), transform: { z: -spacing }, element: el("Glow", { size: Math.round(f.W * 0.6) }) },
      { id: "subject", ...centered(f, w, h), element: slot(w, h) },
      { id: "dust", ...centered(f, f.W * 1.4, f.H * 1.4), transform: { z: spacing * 0.6 }, element: el("Dust", { width: Math.round(f.W * 1.4), height: Math.round(f.H * 1.4), count: 60, seed: 11 }) },
    ];
    return definition(f, { z: round(f.p * 0.32), x: -truck }, layout, [cameraTrack("x", [[0, -truck], [f.duration, truck]]), cameraTrack("rotateY", [[0, -4 * a], [f.duration, 4 * a]])], { primary: "subject", brand: true });
  },
  "cascade-build": (aspect, params) => {
    const f = frameFor(aspect, params, 7000), pieces = list(text(params, "pieces", "Revenue: $48.2k|Active users: 12,480|Conversion: 4.8%")).slice(0, 4);
    const w = f.S.width * 0.8, h = f.S.height * 0.8;
    const cardW = f.portrait ? w * 0.8 : w * 0.3, cardH = f.portrait ? h * 0.16 : h * 0.24;
    const layout: LayoutNode[] = [backdropNode(f, "gradient"), { id: "subject", ...centered(f, w, h), element: slot(w, h) }];
    const tracks: unknown[] = [];
    pieces.forEach((piece, i) => {
      const [title, body = ""] = piece.split(":").map(part => part.trim());
      const dx = f.portrait ? 0 : (i - (pieces.length - 1) / 2) * (cardW + w * 0.04), dy = f.portrait ? (i - (pieces.length - 1) / 2) * (cardH + h * 0.04) : h * 0.3;
      const id = `piece-${i + 1}`;
      layout.push({ id, ...centered(f, cardW, cardH, dx, dy), element: el("Panel", { width: Math.round(cardW), height: Math.round(cardH), title: body || title, body: body ? title : "", startMs: 600, index: i }) });
      const start = 600 + i * 260;
      tracks.push(surfaceTrack(id, "z", [[0, 500], [start, 500], [start + 900, 60, "back.out"]]), surfaceTrack(id, "opacity", [[0, 0], [start, 0], [start + 400, 1]]));
    });
    tracks.push(cameraTrack("z", [[0, f.p * 0.42], [f.duration, f.p * 0.3]]));
    return definition(f, { z: round(f.p * 0.42), rotateX: 8, rotateY: -10 }, layout, tracks, { primary: "subject", brand: true, copy: pieces });
  },
  "floating-focus": (aspect, params) => {
    const f = frameFor(aspect, params, 7000, 85), lift = number(params, "lift", 420), headline = text(params, "headline", "Ship in minutes"), body = text(params, "body", "The real product, front and center.");
    const w = f.S.width, h = f.S.height, cardW = Math.min(f.W * 0.5, f.portrait ? f.W * 0.8 : 760), cardH = cardW * 0.5;
    const layout: LayoutNode[] = [
      backdropNode(f, "solid"),
      { id: "subject", ...centered(f, w, h), element: slot(w, h) },
      { id: "card", ...centered(f, cardW, cardH), transform: { z: lift }, element: el("Panel", { width: Math.round(cardW), height: Math.round(cardH), title: headline, body, startMs: 300 }) },
    ];
    const drift = 40 * level(params);
    return definition(f, { z: round(f.p * 0.62), rotateX: 6, rotateY: -8 }, layout,
      [cameraTrack("x", [[0, -drift], [f.duration, drift]]), cameraTrack("rotateY", [[0, -8], [f.duration, -3]])],
      { primary: "card", brand: true, copy: [headline, body], focus: { distance: round(f.p * 0.62 + f.p - lift), fStop: 2.8, maxBlur: 12 } });
  },
  "device-showcase": (aspect, params) => {
    const f = frameFor(aspect, params, 8000), a = level(params), device = text(params, "device", "browser"), backdrop = text(params, "backdrop", "grid-floor");
    const phone = device === "phone", screenW = phone ? Math.min(f.S.height * 0.5, f.S.width * 0.45) : f.S.width * 0.78, screenH = phone ? screenW * 2.05 : screenW * 0.62;
    const frameEl = ({ phone: "PhoneFrame", laptop: "LaptopFrame", tablet: "TabletFrame", browser: "BrowserFrame", window: "WindowFrame" } as Record<string, string>)[device] ?? "BrowserFrame";
    const outerW = screenW * (phone ? 1.1 : device === "laptop" ? 1.2 : 1.02), outerH = screenH * (phone ? 1.06 : 1.12);
    const layout: LayoutNode[] = [
      backdropNode(f, backdrop),
      { id: "shadow", ...centered(f, outerW * 0.9, outerW * 0.08, 0, outerH * 0.55), transform: { z: -20 }, element: el("ContactShadow", { width: Math.round(outerW * 0.9) }) },
      { id: "subject", ...centered(f, outerW, outerH), element: el(frameEl, { width: Math.round(screenW), height: Math.round(screenH), ...(frameEl === "BrowserFrame" ? { url: text(params, "url", "yourproduct.com") } : {}) },
        [slot(screenW, screenH), el("LightSweep", { startMs: Math.round(f.duration * 0.45), durationMs: 1400 })]) },
    ];
    const orbit = 14 * a;
    return definition(f, { z: round(f.p * 0.5), rotateX: 10, rotateY: -orbit }, layout,
      [cameraTrack("rotateY", [[0, -orbit], [f.duration, orbit * 0.5]]), cameraTrack("z", [[0, f.p * 0.5], [f.duration, f.p * 0.36]])], { primary: "subject", brand: true });
  },
  "cursor-demo": (aspect, params) => {
    const f = frameFor(aspect, params, 6000), w = f.S.width, h = f.S.height, end = f.duration;
    const target = typeof params.target === "object" ? params.target : { x: w * 0.62, y: h * 0.42, width: w * 0.18, height: h * 0.08 };
    const tx = target.x + target.width / 2, ty = target.y + target.height / 2, press = number(params, "pressMs", Math.round(end * 0.5));
    const zoom = number(params, "zoom", 1.6);
    const layout: LayoutNode[] = [
      backdropNode(f, "gradient"),
      { id: "subject", ...centered(f, w, h), element: el("div", { style: { position: "relative", width: Math.round(w), height: Math.round(h) } }, [slot(w, h), el("Cursor", { id: "cursor", skin: "pointer" })]) },
    ];
    // The camera eases toward the click and holds; cursor channels share the clock.
    const ox = tx - w / 2, oy = ty - h / 2, near = f.p * (1 / zoom - 1) + f.p * 0.18;
    const tracks = [
      channelTrack("cursor-x", [[0, w * 0.2], [press - 150, tx, "cinematic"], [end, tx]]),
      channelTrack("cursor-y", [[0, h * 0.85], [press - 150, ty, "cinematic"], [end, ty]]),
      channelTrack("cursor-press", [[0, 0], [press, 0], [press + 450, 1], [press + 451, 0]]),
      cameraTrack("x", [[0, 0], [press * 0.6, 0], [press + 300, ox * 0.8], [end, ox * 0.8]]),
      cameraTrack("y", [[0, 0], [press * 0.6, 0], [press + 300, oy * 0.8], [end, oy * 0.8]]),
      cameraTrack("z", [[0, f.p * 0.18], [press * 0.6, f.p * 0.18], [press + 300, near], [end, near]]),
    ];
    return definition(f, { z: round(f.p * 0.18) }, layout, tracks, { primary: "subject", brand: true, focus: { fStop: 11 } });
  },
  "split-compare": (aspect, params) => {
    const f = frameFor(aspect, params, 6000), w = f.S.width * 0.86, h = f.S.height * 0.86, before = text(params, "before", "/"), end = f.duration;
    const labels = [text(params, "beforeLabel", "Before"), text(params, "afterLabel", "After")];
    const layout: LayoutNode[] = [
      backdropNode(f, "spotlight"),
      { id: "before", ...centered(f, w, h), element: el("RouteFrame", { route: before, width: Math.round(w), height: Math.round(h) }) },
      { id: "subject", ...centered(f, w, h), transform: { z: 1 }, element: slot(w, h) },
      { id: "labels", ...centered(f, w, 80, 0, -h / 2 - 60), element: el("div", { style: { display: "flex", justifyContent: "space-between", width: Math.round(w), font: "600 30px/80px system-ui, sans-serif", color: "#f5f5f7" } }, [el("span", {}, [labels[0]]), el("span", {}, [labels[1]])]) },
    ];
    // A true mask (clip, in percent of the plane): the divider sweeps in from the right and settles mid-frame.
    const tracks = [surfaceTrack("subject", "clipLeft", [[0, 100], [end * 0.15, 100], [end * 0.55, 50, "cinematic"], [end * 0.75, 62], [end, 50, "cinematic"]])];
    return definition(f, { z: round(f.p * 0.3), rotateX: 4 }, layout, tracks, { primary: "subject", brand: true, copy: labels });
  },
  "screen-wall": (aspect, params) => {
    const f = frameFor(aspect, params, 9000, 35), routes = list(text(params, "routes", "/")).map(route => route.replace(/,/g, "")), cols = f.portrait ? 2 : 3, rows = f.portrait ? 4 : 2;
    const cellW = f.W * (f.portrait ? 0.44 : 0.3), cellH = cellW * 0.62, gap = cellW * 0.08;
    const layout: LayoutNode[] = [backdropNode(f, "gradient", -2000, 2)];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, dx = (c - (cols - 1) / 2) * (cellW + gap), dy = (r - (rows - 1) / 2) * (cellH + gap);
      layout.push({ id: i === 0 ? "subject" : `screen-${i + 1}`, ...centered(f, cellW, cellH, dx, dy), transform: { z: -Math.abs(c - (cols - 1) / 2) * 120 },
        element: i === 0 ? slot(cellW, cellH) : el("RouteFrame", { route: routes[i % routes.length], width: Math.round(cellW), height: Math.round(cellH), scrollY: Math.round((i * 380) % 1600) }) });
    }
    const a = level(params);
    return definition(f, { z: round(f.p * 0.9), rotateX: 14, rotateY: -22 * a }, layout,
      [cameraTrack("rotateY", [[0, -22 * a], [f.duration, 12 * a]]), cameraTrack("z", [[0, f.p * 0.9], [f.duration, f.p * 0.35]]), cameraTrack("x", [[0, -cellW * 0.3], [f.duration, cellW * 0.3]])],
      { primary: "subject", brand: true });
  },
  // Motion graphics: brand-styled type over a backdrop, with a slow settle push.
  "title-reveal": (aspect, params) => {
    const f = frameFor(aspect, params, 5000), title = text(params, "title", "A new perspective\non your product"), subtitle = text(params, "subtitle", "");
    const size = Math.round((f.portrait ? f.W * 0.1 : f.H * 0.1) * number(params, "scale", 1)), w = f.W * 0.8, h = size * (title.split("\n").length * 1.1 + (subtitle ? 1.2 : 0)) + 40;
    const layout: LayoutNode[] = [...backdropOf(params, () => backdropNode(f, "gradient", -800, 1.3)), { id: "title", ...centered(f, w, h), element: el("div", { style: { width: Math.round(w), textAlign: "center" } }, [
      el("Title", { text: title, size, align: "center", startMs: 200, durationMs: 1000 }),
      ...(subtitle ? [el("Title", { text: subtitle, size: Math.round(size * 0.36), weight: 450, align: "center", startMs: 900, by: "line", style: { marginTop: Math.round(size * 0.35), opacity: 0.75 } })] : []),
    ]) }];
    return definition(f, { z: 80 }, layout, [cameraTrack("z", [[0, 80], [f.duration, 0]])], { primary: "title", brand: true, copy: [title, subtitle] });
  },
  "logo-sting": (aspect, params) => {
    const f = frameFor(aspect, params, 2500), size = Math.round(Math.min(f.W, f.H) * 0.22), name = text(params, "name", "");
    const layout: LayoutNode[] = [
      backdropNode(f, "spotlight", -800, 1.3),
      { id: "glow", ...centered(f, size * 3, size * 3), transform: { z: -100 }, element: el("Glow", { size: size * 3, intensity: 0.5 }) },
      { id: "logo", ...centered(f, f.W * 0.7, size * 1.4), element: el("div", { style: { position: "relative", width: Math.round(f.W * 0.7), height: Math.round(size * 1.4), display: "grid", placeItems: "center", overflow: "hidden" } },
        [el("BrandMark", { size, ...(name ? { name } : {}) }), el("LightSweep", { startMs: 700, durationMs: 1100, intensity: 0.5 })]) },
    ];
    return definition(f, { z: 0 }, layout, [surfaceTrack("logo", "scale", [[0, 0.86], [900, 1, "back.out"], [f.duration, 1.02]]), surfaceTrack("logo", "opacity", [[0, 0], [350, 1]]), surfaceTrack("glow", "opacity", [[0, 0], [700, 0], [1300, 1], [f.duration, 0.7]])],
      { primary: "logo", brand: true, copy: [name] });
  },
  "kinetic-statement": (aspect, params) => {
    const f = frameFor(aspect, params, 4000), statement = text(params, "words", "Build. Ship. Delight."), accent = text(params, "accent", words(statement).at(-1) ?? "");
    const size = Math.round(f.portrait ? f.W * 0.14 : f.H * 0.15), w = f.W * 0.86;
    const layout: LayoutNode[] = [...backdropOf(params, () => backdropNode(f, "solid", -800, 1.2)), { id: "statement", ...centered(f, w, size * 3), element: el("Title", { text: statement, accent, size, weight: 800, align: "center", startMs: 150, durationMs: 650, easing: { spring: { stiffness: 220, damping: 15 } } }) }];
    return definition(f, { z: 60 }, layout, [cameraTrack("z", [[0, 60], [f.duration, 0]])], { primary: "statement", brand: true, copy: [statement] });
  },
  "stat-counter": (aspect, params) => {
    const f = frameFor(aspect, params, 4500), stats = list(text(params, "stats", "12k+ teams|98% uptime|3x faster")).slice(0, 3).map(parseStat);
    const size = Math.round(f.portrait ? f.W * 0.16 : f.H * 0.14), colW = f.portrait ? f.W * 0.8 : f.W * 0.27;
    const layout: LayoutNode[] = backdropOf(params, () => backdropNode(f, "mesh", -800, 1.3));
    stats.forEach((stat, i) => {
      const dx = f.portrait ? 0 : (i - (stats.length - 1) / 2) * colW, dy = f.portrait ? (i - (stats.length - 1) / 2) * size * 1.9 : 0;
      layout.push({ id: `stat-${i + 1}`, ...centered(f, colW, size * 1.8, dx, dy), element: el("div", { style: { width: Math.round(colW), textAlign: "center" } }, [
        el("Counter", { to: stat.value, decimals: stat.decimals, prefix: stat.prefix, suffix: stat.suffix, size, startMs: 250 + i * 220, durationMs: 1600 }),
        el("div", { style: { marginTop: 8, fontSize: Math.round(size * 0.24), opacity: 0.7 } }, [stat.label]),
      ]) });
    });
    return definition(f, { z: 0 }, layout, [], { primary: "stat-1", brand: true, copy: stats.map(stat => `${stat.prefix}${stat.value}${stat.suffix} ${stat.label}`) });
  },
  "feature-trio": (aspect, params) => {
    const f = frameFor(aspect, params, 6000), features = list(text(params, "features", "Fast: Renders in seconds|Private: Runs on your machine|Yours: Plain source, no lock-in")).slice(0, 3);
    const cardW = f.portrait ? f.W * 0.8 : f.W * 0.26, cardH = f.portrait ? f.H * 0.2 : f.H * 0.42;
    const layout: LayoutNode[] = [backdropNode(f, "gradient", -800, 1.3)];
    features.forEach((feature, i) => {
      const [title, body = ""] = feature.split(":").map(part => part.trim());
      const dx = f.portrait ? 0 : (i - 1) * (cardW + f.W * 0.03), dy = f.portrait ? (i - 1) * (cardH + f.H * 0.03) : 0;
      layout.push({ id: `feature-${i + 1}`, ...centered(f, cardW, cardH, dx, dy), element: el("Panel", { width: Math.round(cardW), height: Math.round(cardH), icon: String(i + 1).padStart(2, "0"), title, body, startMs: 300, index: i }) });
    });
    return definition(f, { z: 70, rotateX: 4 }, layout, [cameraTrack("z", [[0, 70], [f.duration, 0]])], { primary: "feature-2", brand: true, copy: features });
  },
  "lower-third": (aspect, params) => {
    const f = frameFor(aspect, params, 4000), label = text(params, "label", "Ada Park"), sublabel = text(params, "sublabel", "Head of Product"), right = text(params, "side", "left") === "right";
    const w = Math.min(f.W * 0.6, 900), h = Math.round(f.H * (f.portrait ? 0.08 : 0.13)), margin = f.W * 0.06;
    const layout: LayoutNode[] = [{ id: "bar", left: Math.round(right ? f.W - margin - w : margin), top: Math.round(f.H * (f.portrait ? 0.7 : 0.74)), width: Math.round(w), height: h,
      element: el("div", { style: { width: Math.round(w), height: h, boxSizing: "border-box", padding: `0 ${Math.round(h * 0.3)}px`, display: "flex", flexDirection: "column", justifyContent: "center", borderLeft: `${Math.round(h * 0.07)}px solid var(--velora-accent)`, background: "rgba(10,10,14,.78)" } }, [
        el("Title", { text: label, size: Math.round(h * 0.36), by: "line", startMs: 350 }), el("Title", { text: sublabel, size: Math.round(h * 0.22), weight: 450, by: "line", startMs: 600, style: { opacity: 0.75 } })]) }];
    return definition(f, { z: 0 }, layout, [surfaceTrack("bar", right ? "clipLeft" : "clipRight", [[0, 100], [700, 0, "expo.out"], [f.duration - 600, 0], [f.duration, 100, "expo.in"]])], { primary: "bar", brand: true, copy: [label, sublabel] });
  },
  "quote-card": (aspect, params) => {
    const f = frameFor(aspect, params, 7000), quote = text(params, "quote", "“It made our launch video in an afternoon.”"), name = text(params, "name", "A happy customer"), role = text(params, "role", "");
    const w = f.W * (f.portrait ? 0.84 : 0.66), size = Math.round(f.portrait ? f.W * 0.065 : f.H * 0.065), h = size * 6;
    const layout: LayoutNode[] = [backdropNode(f, "spotlight", -800, 1.3), { id: "quote", ...centered(f, w, h), element: el("div", { style: { width: Math.round(w) } }, [
      el("Title", { text: quote, size, weight: 550, lineHeight: 1.25, durationMs: 700, startMs: 300 }),
      el("div", { style: { marginTop: Math.round(size * 0.8), fontSize: Math.round(size * 0.45), opacity: 0.8 } }, [el("Title", { text: role ? `${name} · ${role}` : name, size: Math.round(size * 0.45), weight: 500, by: "line", startMs: 1800 })]),
    ]) }];
    return definition(f, { z: 120 }, layout, [cameraTrack("z", [[0, 120], [f.duration, 0]], "sine.inOut")], { primary: "quote", brand: true, copy: [quote, name, role] });
  },
  "end-card": (aspect, params) => {
    const f = frameFor(aspect, params, 4000), headline = text(params, "headline", "Make your launch memorable"), url = text(params, "url", "yourproduct.com"), cta = text(params, "cta", "Try it free");
    const size = Math.round(f.portrait ? f.W * 0.085 : f.H * 0.085), w = f.W * 0.8, h = size * 7;
    const layout: LayoutNode[] = [backdropNode(f, "gradient", -800, 1.3), { id: "card", ...centered(f, w, h), element: el("div", { style: { width: Math.round(w), display: "flex", flexDirection: "column", alignItems: "center", gap: Math.round(size * 0.4), textAlign: "center" } }, [
      el("BrandMark", { size: Math.round(size * 1.1) }),
      el("Title", { text: headline, size, align: "center", startMs: 300 }),
      el("Title", { text: url, size: Math.round(size * 0.42), weight: 450, by: "line", align: "center", startMs: 800, style: { opacity: 0.75 } }),
      el("Panel", { width: Math.round(size * 4.2), height: Math.round(size * 1.15), title: cta, startMs: 1100, style: { alignItems: "center", justifyContent: "center", padding: 0, background: "var(--velora-accent)", color: "#ffffff" } }),
    ]) }];
    return definition(f, { z: 50 }, layout, [cameraTrack("z", [[0, 50], [f.duration, 0]])], { primary: "card", brand: true, copy: [headline, url, cta] });
  },
  countdown: (aspect, params) => {
    const from = Math.max(1, Math.min(10, Math.round(number(params, "from", 3)))), f = frameFor(aspect, { ...params, durationMs: number(params, "durationMs", from * 1000 + 600) }, from * 1000 + 600);
    const size = Math.round(Math.min(f.W, f.H) * 0.42), stepMs = Math.round((f.duration - 600) / from);
    const layout: LayoutNode[] = [backdropNode(f, "aurora", -800, 1.4), { id: "count", ...centered(f, size * 1.6, size * 1.2), element: el("div", { style: { display: "grid", placeItems: "center", width: Math.round(size * 1.6), height: Math.round(size * 1.2) } }, [el("Countdown", { from, stepMs, startMs: 300, size })]) }];
    return definition(f, { z: 0 }, layout, [], { primary: "count", brand: true, copy: Array.from({ length: from }, (_, i) => String(from - i)) });
  },
  "changelog-card": (aspect, params) => {
    const f = frameFor(aspect, params, 6000), version = text(params, "version", "v2.0"), items = list(text(params, "items", "Template gallery|Quick shots of your live app|Master-quality renders|Brand looks")).slice(0, 5);
    const w = f.W * (f.portrait ? 0.84 : 0.56), size = Math.round(f.portrait ? f.W * 0.05 : f.H * 0.05), h = size * (items.length * 1.7 + 3.4);
    const layout: LayoutNode[] = [backdropNode(f, "mesh", -800, 1.3), { id: "card", ...centered(f, w, h), element: el("Panel", { width: Math.round(w), height: Math.round(h), title: `What's new in ${version}`, startMs: 200 }, items.map((item, i) =>
      el("Title", { text: `+ ${item}`, size, weight: 500, by: "line", startMs: 700 + i * 220, style: { marginTop: Math.round(size * 0.35) } }))) }];
    return definition(f, { z: 60, rotateY: -4 }, layout, [cameraTrack("z", [[0, 60], [f.duration, 0]]), cameraTrack("rotateY", [[0, -4], [f.duration, 0]])], { primary: "card", brand: true, copy: [version, ...items] });
  },
};
export function buildComposite(id: CompositeId, aspect: Aspect, params: Params): CompositeDefinition {
  return builders[id](aspect, params);
}
/** Words a viewer must read; certification wants >= 0.3 s per word + 1 s on screen. */
export function readingTimeMs(copy: readonly string[]): number {
  const count = copy.reduce((total, line) => total + words(line).length, 0);
  return count ? count * 300 + 1000 : 0;
}
/** The recipe definition part (what presentPreview and recipe JSON hold), without layout metadata. */
export function compositePreview(definition: ShotDefinition | CompositeDefinition): ShotDefinition {
  const { width, height, scene, motion } = definition;
  return { width, height, scene, motion };
}
