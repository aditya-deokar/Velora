import ts from "typescript";
import { VELORA_PACKAGE } from "../core/branding";
import { SCENE_RECIPE_DIRECTORY } from "../core/recipes";
import { SCROLL_CHANNEL, SUBJECT_ID, type ShotDefinition, type Aspect } from "../core/shots";
import type { ParamValue, TemplateManifest } from "../core/templates";
import { compositePreview, stageCompositeLayout, type CompositeDefinition, type JsonValue, type LayoutElement } from "../core/composites";
import type { Stage } from "../core/stage";
import { BRAND_FILE } from "../core/brand";

/** SOURCE OF TRUTH: scaffoldScene, componentExport, sceneImportPath, layoutJsx.
 * WHAT: pure generation of the files `velora new scene` writes: an editable recipe (template
 * provenance + compiled definition) and a binding that slots the user's real component or route.
 * WHY: templates are starting points the creator owns; output is ordinary source with no
 * runtime dependency on the template system.
 * WHERE: project/commands resolves policy and writes through services; this module never touches files.
 */
export type Slot =
  | { kind: "component"; importPath: string; exportName: string; isDefault: boolean }
  | { kind: "route"; route: string }
  | { kind: "placeholder" };
export const RECIPE_SCHEMA_POINTER = "../../../node_modules/@adityadeokar/velora/schemas/scene-recipe.schema.json";
export const COMPOSITION_SCHEMA_POINTER = "./node_modules/@adityadeokar/velora/schemas/composition.schema.json";

/** Find an export by name (or the default export) without executing the module. */
export function componentExport(source: string, filename: string, exportName: string | undefined): { name: string; isDefault: boolean } | undefined {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(filename) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isExported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
  let defaultName: string | undefined, hasDefault = false;
  const named = new Set<string>();
  for (const statement of file.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && isExported(statement)) {
      if (isDefault(statement)) { hasDefault = true; defaultName = statement.name?.text; }
      else if (statement.name) named.add(statement.name.text);
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) named.add(declaration.name.text);
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      hasDefault = true;
      if (ts.isIdentifier(statement.expression)) defaultName = statement.expression.text;
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text === "default") { hasDefault = true; defaultName = element.propertyName?.text; }
        else named.add(element.name.text);
      }
    }
  }
  if (exportName === undefined || exportName === "default") return hasDefault ? { name: defaultName ?? "Subject", isDefault: true } : undefined;
  return named.has(exportName) ? { name: exportName, isDefault: false } : undefined;
}
/** Relative import from the scene directory to a project file, without its extension. */
export function sceneImportPath(componentPath: string): string {
  const from = SCENE_RECIPE_DIRECTORY.split("/"), to = componentPath.replace(/\.[cm]?[jt]sx?$/, "").split("/");
  while (from.length && to.length > 1 && from[0] === to[0]) { from.shift(); to.shift(); }
  const up = from.length ? "../".repeat(from.length) : "./";
  return up + to.join("/");
}
const pascal = (id: string) => id.split("-").map(part => part[0].toUpperCase() + part.slice(1)).join("");
const identifier = (name: string, avoid: string[]) => {
  const safe = /^[A-Za-z_$][\w$]*$/.test(name) ? name : "Subject";
  return avoid.includes(safe) ? `${safe}Subject` : safe;
};

