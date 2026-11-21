import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SourceOutlineSchema, VELORA_PACKAGE } from "../../src/core";
import { outlineSource, sourceDiff, transformSource } from "../../src/project/source";
import { executeEditCommand } from "../../src/project/edit";
import { loadSourceOutlines, prepareSourceEdit } from "../../src/project/source-edit";

const file = "src/velora/scenes/demo.tsx";
const imported = "src/Dashboard.jsx";
const sourceImport = `import { Surface } from '${VELORA_PACKAGE.name}';`;
const node = (text: string, tag: string, target = file) => outlineSource(target, text).nodes.find(entry => entry.tag === tag)!;
const wrap = (text: string, tag: string, target = file) => ({ kind: "wrap" as const, file: target, id: "hero", node: node(text, tag, target).path });

describe("JSX outline and source splices", () => {
  it("retains paths through unrelated edits and provides source positions and static metadata", () => {
    const text = `${sourceImport}\nfunction Card(){return <Surface id="card"><h1 id="title" data-kind="copy" className="large">A headline</h1></Surface>}\n`;
    const outline = SourceOutlineSchema.parse(outlineSource(file, text));
    const headline = outline.nodes[1];
    expect(headline).toMatchObject({ owner: "card", attributes: { id: "title", "data-kind": "copy", className: "large" }, text: "A headline", start: { line: 2 } });
    expect(node(`function Unrelated(){return <aside/>}\n// an unrelated comment\n${text}`, "h1").path).toBe(headline.path);
  });

  it("wraps a self-closing JSX node and preserves its CRLF, comments, and surrounding bytes", () => {
    const text = ["import React from 'react'; // keep", "// About this component", "export default function Card() {", "  return <main><Image alt=\"Shot\" /></main>;", "}", ""].join("\r\n");
    const result = transformSource({ ...wrap(text, "Image"), content: true }, text, false);
    expect(result.text).toBe(text.replace("// About this component", `${sourceImport}\r\n// About this component`).replace('<Image alt="Shot" />', '<Surface id="hero" content={<Image alt="Shot" />} />'));
    expect(result.ops).toEqual([{ op: "node.ensure", id: "hero" }]);
    expect(() => transformSource(wrap(result.text, "Image"), result.text, false)).toThrow(/passed as a JSX prop/);
  });

  it("refuses ambiguous targets and uses the existing alias for valid authored layers", () => {
    const prefix = `import { Surface as Layer } from '${VELORA_PACKAGE.name}';\n`;
    const text = `${prefix}export default function Card(){return <Layer id="outer"><div><Title/></div><aside>{xs.map(x=><p>{x}</p>)}</aside>{yes && <em/>}<Slot content={<b/>}/><Badge {...props}/><><i/></></Layer>}`;
    for (const [tag, reason] of [["p", /map or conditional/], ["em", /map or conditional/], ["b", /JSX prop/], ["Badge", /spread props/], ["Fragment", /fragment/], ["Layer", /already a Surface/]] as const)
      expect(() => transformSource(wrap(text, tag), text, false)).toThrow(reason);
    expect(transformSource(wrap(text, "Title"), text, false)).toMatchObject({ text: text.replace("<Title/>", '<Layer id="hero"><Title/></Layer>'), ops: [{ op: "node.ensure", id: "hero", parentId: "outer" }] });
    expect(() => transformSource(wrap(text, "Title"), text, true)).toThrow(/use client/);
    expect(() => transformSource(wrap(`'use server';\n${text}`, "Title"), `'use server';\n${text}`, false)).toThrow(/server-only/);
    expect(() => transformSource(wrap(text, "Title"), `<<<<<<< HEAD\n${text}`, false)).toThrow(/merge markers/);
  });

  it("groups contiguous Surface siblings while preserving comments and refuses skipped siblings", () => {
    const text = `${sourceImport}\nexport default function Card(){return <Surface id="outer"><Surface id="a" />{/* keep */}<Surface id="b"/><hr/><Surface id="c"/></Surface>}`;
    const [, a, b, , c] = outlineSource(file, text).nodes;
    const request = { kind: "group" as const, file, node: a.path, nodes: [a.path, b.path], id: "group" };
    const edit = transformSource(request, text, false);
    expect(edit.text).toBe(text.replace('<Surface id="a" />{/* keep */}<Surface id="b"/>', '<Surface id="group"><Surface id="a" />{/* keep */}<Surface id="b"/></Surface>'));
    expect(edit.ops).toEqual([{ op: "node.ensure", id: "group", parentId: "outer" }, { op: "node.parent", id: "a", parentId: "group" }, { op: "node.parent", id: "b", parentId: "group" }]);
    expect(() => transformSource({ ...request, nodes: [a.path, c.path] }, text, false)).toThrow(/other JSX between/);
  });

  it("exposes literal props in JSX without TypeScript syntax and binds the hook to the layer", () => {
    const text = `"use client";\n${sourceImport}\nexport default function Card() {\n  // keep this comment\n  return <Surface id="panel"><Counter value={-12} active tone="#ffcc00" mode="soft" /></Surface>;\n}\n`;
    const first = node(text, "Counter", imported);
    const request = { kind: "expose" as const, file: imported, node: first.path, id: "counter", prop: "value" };
    const result = transformSource(request, text, true);
    expect(result.text).toBe(text.replace(sourceImport, `${sourceImport}\nimport { useAnimatable } from '${VELORA_PACKAGE.name}';`)
      .replace("  // keep this comment", '  const veloraValue = useAnimatable("counter", { value: { type: "number", default: -12 } }, { owner: "panel", outsideScene: "defaults" });\n  // keep this comment')
      .replace("value={-12}", "value={veloraValue.value}"));
    expect(outlineSource(imported, result.text).animatables).toMatchObject([{ id: "counter", props: ["value"] }]);
    expect(transformSource({ ...request, prop: "active" }, text, true).text).toContain("active={veloraActive.active}");
    expect(transformSource({ ...request, prop: "tone" }, text, true).text).toContain('type: "color"');
    expect(transformSource({ ...request, prop: "mode", options: ["soft", "hard"] }, text, true).text).toContain('options: ["soft","hard"]');
    expect(() => transformSource({ ...request, prop: "mode" }, text, true)).toThrow(/enum options/);
  });

  it("shows separate hunks for an import and JSX without showing distant unchanged lines as edits", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `// keep line ${index}`).join("\n");
    const original = `${lines}\nexport default function Card(){return <h1/>}\n`;
    const changed = transformSource(wrap(original, "h1"), original, false).text;
    const diff = sourceDiff(original, changed);
    expect(diff.match(/^@@/gm)).toHaveLength(2);
    expect(diff).not.toContain("keep line 15");
  });
});

