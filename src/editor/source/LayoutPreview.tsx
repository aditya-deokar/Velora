import type { CSSProperties } from "react";

type Box = { style: CSSProperties; children: Part[] };
type Part = Box | string;
export type SourceLayout = { before: Box; after: Box; width: number; height: number };

/** Preview the wrapper's layout on a static copy of the current DOM. The copy contains only CSS
 * layout and text. It can't execute host code, mount components, or load images or iframes. */
export function sourceLayout(elements: Element[]): SourceLayout | undefined {
  const parent = elements[0]?.parentElement;
  if (!parent || elements.some(element => element.parentElement !== parent) || elements.length > 100) return;
  const width = parent.clientWidth, height = parent.clientHeight;
  if (width < 1 || height < 1) return;
  let budget = 160;
  const capture = (node: Node, depth: number, shallow = false): Part | undefined => {
    if (budget-- <= 0 || depth > 5) return;
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.slice(0, 200);
    if (!(node instanceof Element) || node.matches("script,style,template,iframe")) return;
    const computed = getComputedStyle(node);
    const { display, position, top, right, bottom, left, boxSizing, width, height, minWidth, maxWidth,
      margin, padding, gap, flex, flexDirection, flexWrap, alignItems, alignSelf, justifyContent,
      gridTemplateColumns, gridTemplateRows, gridArea, border, borderRadius, color, backgroundColor, font, whiteSpace, lineHeight } = computed;
    return { style: { display, position: position === "fixed" ? "absolute" : position as CSSProperties["position"], top, right, bottom, left, boxSizing: boxSizing as CSSProperties["boxSizing"],
      ...(display === "inline" ? {} : { width, height, minWidth, maxWidth }), margin, padding, gap, flex, flexDirection: flexDirection as CSSProperties["flexDirection"],
      flexWrap: flexWrap as CSSProperties["flexWrap"], alignItems, alignSelf, justifyContent, gridTemplateColumns, gridTemplateRows, gridArea, border, borderRadius, color, backgroundColor, font,
      whiteSpace: whiteSpace as CSSProperties["whiteSpace"], lineHeight },
      children: shallow ? [] : [...node.childNodes].slice(0, 60).flatMap(child => { const part = capture(child, depth + 1); return part === undefined ? [] : [part]; }) };
  };
  const originals = [...parent.childNodes];
  if (originals.length > 60) return;
  const before = capture(parent, 0, true);
  if (!before || typeof before === "string") return;
  const snapshot = originals.map(node => ({ node, part: capture(node, 1) }));
  const selected = new Set<Node>(elements);
  const indices = snapshot.flatMap((entry, index) => selected.has(entry.node) ? [index] : []);
  const first = indices[0] ?? -1, last = indices.at(-1) ?? -1;
  if (first < 0 || last < 0) return;
  const parts = (items: typeof snapshot) => items.flatMap(({ part }) => part === undefined ? [] : [part]);
  const inner: Box = { style: { transformStyle: "preserve-3d" }, children: parts(snapshot.slice(first, last + 1)) };
  const wrapper: Box = { style: { position: "relative", transformStyle: "preserve-3d", outline: "1px dashed #7cc4ff" }, children: [inner] };
  const rootStyle: CSSProperties = { ...before.style, position: "relative", top: "auto", right: "auto", bottom: "auto", left: "auto", margin: 0 };
  return { before: { style: rootStyle, children: parts(snapshot) }, after: { style: rootStyle, children: [...parts(snapshot.slice(0, first)), wrapper, ...parts(snapshot.slice(last + 1))] }, width, height };
}

function Sample({ box }: { box: Box }) {
  return <div style={box.style}>{box.children.map((part, index) => typeof part === "string" ? part : <Sample key={index} box={part}/>)}</div>;
}

export function LayoutPreview({ layout }: { layout: SourceLayout }) {
  const scale = Math.min(1, 330 / layout.width, 150 / layout.height);
  return <details aria-label="Layout preview">
    <summary>Preview wrapper layout</summary>
    <p>Sample of the current DOM. Check the live layout after applying.</p>
    {[{ label: "Current layout", box: layout.before }, { label: "With Surface", box: layout.after }].map(({ label, box }) => <section key={label}>
      <p>{label}</p>
      <div style={{ width: layout.width * scale, height: layout.height * scale, overflow: "hidden", pointerEvents: "none" }} aria-hidden="true">
        <div style={{ width: layout.width, transform: `scale(${scale})`, transformOrigin: "top left" }}><Sample box={box}/></div>
      </div>
    </section>)}
  </details>;
}
