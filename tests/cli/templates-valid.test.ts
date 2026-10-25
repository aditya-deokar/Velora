import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { loadSceneRecipes, SCENE_RECIPE_DIRECTORY } from "../../src/core/recipes";

// Shipped templates are starting points agents copy verbatim: each recipe must pass the
// same catalog validation as a project scene, and each binding must be a default-export
// component whose literal Surface ids cover every recipe node. No component executes.
const templates = fileURLToPath(new URL("../../skills/velora/templates", import.meta.url));
const pairs = readdirSync(templates, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
  const dir = path.join(templates, entry.name);
  const files = readdirSync(dir);
  const recipe = files.find(file => file.endsWith(".scene.json"));
  if (!recipe) return [];
  const id = recipe.replace(/\.scene\.json$/, "");
  const binding = files.find(file => file === `${id}.tsx` || file === `${id}.jsx`);
  return [{ template: entry.name, id, recipePath: path.join(dir, recipe), bindingPath: binding && path.join(dir, binding) }];
});

function inspectBinding(file: string) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const syntax = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  let defaultExport = false;
  const ids: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) defaultExport = true;
    if (ts.isExportAssignment(node) && !node.isExportEquals) defaultExport = true;
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "Surface")
      for (const attribute of node.attributes.properties)
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "id" && attribute.initializer && ts.isStringLiteral(attribute.initializer))
          ids.push(attribute.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { syntax, defaultExport, ids };
}

describe("shipped scene templates", () => {
  it("ships at least the documented starting points", () => {
    expect(pairs.map(pair => pair.template).sort()).toEqual(expect.arrayContaining(["kinetic-title", "product-survey", "scene-minimal", "webgl-stage"]));
  });
  it.each(pairs)("$template validates as a project scene pair", pair => {
    expect(pair.bindingPath, `${pair.template} needs a sibling ${pair.id}.tsx`).toBeDefined();
    const document = JSON.parse(readFileSync(pair.recipePath, "utf8"));
    const binding = `${SCENE_RECIPE_DIRECTORY}/${path.basename(pair.bindingPath!)}`;
    const catalog = loadSceneRecipes({ sources: [{ path: `${SCENE_RECIPE_DIRECTORY}/${pair.id}.scene.json`, document }], bindingPaths: [binding] });
    expect(catalog.issues).toEqual([]);
    expect(catalog.scenes.map(scene => scene.id)).toEqual([pair.id]);
    const inspected = inspectBinding(pair.bindingPath!);
    expect(inspected.syntax).toEqual([]);
    expect(inspected.defaultExport, `${pair.template} binding needs a default component export`).toBe(true);
    const nodes = (document.definition.scene.nodes as { id: string }[]).map(node => node.id);
    expect(inspected.ids).toEqual(expect.arrayContaining(nodes));
  });
});