describe("source outline and CLI on a local project", () => {
  let root: string;
  const read = (file: string) => readFile(path.join(root, file), "utf8");
  const write = async (file: string, text: string) => { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text); };
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "velora-source-"));
    await write("src/velora/scenes/demo.scene.json", JSON.stringify({ version: 1, id: "demo", title: "Demo", definition: { scene: { nodes: [{ id: "frame" }] } } }, null, 2) + "\n");
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("follows one re-export, previews without writing, and applies with both hashes", async () => {
    const text = "export default function Dashboard(){return <h1>Headline</h1>}";
    await write(file, 'export { default } from "../../Dashboard";');
    await write(imported, text);
    expect((await loadSourceOutlines(root, { scene: "demo" })).map(item => item.file)).toEqual([file, imported]);
    const input = { sourceAction: "wrap" as const, scene: "demo", file: imported, sourceId: "hero", node: node(text, "h1", imported).path };
    const draft = await executeEditCommand("source", input, { root });
    expect(draft).toMatchObject({ success: true, data: { written: false, diffs: [{ file: imported }, { file: "src/velora/scenes/demo.scene.json" }] } });
    expect(await read(imported)).toBe(text);
    if (!draft.success) throw new Error("dry run failed");
    const hashes = draft.data.baseShas as Record<string, string>;
    const applied = await executeEditCommand("source", { ...input, write: true, expectSha: hashes[imported], expectRecipeSha: hashes["src/velora/scenes/demo.scene.json"] }, { root });
    expect(applied).toMatchObject({ success: true, data: { written: true } });
    expect(await read(imported)).toContain('<Surface id="hero" passthrough><h1>Headline</h1></Surface>');
  });

  it("keeps the literal parent of a single imported component and requires a client file in Next App Router", async () => {
    const text = "export default function Dashboard(){return <h1>Headline</h1>}";
    await write(file, `${sourceImport}\nimport Dashboard from "../../Dashboard";\nexport default function Demo(){return <Surface id="frame"><Dashboard/></Surface>}`);
    await write(imported, text);
    const request = { ...wrap(text, "h1", imported), scene: "demo" };
    expect((await prepareSourceEdit(root, request)).changes[1].after).toContain('"parentId": "frame"');
    await write("package.json", JSON.stringify({ dependencies: { next: "test" } }));
    await write("app/layout.jsx", "export default function Layout(){}");
    await expect(prepareSourceEdit(root, request)).rejects.toThrow(/use client/);
    await write(imported, `"use client";\n${text}`);
    await expect(prepareSourceEdit(root, request)).resolves.toMatchObject({ preview: { outline: { file: imported } } });
  });

  it("uses the named re-export as the scene binding and inspects its immediate component imports", async () => {
    const entry = "src/Actual.tsx";
    const text = 'export function Dashboard(){ return <main><Revenue /></main>; }';
    await write(file, 'export { WholeScene as default } from "../../Actual";');
    await write(entry, `${sourceImport}\nimport { Dashboard, Provider } from "./Dashboard";\nexport function WholeScene(){return <Provider><Surface id="frame"><Dashboard/></Surface></Provider>}\nexport function Other(){return <><Dashboard/><Dashboard/></>}`);
    await write(imported, text);
    expect((await loadSourceOutlines(root, { scene: "demo" })).map(item => item.file)).toEqual([file, entry, imported]);
    const plan = await prepareSourceEdit(root, { ...wrap(text, "Revenue", imported), scene: "demo" });
    expect(plan.changes[1].after).toContain('"parentId": "frame"');
  });
});
