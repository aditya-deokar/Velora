import { useMemo, useState } from "react";
import { EDITOR_COMMANDS } from "./commands";
import { useEditor, useEditorState } from "./context";

/** Command palette (Ctrl/⌘+K): every EDITOR_COMMANDS entry by name, with its shortcut. */
export function Palette({ onClose }: { onClose(): void }) {
  const { store, controller } = useEditor();
  const state = useEditorState(store);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return EDITOR_COMMANDS.filter(command => !needle || command.label.toLowerCase().includes(needle) || command.id.includes(needle) || command.group.toLowerCase().includes(needle));
  }, [query]);
  const run = (index: number) => {
    const command = matches[index];
    if (!command || !command.enabled(state)) return;
    onClose();
    command.run({ ...controller, state: store.getState() });
  };
  return <div className="ve-popover ve-panel" role="dialog" aria-label="Command palette" style={{ top: 80, left: "50%", transform: "translateX(-50%)", width: 480 }} data-velora-preview-chrome="">
    <input className="ve-input" autoFocus role="combobox" aria-expanded="true" aria-controls="ve-palette-list" aria-activedescendant={`ve-cmd-${active}`} placeholder="Type a command"
      value={query} onChange={event => { setQuery(event.target.value); setActive(0); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setActive(Math.min(matches.length - 1, active + 1)); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActive(Math.max(0, active - 1)); }
        else if (event.key === "Enter") { event.preventDefault(); run(active); }
        else if (event.key === "Escape") { event.preventDefault(); onClose(); }
        event.stopPropagation();
      }}/>
    <ul id="ve-palette-list" role="listbox" style={{ listStyle: "none", margin: "6px 0 0", padding: 0, maxHeight: 360, overflow: "auto" }}>
      {matches.map((command, index) => <li key={command.id} id={`ve-cmd-${index}`} role="option" aria-selected={index === active} aria-disabled={!command.enabled(state)}
        onMouseEnter={() => setActive(index)} onClick={() => run(index)}
        style={{ display: "flex", justifyContent: "space-between", padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: index === active ? "#24425c" : undefined, opacity: command.enabled(state) ? 1 : 0.45 }}>
        <span>{command.label} <span className="ve-kbd">{command.group}</span></span>
        <span className="ve-kbd">{command.shortcuts.join("  ")}</span>
      </li>)}
    </ul>
  </div>;
}
