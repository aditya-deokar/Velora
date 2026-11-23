import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { EDITOR_LABEL_COLORS } from "../core";
import { DepthTierSchema, type ResolvedDepth } from "../core/depth";
import { useEditor, useEditorState } from "./context";
import { listClips, listTracks } from "./model";
import type { Doc } from "./store";

/** Layers panel (EDITOR-UX §2): Camera, Focus, Motion, Look; the live Surface tree (recipe nodes that are
 * not mounted are flagged); animatables under their owning Surface; clips. Rename, color tags and locks
 * write editor metadata; solo and hide are editor-only UI state. role="tree" with roving focus. */
type Item = { id: string; label: string; kind: "camera" | "focus" | "motion" | "look" | "surface" | "animatable" | "three" | "clip" | "depth"; depth: number; children: Item[];
  flag?: string; owner?: string; layer?: ResolvedDepth["layers"][number]; explicitTier?: boolean };
const COLORS: Record<string, string> = { red: "#ff6b6b", orange: "#ff9f43", yellow: "#ffd166", green: "#5ee6a0", teal: "#3cc9c9", blue: "#7cc4ff", purple: "#b893ff", gray: "#9aa0aa" };
export function Layers() {
  const { store, snapshot, sceneId } = useEditor();
  const state = useEditorState(store);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string>();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const tree = useRef<HTMLUListElement>(null);
  const doc = state.draft as Doc;
  const editor = doc.editor ?? {};
  const labels: Record<string, string> = editor.labels ?? {}, colors: Record<string, string> = editor.colors ?? {}, locked: string[] = editor.locked ?? [];
  const animatedIds = useMemo(() => new Set(listTracks(doc).map(entry => "id" in entry.address.target ? entry.address.target.id : entry.address.target.kind)), [doc]);
  const items = useMemo(() => {
    const bindings = snapshot?.bindings ?? [];
    const mounted = new Set(bindings.map(binding => binding.id));
    const surface = (id: string, depth: number, flag?: string): Item => ({ id, label: labels[id] ?? id, kind: "surface", depth, flag, children: [
      ...bindings.filter(binding => binding.parentId === id).map(binding => surface(binding.id, depth + 1)),
      ...(snapshot?.animatables ?? []).filter(entry => entry.owner === id).map(entry => ({ id: entry.kind === "three" ? entry.id : `animatable:${entry.id}`, label: entry.label ?? entry.id,
        kind: entry.kind ?? ("animatable" as const), depth: depth + 1, children: [], owner: id })),
      ...(snapshot?.depth ?? []).filter(entry => entry.surface === id).flatMap((entry, source) => entry.layers.map((layer, index) => ({
        id: `depth:${id}:${source}:${index}`, label: "anchor" in layer.match ? layer.match.anchor : layer.match.selector,
        kind: "depth" as const, depth: depth + 1, children: [], owner: id, layer, explicitTier: entry.explicitTiers?.includes(index),
      }))),
    ] });
    const roots: Item[] = [
      { id: "camera", label: "Camera", kind: "camera", depth: 0, children: [] },
      { id: "focus", label: "Focus", kind: "focus", depth: 0, children: [] },
      { id: "motion", label: "Motion", kind: "motion", depth: 0, children: [] },
      ...(doc.definition?.look ? [{ id: "look", label: "Look", kind: "look" as const, depth: 0, children: [] }] : []),
      ...bindings.filter(binding => !binding.parentId || !mounted.has(binding.parentId)).map(binding => surface(binding.id, 0)),
      ...((doc.definition?.scene?.nodes ?? []) as { id: string }[]).filter(node => !mounted.has(node.id)).map(node => surface(node.id, 0, "not mounted")),
      ...listClips(doc).map(({ clip, depth }) => ({ id: `clip:${clip.id}`, label: clip.label ?? clip.id, kind: "clip" as const, depth, children: [] })),
    ];
    const needle = query.trim().toLowerCase();
    const keep = (item: Item): Item | undefined => {
      const children = item.children.map(keep).filter(Boolean) as Item[];
      const hit = (!needle || item.label.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle)) && (!state.ui.animatedOnly || animatedIds.has(item.id) || item.kind === "clip" || (item.kind === "three" && [...animatedIds].some(id => id.startsWith(item.id + "."))));
      return hit || children.length ? { ...item, children } : undefined;
    };
    return roots.map(keep).filter(Boolean) as Item[];
  }, [snapshot, doc, labels, query, state.ui.animatedOnly, animatedIds]);
  const flat = useMemo(() => {
    const out: Item[] = [];
    const walk = (list: Item[]) => list.forEach(item => { out.push(item); if (!collapsed.includes(item.id)) walk(item.children); });
    walk(items);
    return out;
  }, [items, collapsed]);
  const selected = state.selection.layers[0];
  const select = (item: Item, extend = false, toggle = false) => {
    if (item.kind === "clip") store.select({ layers: [item.id], clips: [item.id.slice(5)], tracks: [], keys: [] });
    else {
      const id = item.kind === "animatable" || item.kind === "depth" ? item.owner! : item.id;
      const existing = state.selection.layers.filter(layer => !layer.startsWith("clip:"));
      const layers = !extend ? [id] : existing.includes(id) ? toggle ? existing.filter(layer => layer !== id) : existing : [...existing, id];
      store.select({ layers, clips: [], tracks: [], keys: [] });
    }
  };
  const toggleUi = (key: "solo" | "hidden", id: string) => store.setUi({ [key]: state.ui[key].includes(id) ? state.ui[key].filter(entry => entry !== id) : [...state.ui[key], id] });
  const commitEditor = (ops: Parameters<typeof store.commit>[0], label: string) => store.commit(ops, label);
  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = flat.findIndex(item => item.id === (document.activeElement as HTMLElement | null)?.dataset.item);
    const focus = (next: number) => { const item = flat[Math.max(0, Math.min(flat.length - 1, next))]; tree.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(item.id)}"]`)?.focus(); };
    if (event.key === "ArrowDown") { event.preventDefault(); focus(index + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focus(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); focus(0); }
    else if (event.key === "End") { event.preventDefault(); focus(flat.length - 1); }
    else if (event.key === "ArrowLeft" && index >= 0) { event.preventDefault(); const item = flat[index]; if (item.children.length && !collapsed.includes(item.id)) setCollapsed([...collapsed, item.id]); }
    else if (event.key === "ArrowRight" && index >= 0) { event.preventDefault(); setCollapsed(collapsed.filter(id => id !== flat[index].id)); }
    else if ((event.key === "Enter" || event.key === " ") && index >= 0) { event.preventDefault(); event.stopPropagation(); select(flat[index], event.shiftKey || event.ctrlKey || event.metaKey, event.ctrlKey || event.metaKey); }
    else if (event.key === "F2" && index >= 0 && flat[index].kind === "surface") { event.preventDefault(); setRenaming(flat[index].id); }
  };
  const render = (item: Item) => {
    const isSelected = state.selection.layers.includes(item.id) || (item.kind === "clip" && state.selection.clips.includes(item.id.slice(5)));
    const surface = item.kind === "surface";
    return <li key={item.id} role="treeitem" aria-level={item.depth + 1} aria-selected={isSelected} aria-expanded={item.children.length ? !collapsed.includes(item.id) : undefined}>
      <div className="ve-row">
        <span className="ve-row-main" data-selected={isSelected} data-item={item.id} tabIndex={selected === item.id || (!selected && item.id === "camera") ? 0 : -1}
          onClick={event => select(item, event.shiftKey || event.ctrlKey || event.metaKey, event.ctrlKey || event.metaKey)} onDoubleClick={() => surface && setRenaming(item.id)}>
          {item.children.length ? <button className="ve-btn ve-icon" style={{ minHeight: 16, border: 0, background: "none" }} aria-label={collapsed.includes(item.id) ? "Expand" : "Collapse"} tabIndex={-1}
            onClick={event => { event.stopPropagation(); setCollapsed(collapsed.includes(item.id) ? collapsed.filter(id => id !== item.id) : [...collapsed, item.id]); }}>{collapsed.includes(item.id) ? "▸" : "▾"}</button> : <span style={{ width: 16 }}/>}
          <span aria-hidden="true">{item.kind === "camera" ? "🎥" : item.kind === "focus" ? "◎" : item.kind === "motion" ? "⏱" : item.kind === "look" ? "◐" : item.kind === "clip" ? "▭" : item.kind === "animatable" ? "⚙" : item.kind === "three" ? "◇" : "▢"}</span>
          {surface && colors[item.id] && <span className="ve-tag" style={{ background: COLORS[colors[item.id]] }} aria-label={`Color ${colors[item.id]}`}/>}
          {renaming === item.id ? <input className="ve-input" autoFocus defaultValue={labels[item.id] ?? ""} placeholder={item.id} aria-label={`Label for ${item.id}`}
            onKeyDown={event => {
              if (event.key === "Enter") { commitEditor([{ op: "editor.set", labels: { [item.id]: event.currentTarget.value.trim() || null } }], `Rename ${item.id}`); setRenaming(undefined); }
              if (event.key === "Escape") setRenaming(undefined);
              event.stopPropagation();
            }} onBlur={() => setRenaming(undefined)}/>
            : <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>}
          {item.flag && <span className="ve-flag">{item.flag}</span>}
          {locked.includes(item.id) && <span aria-label="Locked" title="Locked">🔒</span>}
        </span>
        {item.layer && <select className="ve-input" aria-label={`Depth tier for ${item.label}`} value={item.layer.tier} disabled={item.explicitTier}
          title={item.explicitTier ? "Tier is set by the host's data-velora-tier attribute" : undefined}
          onChange={event => commitEditor([{ op: "depth.rule.add", surface: item.owner!, index: 0,
            rule: { match: item.layer!.match, tier: DepthTierSchema.parse(event.target.value) } }], `Set ${item.label} depth tier`)}>
          {DepthTierSchema.options.map(tier => <option key={tier}>{tier}</option>)}
        </select>}
        {surface && <>
          <select className="ve-input" style={{ width: 22, padding: 0 }} aria-label={`Color tag for ${item.id}`} value={colors[item.id] ?? ""}
            onChange={event => commitEditor([{ op: "editor.set", colors: { [item.id]: (event.target.value || null) as never } }], `Color ${item.id}`)}>
            <option value="">–</option>{EDITOR_LABEL_COLORS.map(color => <option key={color} value={color}>{color}</option>)}
          </select>
          <button className="ve-btn ve-icon" aria-pressed={state.ui.solo.includes(item.id)} aria-label={`Solo ${item.id}`} title="Solo (editor only)" onClick={() => toggleUi("solo", item.id)}>S</button>
          <button className="ve-btn ve-icon" aria-pressed={state.ui.hidden.includes(item.id)} aria-label={`Hide ${item.id}`} title="Hide in editor" onClick={() => toggleUi("hidden", item.id)}>H</button>
          <button className="ve-btn ve-icon" aria-pressed={locked.includes(item.id)} aria-label={`Lock ${item.id}`} title="Lock"
            onClick={() => commitEditor([{ op: "editor.set", locked: locked.includes(item.id) ? locked.filter(id => id !== item.id) : [...locked, item.id] }], `${locked.includes(item.id) ? "Unlock" : "Lock"} ${item.id}`)}>L</button>
        </>}
      </div>
      {item.children.length > 0 && !collapsed.includes(item.id) && <ul role="group">{item.children.map(render)}</ul>}
    </li>;
  };
  return <div className="ve-panel" data-velora-editor-layers="" data-scene={sceneId}>
    <div className="ve-h"><span>Layers</span>
      <button className="ve-btn" aria-pressed={state.ui.animatedOnly} onClick={() => store.setUi({ animatedOnly: !state.ui.animatedOnly })} title="Show only animated (U)">Animated</button></div>
    <div style={{ padding: "6px 8px" }}><input className="ve-input" type="search" placeholder="Search layers" aria-label="Search layers" value={query} onChange={event => setQuery(event.target.value)}/></div>
    <ul className="ve-tree" role="tree" aria-label="Scene layers" aria-multiselectable="true" ref={tree} onKeyDown={onKey}>{items.map(render)}</ul>
  </div>;
}
