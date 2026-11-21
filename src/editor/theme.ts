/** Editor chrome styles, scoped under the editor layout so host styles are never reset (theme.ts rules).
 * Text meets 4.5:1 on the editor background; focus rings are always visible. */
export const editorTheme = `
[data-velora-layout=editor]{--ve-bg:#0b0b0d;--ve-panel:#141417;--ve-raise:#1d1d22;--ve-line:#ffffff1f;--ve-text:#ececf1;--ve-dim:#a9a9b6;--ve-accent:#7cc4ff;--ve-key:#ffd166;--ve-sel:#ff8a3d;--ve-danger:#ff6b6b;--ve-ok:#5ee6a0}
[data-velora-layout=editor] .ve-panel{font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ve-text)}
[data-velora-layout=editor] .ve-panel :focus-visible{outline:2px solid var(--ve-accent);outline-offset:1px}
[data-velora-layout=editor] .ve-h{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:11px;color:var(--ve-dim);border-bottom:1px solid var(--ve-line);gap:6px}
[data-velora-layout=editor] .ve-btn{appearance:none;border:1px solid var(--ve-line);background:var(--ve-raise);color:var(--ve-text);border-radius:6px;padding:3px 8px;font:inherit;cursor:pointer;min-height:24px;display:inline-flex;align-items:center;gap:4px}
[data-velora-layout=editor] .ve-btn:hover{background:#2a2a31}[data-velora-layout=editor] .ve-btn[aria-pressed=true]{background:#24425c;border-color:var(--ve-accent)}
[data-velora-layout=editor] .ve-btn:disabled{opacity:.4;cursor:default}
[data-velora-layout=editor] .ve-icon{min-width:24px;padding:2px 4px;justify-content:center}
[data-velora-layout=editor] .ve-input{background:#0f0f12;border:1px solid var(--ve-line);color:var(--ve-text);border-radius:5px;padding:2px 6px;font:inherit;min-width:0;width:100%;box-sizing:border-box}
[data-velora-layout=editor] .ve-input.ve-italic{font-style:italic;color:#cfd8ff}
[data-velora-layout=editor] .ve-scrub{cursor:ew-resize;color:var(--ve-dim);user-select:none;padding:0 4px;touch-action:none}
[data-velora-layout=editor] .ve-tree{list-style:none;margin:0;padding:4px 0}
[data-velora-layout=editor] .ve-tree ul{list-style:none;margin:0;padding:0 0 0 14px}
[data-velora-layout=editor] .ve-row{display:flex;align-items:center;gap:6px;padding:2px 8px;cursor:default;border-radius:4px;min-height:24px}
[data-velora-layout=editor] .ve-row[aria-selected=true]>.ve-row-main,[data-velora-layout=editor] .ve-row-main[aria-selected=true]{background:#24425c}
[data-velora-layout=editor] .ve-row-main{display:flex;align-items:center;gap:6px;flex:1;min-width:0;border-radius:4px;padding:2px 4px}
[data-velora-layout=editor] .ve-row-main:hover{background:#1f1f25}
[data-velora-layout=editor] .ve-flag{color:var(--ve-danger);font-size:10px}
[data-velora-layout=editor] .ve-tag{width:8px;height:8px;border-radius:50%;flex:none}
[data-velora-layout=editor] .ve-group{border-bottom:1px solid var(--ve-line)}
[data-velora-layout=editor] .ve-group>summary{padding:6px 10px;cursor:pointer;font-weight:600;color:var(--ve-dim)}
[data-velora-layout=editor] .ve-prop{display:grid;grid-template-columns:22px minmax(64px,1fr) 64px minmax(70px,1.2fr);align-items:center;gap:4px;padding:2px 10px}
[data-velora-layout=editor] .ve-prop label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-velora-layout=editor] .ve-nav{display:flex;gap:1px}
[data-velora-layout=editor] .ve-nav button{appearance:none;background:none;border:0;color:var(--ve-dim);cursor:pointer;padding:0 2px;font:inherit}
[data-velora-layout=editor] .ve-nav button[data-on=true]{color:var(--ve-key)}
[data-velora-layout=editor] .ve-watch{appearance:none;background:none;border:0;cursor:pointer;color:var(--ve-dim);font-size:13px;padding:0}
[data-velora-layout=editor] .ve-watch[aria-pressed=true]{color:var(--ve-accent)}
[data-velora-layout=editor] .ve-save{font-size:12px;white-space:nowrap}
[data-velora-layout=editor] .ve-save[data-state=saved]{color:var(--ve-ok)}[data-velora-layout=editor] .ve-save[data-state=conflict],[data-velora-layout=editor] .ve-save[data-state=offline]{color:var(--ve-danger)}
[data-velora-layout=editor] .ve-popover{position:fixed;z-index:30;background:var(--ve-panel);border:1px solid var(--ve-line);border-radius:10px;box-shadow:0 20px 60px #000c;max-height:70vh;overflow:auto;padding:8px;min-width:280px}
[data-velora-layout=editor] .ve-banner{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 10px;background:#2d2410;color:#ffe2a8;border-bottom:1px solid #6b5520}
[data-velora-layout=editor] .ve-banner[data-kind=conflict]{background:#3a1717;color:#ffd0d0;border-color:#7a2a2a}
[data-velora-layout=editor] .ve-toast{position:fixed;left:50%;bottom:300px;transform:translateX(-50%);z-index:40;background:#26262d;color:var(--ve-text);border:1px solid var(--ve-line);padding:8px 12px;border-radius:8px;display:flex;gap:8px;align-items:center}
[data-velora-layout=editor] .ve-tl{display:grid;grid-template-columns:220px 1fr;flex:1;min-height:0}
[data-velora-layout=editor] .ve-tl-head{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--ve-line);flex-wrap:wrap}
[data-velora-layout=editor] .ve-tc{font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ve-text);min-width:110px}
[data-velora-layout=editor] .ve-labels{overflow:hidden;border-right:1px solid var(--ve-line);position:relative}
[data-velora-layout=editor] .ve-lanes{position:relative;overflow:hidden;touch-action:none}
[data-velora-layout=editor] .ve-label{position:absolute;left:0;right:0;height:24px;display:flex;align-items:center;gap:4px;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;border-bottom:1px solid #ffffff0a}
[data-velora-layout=editor] .ve-label[data-kind=layer]{font-weight:600;background:#17171b}
[data-velora-layout=editor] .ve-label[aria-selected=true]{background:#1d3347}
[data-velora-layout=editor] .ve-kf:focus{outline:none}[data-velora-layout=editor] .ve-kf:focus-visible .ve-kf-glyph{stroke:var(--ve-accent);stroke-width:2}
[data-velora-layout=editor] .ve-menu{position:fixed;z-index:35;background:var(--ve-panel);border:1px solid var(--ve-line);border-radius:8px;padding:4px;min-width:200px;box-shadow:0 12px 40px #000c}
[data-velora-layout=editor] .ve-menu button{display:flex;justify-content:space-between;gap:16px;width:100%;text-align:left;background:none;border:0;color:var(--ve-text);padding:5px 8px;border-radius:5px;font:inherit;cursor:pointer}
[data-velora-layout=editor] .ve-menu button:hover,[data-velora-layout=editor] .ve-menu button:focus-visible{background:#24425c}
[data-velora-layout=editor] .ve-kbd{color:var(--ve-dim);font:11px ui-monospace,monospace}
[data-velora-layout=editor] .ve-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
[data-velora-layout=editor] .ve-motion-fields{display:grid;gap:8px;padding:8px}
[data-velora-layout=editor] .ve-motion-fields label{display:flex;align-items:center;justify-content:space-between;gap:8px}
[data-velora-layout=editor] .ve-motion-fields .ve-input{width:min(58%,220px)}
[data-velora-layout=editor] .ve-motion-fields p{margin:0;color:var(--ve-dim)}
[data-velora-layout=editor] .ve-motion-fields .ve-preset{justify-content:flex-start;gap:10px}
`;
