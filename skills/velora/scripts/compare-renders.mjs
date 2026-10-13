#!/usr/bin/env node
// Compare two render manifests by frame SHA.
// Usage: node compare-renders.mjs --a <manifest-a> --b <manifest-b>
import { readFile } from 'node:fs/promises';

function help() {
  return `compare-renders.mjs — hash-diff two manifests (serial versus parallel).\n\nUsage:\n  node compare-renders.mjs --a <manifest-a> --b <manifest-b>\n\nCompares per-frame SHAs in order. Exit 0 when identical, 1 on any mismatch. Equality is judged on frame SHAs, never container bytes.\n`;
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
const aPath = value('--a');
const bPath = value('--b');
if (!aPath || !bPath) {
  process.stderr.write('Pass --a <manifest-a> and --b <manifest-b>.\n');
  process.exit(2);
}
try {
  const a = JSON.parse(await readFile(aPath, 'utf8'));
  const b = JSON.parse(await readFile(bPath, 'utf8'));
  const aFrames = Array.isArray(a.frames) ? a.frames : [];
  const bFrames = Array.isArray(b.frames) ? b.frames : [];
  if (aFrames.length !== bFrames.length) {
    process.stderr.write(`Frame count differs: ${aFrames.length} versus ${bFrames.length}.\n`);
    process.exit(1);
  }
  const mismatches = [];
  for (let i = 0; i < aFrames.length; i++) {
    if (aFrames[i].sha !== bFrames[i].sha || aFrames[i].frame !== bFrames[i].frame || aFrames[i].timeMs !== bFrames[i].timeMs) {
      mismatches.push(`frame ${i}: ${aFrames[i].sha} versus ${bFrames[i].sha}`);
    }
  }
  if (mismatches.length) {
    for (const m of mismatches.slice(0, 20)) process.stderr.write(`${m}\n`);
    process.stderr.write(`${mismatches.length} frame(s) differ.\n`);
    process.exit(1);
  }
  process.stdout.write(`Renders identical: ${aFrames.length} frames share SHAs.\n`);
} catch (error) {
  process.stderr.write(`compare-renders failed: ${error.message}\n`);
  process.exit(1);
}
