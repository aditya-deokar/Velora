import { useId, useMemo, type CSSProperties } from "react";
import { coverScaleAt, createRng } from "../core";
import { Surface, useAnimatableState, useSceneTime } from "../react";
import { useSceneContext } from "../react/context";
import { animatableIdFor } from "./brand";
const SWEEP_SPEC = { progress: { type: "number", default: -1, label: "Sweep progress" } } as const;
import { tint } from "./color";
import { useBrand } from "./brand";

/** SOURCE OF TRUTH: Backdrop, Glow, ContactShadow, LightSweep, Dust.
 * WHAT: atmosphere that sits in depth behind or around real UI: gradient/mesh/aurora/grid-floor/
 * spotlight/solid backdrops, soft glows, contact shadows, a specular light sweep and seeded dust.
 * WHY: products read premium against lit space; placed on a deep Surface, a backdrop picks up
 * parallax and depth-of-field softness from the canonical camera (the scene's black void is unchanged).
 * WHERE: template bindings put Backdrop in a far Surface (for example z -1600, sized past the frame);
 * everything here is a pure function of scene time, channels, seeds and brand tokens.
 */
export type BackdropVariant = "gradient" | "mesh" | "aurora" | "grid-floor" | "spotlight" | "solid";
export function Backdrop({ variant = "gradient", width, height, colors, style, z }: { variant?: BackdropVariant; width: number; height: number; colors?: string[]; style?: CSSProperties; z?: number }) {
  const brand = useBrand();
  const [base, a, b] = colors ?? [brand.colors.background, brand.colors.accent, brand.colors.primary];
  const time = useSceneTime();
  const id = useId();
  const { context } = useSceneContext();
  const drift = (time / 1000) * 2; // degrees per second: aurora breathes slowly
  const layer: CSSProperties = { position: "absolute", inset: 0 };
  const content = variant === "solid" ? null
    : variant === "gradient" ? <div style={{ ...layer, background: `radial-gradient(120% 90% at 50% 0%, ${tint(a, 33)} 0%, transparent 60%), linear-gradient(180deg, ${base} 0%, color-mix(in srgb, ${base} 78%, #000) 100%)` }}/>
    : variant === "mesh" ? <div style={{ ...layer, background: `radial-gradient(40% 50% at 20% 30%, ${tint(a, 40)}, transparent 70%), radial-gradient(45% 55% at 80% 25%, ${tint(b, 25)}, transparent 70%), radial-gradient(50% 60% at 55% 85%, ${tint(a, 20)}, transparent 70%)` }}/>
    : variant === "aurora" ? <div style={{ ...layer, background: `conic-gradient(from ${drift}deg at 50% 60%, ${tint(a, 0)}, ${tint(a, 33)}, ${tint(b, 20)}, ${tint(a, 0)} 60%)`, filter: `blur(${Math.round(Math.min(width, height) * 0.06)}px)` }}/>
    : variant === "spotlight" ? <div style={{ ...layer, background: `radial-gradient(38% 46% at 50% 42%, ${tint(b, 19)}, transparent 70%)` }}/>
    : <GridFloor width={width} height={height} line={a}/>;
  const backdrop = <div data-velora-backdrop={variant} style={{ position: "relative", width, height, overflow: "hidden", background: base, ...style }}>{content}</div>;
  if (z === undefined || !context) return backdrop;
  const frame = context.frameSize(), camera = context.displayCamera;
  const cover = camera && frame?.width && frame.height ? coverScaleAt(z, camera, frame, { width, height }) : 1;
  return <Surface id={`backdrop-${id}`} transform={{ z, scale: Number.isFinite(cover) ? Math.min(100, cover) : 100 }}
    style={{ position: "absolute", left: "50%", top: "50%", marginLeft: -width / 2, marginTop: -height / 2, width, height }}>{backdrop}</Surface>;
}
function GridFloor({ width, height, line }: { width: number; height: number; line: string }) {
  const cell = Math.max(24, Math.round(Math.min(width, height) / 18));
  // A flat grid tilted into a floor inside the backdrop; the horizon fades to the base color.
  return <div style={{ position: "absolute", inset: 0, perspective: height, overflow: "hidden" }}>
    <div style={{ position: "absolute", left: "-50%", right: "-50%", top: "45%", height: "140%", transform: "rotateX(72deg)", transformOrigin: "50% 0",
      backgroundImage: `linear-gradient(${tint(line, 33)} 1px, transparent 1px), linear-gradient(90deg, ${tint(line, 33)} 1px, transparent 1px)`, backgroundSize: `${cell}px ${cell}px`,
      maskImage: "linear-gradient(transparent, #000 35%)", WebkitMaskImage: "linear-gradient(transparent, #000 35%)" }}/>
    <div style={{ position: "absolute", left: 0, right: 0, top: "38%", height: "14%", background: `radial-gradient(50% 50% at 50% 50%, ${tint(line, 25)}, transparent 70%)` }}/>
  </div>;
}
export function Glow({ size, color, intensity = 0.6, style }: { size: number; color?: string; intensity?: number; style?: CSSProperties }) {
  const brand = useBrand();
  const tone = color ?? brand.colors.accent;
  return <div data-velora-glow="" style={{ width: size, height: size, borderRadius: "50%", background: `radial-gradient(circle, ${tone} 0%, transparent 65%)`, opacity: Math.max(0, Math.min(1, intensity)), filter: `blur(${Math.round(size * 0.08)}px)`, pointerEvents: "none", ...style }}/>;
}
export function ContactShadow({ width, height = Math.round(width * 0.08), opacity = 0.5, style }: { width: number; height?: number; opacity?: number; style?: CSSProperties }) {
  return <div data-velora-shadow="" style={{ width, height, borderRadius: "50%", background: `radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,${opacity}) 0%, transparent 100%)`, filter: `blur(${Math.round(height * 0.35)}px)`, pointerEvents: "none", ...style }}/>;
}
/**
 * A specular band across its parent leaf. Progress 0..1 comes from a channel or from startMs/durationMs.
 * Place it inside the same Surface as the UI it lights (absolute, inset 0); it never covers pointer events.
 */
