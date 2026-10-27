import { useState } from "react";
import { quickShotCommands, type QuickShotState, type TemplateIssue, type TemplateManifest } from "../core";

/** SOURCE OF TRUTH: ParamPanel, quickShotPrompt.
 * WHAT: schema-driven controls for one template's typed params plus aspect and route, and copy
 * actions for the exact scaffold command, export command and an agent prompt.
 * WHY: the studio produces commands, never files: the CLI and agents own the source.
 * WHERE: QuickShot renders it in ScenePreview's aside; chrome-marked so capture never sees it.
 */
export function quickShotPrompt(manifest: TemplateManifest, scaffold: string): string {
  return `Read VELORA.md and run npx velora guide. Create a Velora scene from the "${manifest.id}" template (${manifest.title}): run ${scaffold}. ` +
    "Use this app's real component (replace <path#Export>) or keep the route, wrap any providers the component needs where the binding's TODO(velora) comment says, " +
    "then prove it with velora shot at the start, middle and end. Refine the recipe JSON by hand; keep the single motivated move.";
}
type Copy = "scaffold" | "export" | "prompt";
export function ParamPanel({ manifest, state, issues, href, onChange, routeRequired }: {
  manifest: TemplateManifest; state: QuickShotState; issues: TemplateIssue[]; href: string;
  onChange: (next: QuickShotState) => void; routeRequired?: boolean;
}) {
  const [copied, setCopied] = useState<Copy | "failed" | "">("");
  const [collapsed, setCollapsed] = useState(false);
  const commands = quickShotCommands(state, href);
  const texts: Record<Copy, string> = { scaffold: commands.scaffold, export: commands.export, prompt: quickShotPrompt(manifest, commands.scaffold) };
  const copy = async (kind: Copy) => {
    try { await navigator.clipboard.writeText(texts[kind]); setCopied(kind); } catch { setCopied("failed"); }
  };
  const set = (name: string, value: string | number | undefined) => {
    const overrides = { ...state.overrides };
    if (value === undefined || value === "") delete overrides[name]; else overrides[name] = value;
    onChange({ ...state, overrides });
  };
  if (collapsed) return <aside className="velora-aside velora-chrome" data-velora-preview-chrome="" data-collapsed="">
    <button className="velora-control" onClick={() => setCollapsed(false)}>Shot settings</button>
  </aside>;
  return <aside className="velora-aside velora-chrome" data-velora-preview-chrome="" aria-label="Shot settings">
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
      <h2>{manifest.title}</h2><button className="velora-control" onClick={() => setCollapsed(true)}>Hide</button>
    </div>
    <p>{manifest.summary}</p>
    <label className="velora-field"><span>Aspect</span>
      <select aria-label="Aspect" value={state.aspect} onChange={event => onChange({ ...state, aspect: event.target.value as QuickShotState["aspect"] })}>
        {manifest.aspects.map(aspect => <option key={aspect} value={aspect}>{aspect}</option>)}
      </select></label>
    {(routeRequired || state.route !== undefined) && <label className="velora-field"><span>Route</span>
      <input type="text" aria-label="Route" value={state.route ?? "/"} spellCheck={false}
        onChange={event => onChange({ ...state, route: event.target.value })}/>
      <small>A same-origin page of your running app.</small></label>}
    {manifest.params.map(param => {
      const current = state.overrides[param.name];
      if (param.type === "enum") return <label key={param.name} className="velora-field"><span>{param.name}</span>
        <select aria-label={param.name} value={String(current ?? param.default)} onChange={event => set(param.name, event.target.value === param.default ? undefined : event.target.value)}>
          {param.options.map(option => <option key={option} value={option}>{option}</option>)}
        </select><small>{param.description}</small></label>;
      if (param.type === "number") {
        const value = Number(current ?? param.default);
        const step = param.max - param.min > 1000 ? 100 : 1;
        return <label key={param.name} className="velora-field"><span>{param.name}<output>{value}{param.unit ? " " + param.unit : ""}</output></span>
          <input type="range" aria-label={param.name} min={param.min} max={param.max} step={step} value={Number.isFinite(value) ? value : param.default}
            onChange={event => { const next = Number(event.target.value); set(param.name, next === param.default ? undefined : next); }}/>
          <small>{param.description}</small></label>;
      }
      return <label key={param.name} className="velora-field"><span>{param.name}</span>
        <input type="text" aria-label={param.name} placeholder="x,y,width,height" value={current === undefined ? "" : String(current)} spellCheck={false}
          onChange={event => set(param.name, event.target.value.trim() || undefined)}/>
        <small>{param.description}</small></label>;
    })}
    {issues.length > 0 && <ul className="velora-issues" role="alert">{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
    <code data-testid="scaffold-command">{commands.scaffold}</code>
    <div className="velora-actions">
      <button className="velora-control velora-primary" disabled={issues.length > 0} onClick={() => copy("export")}>{copied === "export" ? "Copied" : "Copy export command"}</button>
      <button className="velora-control" disabled={issues.length > 0} onClick={() => copy("scaffold")}>{copied === "scaffold" ? "Copied" : "Copy scaffold command"}</button>
      <button className="velora-control" disabled={issues.length > 0} onClick={() => copy("prompt")}>{copied === "prompt" ? "Copied" : "Copy agent prompt"}</button>
    </div>
    <p role="status">{copied === "failed" ? "Clipboard unavailable. Select and copy the command above." : "Export runs in your project terminal (Chromium and FFmpeg). Nothing is written until you run a command."}</p>
  </aside>;
}
