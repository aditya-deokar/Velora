import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { RouteSchema } from "../core/templates";
import { useAnimatableState, useCaptureSettle } from "../react";
import { useProjectedDepth } from "../react/depth";
import { useSceneContext } from "../react/context";
import { SCROLL_SPEC, animatableIdFor } from "./brand";

/** RouteFrame: a same-origin route of the running app, framed as live material in a Surface.
 * WHAT: an iframe of the host route at a fixed viewport size whose scroll follows a channel track;
 * page animations are paused so every capture of the same time is the same frame.
 * WHY: the zero-code path — any page (Next, Vite, any React host) becomes a template subject
 * without importing its components or providers.
 * WHERE: template bindings (velora new scene --route) render it inside the subject Surface.
 * Cross-origin or blocked frames report themselves invalid so capture refuses them.
 */
export type RouteFrameProps = {
  route: string;
  width?: number;
  height?: number;
  /** Channel track whose value is the page scroll offset in pixels. */
  scrollChannel?: string;
  /** Fixed scroll offset when no channel drives it. */
  scrollY?: number;
  /** Pause CSS animations and transitions inside the page (default true). */
  freezeAnimations?: boolean;
  hideScrollbars?: boolean;
  title?: string;
  style?: CSSProperties;
};
const STYLE_ID = "velora-route-frame";
function visibleImagesDecoded(document: Document): Promise<unknown> {
  const view = document.defaultView;
  const height = view?.innerHeight ?? 0;
  const images = Array.from(document.images).filter(image => {
    const box = image.getBoundingClientRect();
    return box.bottom >= 0 && box.top <= height;
  });
  return Promise.all(images.map(image => image.decode().catch(() => undefined)));
}
export function RouteFrame({ route, width, height, scrollChannel, scrollY = 0, freezeAnimations = true, hideScrollbars = true, title, style }: RouteFrameProps) {
  const { context, parent } = useSceneContext();
  const anchors = context?.registry.elementAnchors;
  const parsed = RouteSchema.safeParse(route);
  const scrollState = useAnimatableState(animatableIdFor(scrollChannel), SCROLL_SPEC, scrollChannel ? { channels: { scroll: scrollChannel } } : {});
  const scroll = scrollChannel && scrollState.animated.has("scroll") ? scrollState.values.scroll : scrollY;
  const frame = useRef<HTMLIFrameElement>(null);
  const sheetRef = useRef<HTMLStyleElement>(null);
  const captureEnded = useRef(false);
  const [loadedDocument, setLoadedDocument] = useState<Document>();
  const [state, setState] = useState<"loading" | "ready" | "blocked">("loading");
  const loaded = useMemo(() => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }, [route]);
  const src = useMemo(() => typeof location === "undefined" || !parsed.success ? "about:blank" : new URL(route, location.origin).href, [route, parsed.success]);
  const document = () => {
    try { return frame.current?.contentDocument ?? undefined; } catch { return undefined; }
  };
  useProjectedDepth(frame, loadedDocument === document() ? loadedDocument : undefined, () => {
    captureEnded.current = true;
    sheetRef.current?.remove();
    sheetRef.current = null;
  });
  useLayoutEffect(() => frame.current && loadedDocument && loadedDocument === document() && parent && anchors
    ? anchors.route({ frame: frame.current, document: loadedDocument, owner: parent }) : undefined, [loadedDocument, parent, anchors, src]);
  useLayoutEffect(() => () => { sheetRef.current?.remove(); sheetRef.current = null; }, [src]);
  const apply = () => {
    const doc = document();
    if (!doc || captureEnded.current) return;
    if (!doc.getElementById(STYLE_ID)) {
      sheetRef.current?.remove();
      const sheet = doc.createElement("style");
      sheet.id = STYLE_ID;
      sheet.textContent = [
        freezeAnimations ? "*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}" : "",
        hideScrollbars ? "html{scrollbar-width:none}html::-webkit-scrollbar{display:none}" : "",
      ].join("");
      doc.head.appendChild(sheet);
      sheetRef.current = sheet;
      doc.defaultView?.addEventListener("pagehide", () => sheet.remove(), { once: true });
    }
    doc.defaultView?.scrollTo(0, scroll);
  };
  const onLoad = () => {
    const doc = document();
    if (!doc || doc.location.origin !== location.origin) { setLoadedDocument(undefined); setState("blocked"); loaded.resolve(); return; }
    captureEnded.current = false;
    apply();
    setLoadedDocument(doc);
    setState("ready");
    loaded.resolve();
  };
  useLayoutEffect(() => { if (state === "ready") apply(); });
  useEffect(() => () => loaded.resolve(), [loaded]);
  // Every capture seek waits for the route to load, scrolls to the frame's offset and decodes what is visible.
  useCaptureSettle(async () => {
    await loaded.promise;
    apply();
    const doc = document();
    if (!doc) return;
    await doc.fonts?.ready;
    await visibleImagesDecoded(doc);
  });
  const size = { width: width ?? "100%", height: height ?? "100%" };
  if (!parsed.success || state === "blocked")
    return (
      <div role="alert" data-velora-valid="false" data-velora-route-frame="blocked"
        style={{ ...size, display: "grid", placeItems: "center", background: "#1b1b20", color: "#f3f3f5", font: "500 20px/1.4 system-ui, sans-serif", padding: 32, boxSizing: "border-box", ...style }}>
        {!parsed.success ? parsed.error.issues[0].message : `ERR_ROUTE_FRAME_BLOCKED: ${route} could not be framed. Serve it from this app's origin and allow same-origin framing in development.`}
      </div>
    );
  return <iframe ref={frame} src={src} title={title ?? `Route ${route}`} onLoad={onLoad} data-velora-route-frame={state}
    style={{ display: "block", ...size, border: 0, background: "#fff", pointerEvents: "none", ...style }} />;
}
