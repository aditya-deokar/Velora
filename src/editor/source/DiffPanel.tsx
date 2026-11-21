import type { SourcePreview } from "../../core";
import { LayoutPreview, type SourceLayout } from "./LayoutPreview";

export function DiffPanel({ preview, layout, disabled, busy, apply, back }: { preview: SourcePreview; layout?: SourceLayout; disabled: boolean; busy: boolean; apply(): void; back(): void }) {
  return <section className="ve-motion-fields" aria-label="Source diff">
    {preview.layoutWarning && <p>{preview.layoutWarning}</p>}
    {layout && <LayoutPreview layout={layout}/>}
    {preview.diffs.map(({ file, git, diff }) => <section key={file}>
      <p>{file} · Git {git}</p>
      <pre tabIndex={0}>{diff}</pre>
    </section>)}
    <details><summary>Resulting JSX outline</summary>
      <ul>{preview.outline.nodes.slice(0, 200).map(node => <li key={node.path}>{node.start.line} · {node.tag}{node.surfaceId ? ` ${node.surfaceId}` : ""}</li>)}</ul>
    </details>
    <button className="ve-btn" disabled={disabled || busy} onClick={apply}>{busy ? "Applying…" : "Apply source edit"}</button>
    <button className="ve-btn" disabled={busy} onClick={back}>Back to outline</button>
  </section>;
}
