import { useEffect, useState, type FormEvent } from "react";
import { SourceRequestSchema, fillPrompt, findPrompt, type SourceDocument, type SourceNode, type SourcePreview, type SourceRequest } from "../../core";
import { useEditor, useEditorState } from "../context";
import { copyText } from "../History";
import { MotionPanel } from "../MotionDesign";
import { DiffPanel } from "./DiffPanel";
import { Outline } from "./Outline";
import { sourceLayout, type SourceLayout } from "./LayoutPreview";
import { codeLink, mappedSourceNode, sourceCandidates, type SourceHint } from "./pick";

export function PromoteDialog({ onClose, hint, undoId, rememberUndo }: {
  onClose(): void; hint?: SourceHint; undoId?: string; rememberUndo(id?: string): void;
}) {
  const { client, hello, sceneId, store, notify } = useEditor();
  const state = useEditorState(store);
  const [files, setFiles] = useState<SourceDocument[]>([]);
  const [active, setActive] = useState<string>();
  const [candidatePaths, setCandidatePaths] = useState<string[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [kind, setKind] = useState<SourceRequest["kind"]>("wrap");
  const [id, setId] = useState("");
  const [content, setContent] = useState(false);
  const [prop, setProp] = useState("");
  const [options, setOptions] = useState("");
  const [preview, setPreview] = useState<SourcePreview>();
  const [layout, setLayout] = useState<SourceLayout>();
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const available = !!client && !!hello?.capabilities.includes("source");

  useEffect(() => {
    if (!available || !client) return;
    let current = true;
    setLoading(true);
    setProblem("");
    void (async () => {
      try {
        const { outlines } = await client.outlineSource(sceneId);
        const candidates = sourceCandidates(outlines, hint);
        let mapped: SourceNode | undefined;
        if (hint?.location) {
          try { mapped = mappedSourceNode((await client.outlineSource(sceneId, hint.location.file)).outlines, hint); }
          catch { /* External or stale attr: the authored outline remains available. */ }
        }
        if (!current) return;
        setFiles(outlines);
        setCandidatePaths(candidates.map(candidate => candidate.node.path));
        setActive(mapped?.path);
        setChecked([]);
      } catch (error) { if (current) setProblem((error as Error).message); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; };
  }, [available, client, sceneId, hint, refresh]);

  const file = files.find(file => file.nodes.some(node => node.path === active));
  const node = file?.nodes.find(node => node.path === active);
  const groupFiles = files.filter(file => file.nodes.some(node => checked.includes(node.path)));
  const groupFile = groupFiles.length === 1 ? groupFiles[0] : undefined;
  const targetFile = kind === "group" ? groupFile : file;
  const targetPath = kind === "group" ? checked[0] : active;
  const liveLayers = new Set(state.selection.layers);
  const selectedSourceLayers = files.flatMap(file => file.nodes.filter(node => node.surfaceId && liveLayers.has(node.surfaceId)).map(node => node.path));
  const canWrite = available && !state.readOnly && !state.pending.length && state.save !== "conflict";
  const select = (node: SourceNode) => { setActive(node.path); setProp(""); setPreview(undefined); setProblem(""); };
  const draft = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !targetFile || !targetPath) return;
    setProblem(""); setBusy(true);
    try {
      const request = SourceRequestSchema.parse({ file: targetFile.file, scene: sceneId, kind, node: targetPath, id, expectedSha: targetFile.sha,
        ...(kind === "wrap" ? { content } : {}), ...(kind === "group" ? { nodes: checked } : {}),
        ...(kind === "expose" ? { prop, ...(options.trim() ? { options: options.split(",").map(value => value.trim()).filter(Boolean) } : {}) } : {}),
      });
      const proposed = await client.previewSource(request);
      const targets = kind === "group" ? targetFile.nodes.flatMap(candidate => {
        const live = candidate.surfaceId && checked.includes(candidate.path) ? document.querySelector(`[data-velora-layout=editor] [data-velora-id="${CSS.escape(candidate.surfaceId)}"]`) : null;
        return live ? [live] : [];
      }) : kind === "wrap" && hint?.element?.isConnected && hint.element.localName === node?.tag.toLowerCase()
        && (node.text === hint.text || candidatePaths[0] === active) ? [hint.element] : [];
      setLayout(sourceLayout(targets));
      setPreview(proposed);
    } catch (error) { setProblem((error as Error).message); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!preview || !client || !canWrite) return;
    setBusy(true); setProblem("");
    try {
      const { undoId } = await client.applySource({ previewId: preview.previewId, baseShas: preview.baseShas });
      rememberUndo(undoId); setPreview(undefined); setRefresh(value => value + 1);
      notify("Source edit applied. Check the live scene as the host reloads.");
    } catch (error) { setProblem((error as Error).message); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    if (!client || !undoId || !canWrite) return;
    setBusy(true); setProblem("");
    try {
      await client.undoSource(undoId); rememberUndo(); setPreview(undefined); setRefresh(value => value + 1);
      notify("Restored the source edit.");
    } catch (error) { setProblem((error as Error).message); }
    finally { setBusy(false); }
  };
  const askAgent = async () => {
    const prompt = fillPrompt(findPrompt("promote-layer")!, { scene: sceneId,
      file: targetFile?.file ?? hint?.location?.file ?? `src/velora/scenes/${sceneId}`,
      node: targetPath ?? "the picked JSX element", id: id || "an unused layer ID", operation: kind, reason: problem || "Review the layout and ownership before making a change.",
    });
    if (await copyText(prompt)) notify("Copied the source edit prompt.");
    else setProblem("Clipboard access is unavailable. Copy the prompt from the field below.");
    setAgentPrompt(prompt);
  };
  const [agentPrompt, setAgentPrompt] = useState("");
  return <MotionPanel title="Source integration" onClose={onClose}>
    {!available && <p>Open Edit mode through the project bridge to inspect JSX.</p>}
    {loading && <p role="status">Reading JSX…</p>}
    {hint && <p>Picked {hint.tag}{hint.text ? ` · ${hint.text}` : ""}{hint.surface ? ` · ${hint.surface}` : ""}. {active ? "Review the selected source node." : "Choose a match in the outline."}</p>}
    {problem && <p role="alert">{problem}</p>}
    {problem && <button className="ve-btn" type="button" onClick={() => void askAgent()}>Ask agent</button>}
    {available && problem && <button className="ve-btn" type="button" disabled={loading || busy} onClick={() => { setPreview(undefined); setRefresh(value => value + 1); }}>Refresh outline</button>}
    {agentPrompt && <textarea className="ve-input" aria-label="Source edit prompt" value={agentPrompt} readOnly rows={5}/>}
    {available && undoId && <button className="ve-btn" disabled={!canWrite || busy} onClick={() => void undo()}>Undo last source edit</button>}
    {preview ? <DiffPanel preview={preview} layout={layout} disabled={!canWrite} busy={busy} apply={() => void apply()} back={() => { setPreview(undefined); setProblem(""); }}/> : files.length > 0 && <>
      <Outline files={files} active={active} candidates={candidatePaths} checked={checked} select={select} toggle={node => {
        setChecked(values => values.includes(node.path) ? values.filter(path => path !== node.path) : [...values, node.path]); setKind("group"); setProblem("");
      }}/>
      {node && file && <div className="ve-source-links">
        <a className="ve-btn" href={codeLink(file.absolutePath, node.start)}>Open in editor</a>
        <button className="ve-btn" onClick={async () => { if (await copyText(`${file.absolutePath}:${node.start.line}:${node.start.column}`)) notify("Copied source location."); }}>Copy path:line</button>
      </div>}
      <form className="ve-motion-fields" onSubmit={event => void draft(event)}>
        <label>Operation<select className="ve-input" value={kind} onChange={event => { setKind(event.target.value as typeof kind); setProblem(""); }}>
          <option value="wrap">Promote to layer</option><option value="group">Group spatial layers</option><option value="expose">Expose prop</option>
        </select></label>
        {kind === "group" && <><p>{checked.length} layers selected. Choose contiguous siblings in one file.</p>
          {selectedSourceLayers.length > 1 && <button type="button" className="ve-btn" onClick={() => setChecked(selectedSourceLayers)}>Use selected layers</button>}
          {groupFiles.length > 1 && <p role="alert">Group layers from one source file.</p>}</>}
        <label>{kind === "expose" ? "Animatable ID" : "Layer ID"}<input className="ve-input" value={id} onChange={event => setId(event.target.value)} required maxLength={80}/></label>
        {kind === "wrap" && <label><input type="checkbox" checked={content} onChange={event => setContent(event.target.checked)}/> Wrap as visual content</label>}
        {kind === "expose" && <>
          <label>Prop<select className="ve-input" value={prop} onChange={event => setProp(event.target.value)} required><option value="">Choose a literal</option>
            {Object.keys(node?.literals ?? {}).filter(name => /^[a-zA-Z][a-zA-Z0-9]*$/.test(name) && name !== "key" && name !== "ref").map(name => <option key={name}>{name}</option>)}
          </select></label>
          {prop && typeof node?.literals[prop] === "string" && <label>Enum options<input className="ve-input" value={options} onChange={event => setOptions(event.target.value)} placeholder="Comma-separated if needed"/></label>}
        </>}
        <button className="ve-btn" type="submit" disabled={busy || !id || !targetPath || !targetFile || (kind === "group" && checked.length < 2)}>Preview source edit</button>
      </form>
    </>}
    {available && !canWrite && <p>{state.readOnly ? "This bridge is read-only." : "Wait for timeline edits to save before applying a source diff."}</p>}
  </MotionPanel>;
}