export type ScaffoldInput = {
  id: string; title: string; manifest: TemplateManifest; params: Record<string, ParamValue>;
  aspect: Aspect; definition: ShotDefinition | CompositeDefinition; subject: { width: number; height: number }; slot: Slot; stage?: Stage;
};
const PLAIN_ELEMENTS = new Set(["div", "span", "strong", "p"]);
const attribute = (name: string, value: JsonValue) =>
  typeof value === "string" && /^[^"\\\n{}<>&]*$/.test(value) ? `${name}="${value}"` : `${name}={${JSON.stringify(value)}}`;
/** Serialize one layout element as JSX (the slot renders through `slot`). */
export function layoutJsx(element: LayoutElement | string, slot: (props: Record<string, JsonValue>) => string, indent: string): string {
  if (typeof element === "string") return `${indent}{${JSON.stringify(element)}}`;
  if (element.type === "Slot") return slot(element.props ?? {}).split("\n").map(line => indent + line).join("\n");
  const props = Object.entries(element.props ?? {}).map(([name, value]) => " " + attribute(name, value)).join("");
  if (!element.children?.length) return `${indent}<${element.type}${props} />`;
  return `${indent}<${element.type}${props}>\n${element.children.map(child => layoutJsx(child, slot, indent + "  ")).join("\n")}\n${indent}</${element.type}>`;
}
function kitTypes(element: LayoutElement | string, found: Set<string>): Set<string> {
  if (typeof element === "string") return found;
  if (element.type !== "Slot" && !PLAIN_ELEMENTS.has(element.type)) found.add(element.type);
  for (const child of element.children ?? []) kitTypes(child, found);
  return found;
}
/** The recipe JSON and binding TSX for one templated scene. */
export function scaffoldScene(input: ScaffoldInput): { recipe: string; binding: string } {
  const { id, title, manifest, params, aspect, definition, subject, slot, stage } = input;
  const recipe = {
    $schema: RECIPE_SCHEMA_POINTER,
    version: 1,
    id,
    title,
    description: manifest.summary,
    template: { id: manifest.id, version: manifest.version, aspect, params, ...(stage?.preset ? { stage: stage.preset } : {}) },
    definition: { ...compositePreview(definition), ...(stage ? { stage } : {}) },
  };
  const component = pascal(id);
  if ("layout" in definition) return { recipe: JSON.stringify(recipe, null, 2) + "\n", binding: compositeBinding(id, component, manifest, definition, slot, stage) };
  const scroll = manifest.shot === "scroll-through";
  const left = Math.round((definition.width - subject.width) / 2), top = Math.round((definition.height - subject.height) / 2);
  const imports = [`import { Surface${stage ? ", AppStage, useAppStage" : ""} } from '${VELORA_PACKAGE.name}';`];
  let content: string;
  if (slot.kind === "component") {
    const local = identifier(slot.exportName, [component, "Surface", "ScrollFrame", "AppStage", "useAppStage"]);
    imports.push(slot.isDefault ? `import ${local} from '${slot.importPath}';` : slot.exportName === local
      ? `import { ${local} } from '${slot.importPath}';` : `import { ${slot.exportName} as ${local} } from '${slot.importPath}';`);
    if (scroll) imports.push(`import { ScrollFrame } from '${VELORA_PACKAGE.name}/kit';`);
    content = scroll
      ? `<ScrollFrame channel="${SCROLL_CHANNEL}" width={${stage ? "stage?.width ?? " : ""}${subject.width}} height={${stage ? "stage?.height ?? " : ""}${subject.height}}>\n        <${local} />\n      </ScrollFrame>`
      : `<${local} />`;
  } else if (slot.kind === "route") {
    imports.push(`import { RouteFrame } from '${VELORA_PACKAGE.name}/kit';`);
    content = `<RouteFrame route=${JSON.stringify(slot.route)}${stage ? "" : ` width={${subject.width}} height={${subject.height}}`}${scroll ? ` scrollChannel="${SCROLL_CHANNEL}"` : ""} />`;
  } else {
    imports.push(`import { SlotPlaceholder } from '${VELORA_PACKAGE.name}/kit';`);
    content = `<SlotPlaceholder name="${SUBJECT_ID}" width={${stage ? "stage?.width ?? " : ""}${subject.width}} height={${stage ? "stage?.height ?? " : ""}${subject.height}} />`;
  }
  const usesStageHook = stage && (slot.kind === "placeholder" || (slot.kind === "component" && scroll));
  if (!usesStageHook && stage) imports[0] = imports[0].replace(", useAppStage", "");
  if (stage) content = `<AppStage fit={{ width: ${subject.width}, height: ${subject.height} }}>\n        ${content}\n      </AppStage>`;
  const guidance = slot.kind === "component"
    ? "// TODO(velora): wrap the subject with the providers it needs (theme, data, router), as in your app root.\n"
    : slot.kind === "placeholder" ? "// TODO(velora): replace SlotPlaceholder with your real component (and its providers) or a RouteFrame.\n" : "";
  const binding = `// Generated by velora new scene from template "${manifest.id}". This file is yours: edit it freely.
// The camera, lens and focus live in ${id}.scene.json; the Surface id "${SUBJECT_ID}" must stay.
${imports.join("\n")}

${guidance}export default function ${component}() {
${usesStageHook ? "  const stage = useAppStage();\n" : ""}  return (
    <Surface id="${SUBJECT_ID}" style={{ position: 'absolute', left: ${left}, top: ${top}, width: ${subject.width}, height: ${subject.height} }}>
      ${content}
    </Surface>
  );
}
`;
  return { recipe: JSON.stringify(recipe, null, 2) + "\n", binding };
}

// The layered / motion-graphics binding: one Surface per layout node, kit components by name, the brand
// file wrapped around everything, and the template slot filled with the user's component or route.
function compositeBinding(id: string, component: string, manifest: TemplateManifest, definition: CompositeDefinition, slot: Slot, stage?: Stage): string {
  const kit = new Set<string>();
  const layout = stage ? stageCompositeLayout(definition.layout) : definition.layout;
  for (const node of layout) kitTypes(node.element, kit);
  const appStage = kit.delete("AppStage") || !!stage && manifest.slots.length > 0;
  if (definition.brand) kit.add("BrandProvider");
  const imports = [`import { Surface${appStage ? ", AppStage" : ""} } from '${VELORA_PACKAGE.name}';`];
  let local = "";
  if (slot.kind === "component") {
    local = identifier(slot.exportName, [component, "Surface", "AppStage", ...kit]);
    imports.push(slot.isDefault ? `import ${local} from '${slot.importPath}';` : slot.exportName === local
      ? `import { ${local} } from '${slot.importPath}';` : `import { ${slot.exportName} as ${local} } from '${slot.importPath}';`);
  } else if (slot.kind === "route") kit.add("RouteFrame");
  else if (manifest.slots.length) kit.add("SlotPlaceholder");
  if (kit.size) imports.push(`import { ${[...kit].sort().join(", ")} } from '${VELORA_PACKAGE.name}/kit';`);
  if (definition.brand) imports.push(`import brand from '../../../${BRAND_FILE}';`);
  const fill = (props: Record<string, JsonValue>) => {
    const width = Number(props.width), height = Number(props.height);
    const inner = slot.kind === "component" ? `<${local} />`
      : slot.kind === "route" ? `<RouteFrame route=${JSON.stringify(slot.route)}${stage ? "" : ` width={${width}} height={${height}}`} />`
      : `<SlotPlaceholder name="subject" width={${width}} height={${height}} />`;
    const paint = stage ? `<AppStage fit={{ width: ${width}, height: ${height} }}>\n    ${inner}\n  </AppStage>` : inner;
    return `<div style={{ width: ${width}, height: ${height}, overflow: 'hidden', background: '#fff' }}>\n  ${paint}\n</div>`;
  };
  const indent = definition.brand ? "        " : "      ";
  const surfaces = layout.map(node =>
    `${indent.slice(2)}<Surface id="${node.id}" style={{ position: 'absolute', left: ${node.left}, top: ${node.top}, width: ${node.width}, height: ${node.height} }}>\n${layoutJsx(node.element, fill, indent)}\n${indent.slice(2)}</Surface>`).join("\n");
  const body = definition.brand ? `    <BrandProvider brand={brand}>\n${surfaces}\n    </BrandProvider>` : surfaces;
  const guidance = slot.kind === "component" ? "// TODO(velora): wrap the subject with the providers it needs (theme, data, router), as in your app root.\n"
    : slot.kind === "placeholder" && manifest.slots.length ? "// TODO(velora): replace SlotPlaceholder with your real component (and its providers) or a RouteFrame.\n" : "";
  return `// Generated by velora new scene from template "${manifest.id}". This file is yours: edit it freely.
// Camera and motion live in ${id}.scene.json; Surface ids must match its nodes. Colors, fonts and motion
// personality come from ${BRAND_FILE} at render time: edit that file to re-skin every scene.
${imports.join("\n")}

${guidance}export default function ${component}() {
  return (
${body}
  );
}
`;
}
