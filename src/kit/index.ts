/** SOURCE OF TRUTH: Velora kit entry (@adityadeokar/velora/kit).
 * WHAT: ready-made, deterministic building blocks for template bindings: slots, device frames,
 * atmosphere, interaction, type, media, brand tokens and the browser layer of looks.
 * WHY: scaffolded scenes import tested parts instead of inventing UI per project.
 * WHERE: generated bindings import from the kit subpath; components read time only from the Scene.
 */
export { RouteFrame, type RouteFrameProps } from "./RouteFrame";
export { ScrollFrame } from "./ScrollFrame";
export { SlotPlaceholder } from "./SlotPlaceholder";
export { BrandProvider, BrandMark, useBrand, useReveal, useRevealer, useSpan, type RevealTiming } from "./brand";
export { BrowserFrame, WindowFrame, PhoneFrame, TabletFrame, LaptopFrame, type FrameTheme } from "./frames";
export { Backdrop, Glow, ContactShadow, LightSweep, Dust, type BackdropVariant } from "./atmosphere";
export { Cursor, Typewriter, Spotlight, Callout, type CursorSkin } from "./interaction";
export { Title, Counter, Countdown, Panel, Marquee, GradientText, CaptionTrack, cueWords, segmentText, type Split, type CaptionStyle, type CaptionCueInput, type CaptionWord } from "./type";
export { VideoClip, ImageLayer } from "./media";
export { LookLayer, GRAIN_FPS } from "./Look";
export { TextAnimator, type TextAnimatorProps } from "./text-animator";
export { DrawPath, trimDash, type DrawPathProps } from "./draw-path";
export { Shape, polygonPoints, type ShapeKind, type ShapeProps } from "./shape";
