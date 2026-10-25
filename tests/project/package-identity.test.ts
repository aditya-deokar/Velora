import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VELORA_PACKAGE } from "../../src/core/branding";
import { getAuthoringGuide } from "../../src/core/authoring";
import { generatedPreview } from "../../src/project/vite";
import { portableIntegration } from "../../src/project/portable";

// One package identity: generators, the guide and every taught example must import
// what npm installs. Legacy names exist only to recognize earlier installer bytes.
const root = fileURLToPath(new URL("../..", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const bareImport = /from\s+['"]velora(?:\/preview)?['"]|npm install velora(?![\w@/.-])/;

function textFiles(target: string): string[] {
  const absolute = path.join(root, target);
  if (/\.[a-z]+$/.test(target)) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", "dist", ".vite"].includes(entry.name)) return [];
    const relative = path.join(target, entry.name);
    if (entry.isDirectory()) return textFiles(relative);
    return /\.(?:md|ts|tsx|js|jsx|mjs|json|txt)$/.test(entry.name) ? [path.join(root, relative)] : [];
  });
}

describe("package identity", () => {
  it("matches the published manifest and its preview export", () => {
    expect(VELORA_PACKAGE.name).toBe(manifest.name);
    expect(VELORA_PACKAGE.preview).toBe(`${manifest.name}/preview`);
    expect(Object.keys(manifest.exports)).toContain("./preview");
    expect(VELORA_PACKAGE.legacyNames).not.toContain(manifest.name);
  });
  it("generates adapters that import the published preview entry", () => {
    for (const entry of ["src/main.tsx", "src/main.jsx"])
      expect(generatedPreview(entry).text).toContain(`import { ProjectPreview } from "${VELORA_PACKAGE.preview}";`);
    const project = { version: 1 as const, projectId: "36c238cf-44e8-43be-b72a-e5196b075598", entry: "app/velora/page.jsx", packageManager: "npm" as const, adapter: "next-app" as const };
    expect(portableIntegration(project, "")["src/velora/ProjectPreview.jsx"]).toContain(`import { ProjectPreview } from "${VELORA_PACKAGE.preview}";`);
  });
  it("teaches the published package in the installed guide", () => {
    const guide = getAuthoringGuide();
    const example = guide.capabilities.example as { componentSource: string };
    expect(example.componentSource).toContain(`from '${VELORA_PACKAGE.name}'`);
    expect(guide.capabilities.package).toEqual({ name: VELORA_PACKAGE.name, preview: VELORA_PACKAGE.preview });
    expect(JSON.stringify(guide)).not.toMatch(bareImport);
    expect(JSON.stringify(guide)).not.toMatch(/\bfrom velora\/preview\b/);
  });
  it.each([
    "README.md", "USER_GUIDE.md", "docs", "skills/velora", "skills/velora-scenes",
    "local-project/src", "tests/examples", "tests/agent/demo-a/host/src", "tests/agent/demo-b/host/src", "tests/agent/scene.tsx.txt",
  ])("keeps %s on the published import and install command", target => {
    const offenders = textFiles(target)
      .filter(file => bareImport.test(readFileSync(file, "utf8")))
      .map(file => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});
