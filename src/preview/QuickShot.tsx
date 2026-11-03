import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ASPECT_FRAMES, QUICK_SHOT_PARAMS, SCROLL_CHANNEL, SUBJECT_ID, quickShotQuery, readQuickShot, type PreviewDefinitionInput, type QuickShotState } from "../core";
import { Surface } from "../react";
import { RouteFrame } from "../kit";
import { ScenePreview } from "./ScenePreview";
import { ParamPanel } from "./ParamPanel";
import { TemplateLayout, useProjectBrand } from "./TemplateLayout";
import type { PreviewHot } from "./connection";

/** SOURCE OF TRUTH: QuickShot.
 * WHAT: a template applied to the live app with zero source files: the subject slot holds the host's
 * own children (Vite/portable hosts) or a same-origin RouteFrame (Next, or any chosen route).
 * WHY: the first cinematic result needs no code; the URL carries the whole shot, so reload, deep
 * links and `velora export --url` reproduce exactly what the panel shows.
 * WHERE: ProjectPreview opens it for velora-quick URLs; the gallery links to it; core readQuickShot
 * validates. Param edits replace the URL (no history spam) once per animation frame; the host
 * subtree is memoized so tweaks never remount the app.
 */
/** The search string for a quick shot, preserving every unrelated host query param. */
export function quickShotSearch(state: QuickShotState, base: string = ""): string {
  const query = new URLSearchParams(base);
  query.set("velora-preview", "1");
  for (const key of ["velora-scene", "velora-tab", "velora-composition", ...Object.values(QUICK_SHOT_PARAMS)]) query.delete(key);
  for (const [key, value] of Object.entries(quickShotQuery(state))) query.set(key, value);
  return "?" + query.toString();
}
export function QuickShot({ children, backHref, onBack, hot }: { children?: ReactNode; backHref?: string; onBack?: () => void; hot?: PreviewHot }) {
  const live = children !== undefined && children !== null;
  const [search, setSearch] = useState(() => typeof location === "undefined" ? "" : location.search);
  const shot = useMemo(() => readQuickShot(new URLSearchParams(search)), [search]);
  // Edits land in a draft at once (so several edits in one frame compose); the URL and the
  // rendered shot follow once per animation frame.
  const [draft, setDraft] = useState<QuickShotState>();
  // Hosts without children (Next studio route) always frame a route; default to the home page.
  const state: QuickShotState | undefined = draft ?? (shot && { template: shot.template, aspect: shot.aspect, overrides: shot.overrides,
    ...(shot.route !== undefined ? { route: shot.route } : live ? {} : { route: "/" }) });
  const pending = useRef<QuickShotState | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    const pop = () => { setDraft(undefined); setSearch(location.search); };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const change = (next: QuickShotState) => {
    pending.current = next;
    setDraft(next);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const value = pending.current;
      if (!value) return;
      const query = quickShotSearch(value, location.search);
      history.replaceState(history.state, "", location.pathname + query + location.hash);
      setSearch(query);
    });
  };
  const lastValid = useRef<PreviewDefinitionInput | undefined>(undefined);
  if (shot?.definition) lastValid.current = shot.definition as PreviewDefinitionInput;
  const subject = ASPECT_FRAMES[state?.aspect ?? "16:9"].subject;
  const route = state?.route;
  const brand = useProjectBrand();
  const layout = shot?.composite?.layout;
  // Layered and motion-graphics templates render their layout; the slot holds the same live app or route.
  const content = useMemo(() => layout
    ? <TemplateLayout layout={layout} brand={brand} slot={props => {
        const width = Number(props.width), height = Number(props.height);
        return <div style={{ width, height, overflow: "hidden", background: "#fff" }}>
          {route !== undefined ? <RouteFrame route={route} width={width} height={height}/> : children}
        </div>;
      }}/>
    : <Surface id={SUBJECT_ID} style={{ width: subject.width, height: subject.height, overflow: "hidden", background: "#fff" }}>
      {route !== undefined
        ? <RouteFrame route={route} width={subject.width} height={subject.height} scrollChannel={SCROLL_CHANNEL}/>
        : children}
    </Surface>, [children, route, subject.width, subject.height, layout, brand]);
  if (!shot || !state) return null;
  const href = typeof location === "undefined" ? "http://localhost:5173/" + quickShotSearch(state) : location.origin + location.pathname + quickShotSearch(state, location.search);
  return <ScenePreview title={`Quick shot · ${shot.manifest?.title ?? shot.template}`} definition={lastValid.current} backHref={backHref} onBack={onBack} hot={hot}
    exportSize={ASPECT_FRAMES[state.aspect]} fps={30}
    aside={shot.manifest ? <ParamPanel manifest={shot.manifest} state={state} issues={shot.issues} href={href} onChange={change} routeRequired={!live}/> :
      <aside className="velora-aside velora-chrome" data-velora-preview-chrome="" role="alert"><h2>Template not found</h2><p>{shot.issues[0]?.message} Open the Templates tab to pick one.</p></aside>}>
    {content}
  </ScenePreview>;
}
