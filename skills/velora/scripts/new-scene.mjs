#!/usr/bin/env node
// Scaffold a minimal Velora scene pair: <id>.scene.json plus <id>.tsx.
// Usage: node new-scene.mjs --id <slug> --out <dir> [--title <title>] [--width <n>] [--height <n>]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function help() {
  return `new-scene.mjs — scaffold a Velora scene pair.\n\nUsage:\n  node new-scene.mjs --id <slug> --out <dir> [--title <title>] [--width 1280] [--height 720]\n\nWrites <id>.scene.json plus <id>.tsx into --out. The recipe validates with velora validate --json.\n`;
}
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(help());
  process.exit(0);
}
function value(flag) {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}
const id = value('--id');
const out = value('--out');
const title = value('--title') ?? id ?? 'Untitled';
const width = Number(value('--width') ?? 1280);
const height = Number(value('--height') ?? 720);
if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
  process.stderr.write('Pass --id as a lowercase slug (for example --id hero-survey).\n');
  process.exit(2);
}
if (!out) {
  process.stderr.write('Pass --out as the scenes directory (for example --out src/velora/scenes).\n');
  process.exit(2);
}
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64) {
  process.stderr.write('Width and height must be integers >= 64.\n');
  process.exit(2);
}
const recipe = {
  version: 1,
  id,
  title,
  definition: {
    width,
    height,
    scene: {
      camera: { perspective: 1400 },
      focus: { distance: 1400, fStop: 8, focalLength: 50, maxBlur: 6 },
      nodes: [{ id: 'main' }],
    },
    motion: { durationMs: 2000, tracks: [] },
  },
};
const component = `import { Surface } from 'velora';\n\nexport default function ${id.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('')}() {\n  return (\n    <Surface id="main" style={{ width: ${width}, height: ${height} }}>\n      <div style={{ color: '#fff', background: '#111', width: '100%', height: '100%' }}>${title}</div>\n    </Surface>\n  );\n}\n`;
await mkdir(out, { recursive: true });
await writeFile(path.join(out, `${id}.scene.json`), JSON.stringify(recipe, null, 2) + '\n');
await writeFile(path.join(out, `${id}.tsx`), component);
process.stdout.write(`Wrote ${id}.scene.json and ${id}.tsx to ${out}\n`);
