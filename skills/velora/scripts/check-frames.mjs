#!/usr/bin/env node
// Verify a frames directory against its manifest.json.
// Usage: node check-frames.mjs --dir <frames-dir> [--manifest <path>]
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

function help() {
  return `check-frames.mjs — verify manifest versus PNGs.\n\nUsage:\n  node check-frames.mjs --dir <frames-dir> [--manifest <path>]\n\nChecks manifest.json exists and parses, every manifest frame file exists and is non-empty, and no extra PNGs are unlisted. Exit 0 when consistent, 1 otherwise.\n`;
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
const dir = value('--dir');
const manifestPath = value('--manifest') ?? (dir ? path.join(dir, 'manifest.json') : undefined);
if (!dir || !manifestPath) {
  process.stderr.write('Pass --dir <frames-dir> (optional --manifest <path>).\n');
  process.exit(2);
}
try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const frames = Array.isArray(manifest.frames) ? manifest.frames : [];
  const entries = await readdir(dir);
  const pngs = entries.filter((e) => e.toLowerCase().endsWith('.png')).sort();
  const issues = [];
  for (const frame of frames) {
    const file = frame.file ?? `frame-${String(frame.frame + 1).padStart(5, '0')}.png`;
    const full = path.join(dir, path.basename(file));
    try {
      const st = await stat(full);
      if (!st.isFile() || st.size === 0) issues.push(`Empty or missing frame file ${file}.`);
    } catch {
      issues.push(`Manifest lists ${file} but it is not on disk.`);
    }
  }
  const listed = new Set(frames.map((f) => path.basename(f.file ?? `frame-${String(f.frame + 1).padStart(5, '0')}.png`)));
  for (const png of pngs) {
    if (!listed.has(png)) issues.push(`Extra PNG ${png} is not listed in the manifest.`);
  }
  if (!frames.length) issues.push('Manifest lists zero frames.');
  if (issues.length) {
    for (const issue of issues) process.stderr.write(`${issue}\n`);
    process.exit(1);
  }
  process.stdout.write(`Frames OK: ${frames.length} frames in ${dir} match ${manifestPath}\n`);
} catch (error) {
  process.stderr.write(`check-frames failed: ${error.message}\n`);
  process.exit(1);
}
