import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SceneRecipeSchema } from "../../src/core/recipes";
import { CompositionSchema } from "../../src/core/composition";

// Copy-pasted documentation is executable input: every JSON block shaped like a scene
// recipe or composition must parse against the canonical schema. Leading `// path`
// comment lines name the file and are stripped before parsing.
function jsonBlocks(file: string) {
  const text = readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  return [...text.matchAll(/^([ \t]*)```json\n([\s\S]*?)\n\1```/gm)].map((match, index) => {
    const body = match[2].split("\n").map(line => line.slice(match[1].length)).filter(line => !/^\s*\/\//.test(line)).join("\n");
    return { label: `${file} json block ${index + 1}`, value: JSON.parse(body) as Record<string, unknown> };
  });
}
const blocks = ["README.md", "USER_GUIDE.md"].flatMap(jsonBlocks);

describe("documentation examples", () => {
  it("documents at least one recipe and one composition", () => {
    expect(blocks.some(block => "definition" in block.value)).toBe(true);
    expect(blocks.some(block => "scenes" in block.value)).toBe(true);
  });
  it.each(blocks)("$label validates against its schema", ({ value }) => {
    const schema = "definition" in value ? SceneRecipeSchema : "scenes" in value ? CompositionSchema : undefined;
    if (!schema) return;
    const parsed = schema.safeParse(value);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