export function LightSweep({ channel, startMs = 0, durationMs = 1600, angle = 105, width = 0.22, intensity = 0.35 }: { channel?: string; startMs?: number; durationMs?: number; angle?: number; width?: number; intensity?: number }) {
  const time = useSceneTime();
  const channelValue = useAnimatableState(animatableIdFor(channel), SWEEP_SPEC, channel ? { channels: { progress: channel } } : {}).values.progress;
  const progress = channel ? channelValue : Math.max(0, Math.min(1, (time - startMs) / Math.max(1, durationMs)));
  if (progress <= 0 || progress >= 1) return null;
  const center = -width * 100 + progress * (100 + width * 200);
  return <div data-velora-sweep="" style={{ position: "absolute", inset: 0, pointerEvents: "none", mixBlendMode: "screen",
    background: `linear-gradient(${angle}deg, transparent ${center - width * 100}%, rgba(255,255,255,${intensity}) ${center}%, transparent ${center + width * 100}%)` }}/>;
}
/** Seeded floating particles: positions are a function of seed and scene time only. */
export function Dust({ width, height, count = 40, seed = 7, color = "rgba(255,255,255,.55)", speed = 12 }: { width: number; height: number; count?: number; seed?: number; color?: string; speed?: number }) {
  const time = useSceneTime();
  const motes = useMemo(() => {
    const rng = createRng(seed);
    return Array.from({ length: Math.max(0, Math.min(400, count)) }, () => ({ x: rng() * width, y: rng() * height, r: 0.6 + rng() * 2.2, phase: rng() * Math.PI * 2, drift: 0.4 + rng() }));
  }, [seed, count, width, height]);
  const t = time / 1000;
  return <svg data-velora-dust="" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
    {motes.map((mote, index) => {
      const y = (((mote.y - t * speed * mote.drift) % height) + height) % height;
      const x = mote.x + Math.sin(t * 0.6 + mote.phase) * 10;
      return <circle key={index} cx={x.toFixed(2)} cy={y.toFixed(2)} r={mote.r.toFixed(2)} fill={color} opacity={(0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t + mote.phase))).toFixed(3)}/>;
    })}
  </svg>;
}
