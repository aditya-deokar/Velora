import { useState } from "react";
import type { SourceDocument, SourceNode } from "../../core";

export function Outline({ files, active, candidates, checked, select, toggle }: {
  files: SourceDocument[]; active?: string; candidates: string[]; checked: string[];
  select(node: SourceNode): void; toggle(node: SourceNode): void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rank = new Map(candidates.map((path, index) => [path, index]));
  return <section className="ve-source-outline" aria-label="JSX outline">
    <label>Find JSX<input className="ve-input" type="search" value={query} onChange={event => setQuery(event.target.value)}/></label>
    {files.map(file => {
      const lookup = new Map(file.nodes.map(node => [node.path, node]));
      const nodes = file.nodes.filter(node => !needle || `${node.tag} ${node.surfaceId ?? ""} ${node.attributes.id ?? ""} ${node.text}`.toLowerCase().includes(needle));
      const shown = !needle && nodes.length > 200 ? [...nodes].sort((a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity)).slice(0, 200) : nodes.slice(0, 200);
      return <details key={file.file} open>
        <summary>{file.file}</summary>
        <ul>{shown.map(node => {
          let depth = 0;
          for (let parent = node.parent; parent && depth < 6; parent = lookup.get(parent)?.parent) depth++;
          const label = `${node.tag}${node.surfaceId ? ` ${node.surfaceId}` : node.attributes.id ? ` #${node.attributes.id}` : ""}${node.text ? ` · ${node.text}` : ""}`;
          return <li key={node.path} style={{ paddingInlineStart: depth * 8 }}>
            <button className="ve-btn" type="button" aria-pressed={node.path === active} data-source-candidate={rank.has(node.path) ? "" : undefined} onClick={() => select(node)} title={`${node.start.line}:${node.start.column}`}>{label}</button>
            {node.surfaceId && <input type="checkbox" aria-label={`Group ${node.surfaceId}`} checked={checked.includes(node.path)} onChange={() => toggle(node)}/>}
          </li>;
        })}</ul>
        {nodes.length > shown.length && <p>Showing {shown.length} of {nodes.length} elements. Search to narrow the outline.</p>}
        {file.animatables.length > 0 && <p>Animatables · {file.animatables.map(item => `${item.id} (${item.props.join(", ")})`).join(", ")}</p>}
      </details>;
    })}
  </section>;
}
