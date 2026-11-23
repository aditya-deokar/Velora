import { useEffect, useId, useRef, useState } from "react";
import { editorHandoff } from "./handoff";

type Props = { context: Omit<Parameters<typeof editorHandoff>[0], "intent">; onClose(): void };
export function AskAgent({ context, onClose }: Props) {
  const [intent, setIntent] = useState("");
  const [status, setStatus] = useState("");
  const [manualCopy, setManualCopy] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const intentId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return <dialog ref={ref} aria-label="Ask agent" data-velora-preview-chrome="" onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}
    style={{ boxSizing: "border-box", width: "min(450px, 90vw)", maxHeight: "75vh", color: "#f5f5f8", background: "#202229", border: "1px solid #7b8191", borderRadius: 8, padding: 16, font: "14px/1.5 system-ui, sans-serif" }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (!intent.trim()) return;
      const prompt = editorHandoff({ ...context, intent });
      try { await navigator.clipboard.writeText(prompt); setStatus("Prompt copied."); setManualCopy(""); }
      catch { setManualCopy(prompt); setStatus("Select and copy the prompt below."); }
    }}>
      <label htmlFor={intentId}>What should the agent change?</label>
      <textarea id={intentId} required maxLength={2000} value={intent} onChange={event => { setIntent(event.currentTarget.value); setStatus(""); setManualCopy(""); }}
        style={{ display: "block", width: "100%", boxSizing: "border-box", margin: "8px 0", minHeight: 90, font: "inherit" }}/>
      <button type="submit" disabled={!intent.trim()}>Copy agent prompt</button>{" "}<button type="button" onClick={onClose}>Close</button>
      <div role="status">{status}</div>
      {manualCopy && <textarea readOnly aria-label="Agent prompt" value={manualCopy} onFocus={event => event.currentTarget.select()}
        style={{ display: "block", width: "100%", boxSizing: "border-box", minHeight: 150, font: "inherit" }}/>}
    </form>
  </dialog>;
}
