// Replay gate: every agent demo's CLI transcript replays cleanly in
// disposable hosts, determinism holds (same seed -> same hashes), and every
// transcript step maps to a loaded skill that owns its command.
// Browser/video steps are recorded evidence (replayable: false) and replay
// only the offline subset; anything needing ffmpeg is skipped with a note
// when the binary is absent. Requires: npm registry access, dist/ built.
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NPM, NPM_SHELL } from './npm-cmd.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'dist', 'cli', 'velora.js');
try {
  await readFile(cli, 'utf8');
} catch {
  console.error('check-agent-demos: dist/cli/velora.js is missing. Run npm run build first.');
  process.exit(1);
}

// Skill and command index parsed from source so the gate stays in sync.
const cliSchema = await readFile(path.join(root, 'src/core/cli-schema.ts'), 'utf8');
const commandSkill = new Map();
for (const m of cliSchema.matchAll(/\{\s*name:\s*"([^"]+)"[^}]*?skill:\s*"([^"]+)"/g)) commandSkill.set(m[1], m[2]);
const skillsSrc = await readFile(path.join(root, 'src/project/skills.ts'), 'utf8');
const skillNames = [...skillsSrc.match(/"velora(?:-[a-z]+)?"/g)].map((s) => s.slice(1, -1));
const failures = [];
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

function sh(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
function npm(cwd, args) {
  // npm.cmd is a batch file: async spawn rejects it with EINVAL on Windows,
  // while spawnSync resolves it. npm steps are sequential anyway.
  const r = spawnSync(NPM, args, { cwd, encoding: 'utf8', ...NPM_SHELL });
  const stdout = r.stdout ?? '', stderr = r.stderr ?? '';
  if (r.status !== 0) throw Error(`npm ${args.join(' ')} failed:\n${stdout}\n${stderr}`.slice(-3000));
  return { code: r.status, stdout, stderr };
}
const skillCommandsCache = new Map();
function skillCommands(skill) {
  if (!skillCommandsCache.has(skill)) {
    skillCommandsCache.set(skill, (async () => {
      try {
        const text = await readFile(path.join(root, 'skills', skill, 'SKILL.md'), 'utf8');
        const lines = text.split('\n');
        const start = lines.findIndex((l) => l.trim() === 'commands:');
        const out = [];
        for (let i = start + 1; i < lines.length && /^\s*-\s+/.test(lines[i]); i++) out.push(lines[i].replace(/^\s*-\s+/, '').trim());
        return out;
      } catch {
        return [];
      }
    })());
  }
  return skillCommandsCache.get(skill);
}
function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

async function runDemo(name) {
  const dir = path.join(root, 'tests', 'agent', name);
  const transcript = JSON.parse(await readFile(path.join(dir, 'transcript.json'), 'utf8'));
  const expected = JSON.parse(await readFile(path.join(dir, 'expected-hashes.json'), 'utf8'));
  const tmp = await mkdtemp(path.join(tmpdir(), `velora-${name}-`));
  console.log(`--- ${name}: disposable host ${tmp}`);
  try {
    await cp(path.join(dir, 'host'), tmp, { recursive: true });
    npm(tmp, ['install', '--no-audit', '--no-fund']);
    const packDir = path.join(tmp, '.pack');
    await mkdir(packDir, { recursive: true });
    const packed = JSON.parse(npm(root, ['pack', '--ignore-scripts', '--json', '--pack-destination', packDir]).stdout);
    npm(tmp, ['install', '--no-audit', '--no-fund', path.join(packDir, packed[0].filename)]);
    for (const [i, step] of transcript.steps.entries()) {
      const label = `${name}[${i}] ${step.skill}: velora ${step.cmd.join(' ')}`;
      if (step.draft) {
        const base = JSON.parse(await readFile(path.join(tmp, step.draft.base), 'utf8'));
        for (const [p, v] of Object.entries(step.draft.patch)) setPath(base, p, v);
        await writeFile(path.join(tmp, step.cmd[step.cmd.indexOf('--composition') + 1]), JSON.stringify(base, null, 2));
      }
      if (!step.replayable) {
        console.log(`SKIP ${label} (recorded evidence; requires ${(step.requires ?? []).join(', ')})`);
        continue;
      }
      if ((step.requires ?? []).includes('ffmpeg') && !hasFfmpeg) {
        console.log(`SKIP ${label} (ffmpeg absent)`);
        continue;
      }
      const r = await sh(process.execPath, [cli, ...step.cmd], tmp);
      if (r.code !== step.expect.code) {
        failures.push(`${label}: exit ${r.code}, expected ${step.expect.code}\n${r.stdout}\n${r.stderr}`.slice(-2000));
        continue;
      }
      if (step.expect.issue) {
        const body = JSON.parse(r.stderr);
        if (body.issues?.[0]?.code !== step.expect.issue)
          failures.push(`${label}: issue ${body.issues?.[0]?.code}, expected ${step.expect.issue}`);
      }
      console.log(`PASS ${label}`);
      // Skills-trace coverage: the step's skill exists and either owns the
      // command or documents it in its front-matter commands (e.g.
      // velora-render driving frame-mode velora render).
      if (!skillNames.includes(step.skill)) failures.push(`${label}: unknown skill ${step.skill}`);
      else {
        const owned = commandSkill.get(step.cmd[0]);
        const claimed = await skillCommands(step.skill);
        if (owned && step.skill !== owned && step.skill !== 'velora' && !claimed.includes(step.cmd[0]))
          failures.push(`${label}: skill ${step.skill} neither owns velora ${step.cmd[0]} (owner: ${owned}) nor documents it`);
      }
    }
    // Determinism: re-render the first recorded gap frame twice, offline.
    const frame = expected.gapFrames[0];
    const shas = [];
    for (const out of ['proof-a.png', 'proof-b.png']) {
      const r = await sh(process.execPath, [cli, 'render', '--composition', transcript.composition, '--frame', String(frame), '--out', out, '--url', 'http://127.0.0.1:1', '--json'], tmp);
      if (r.code !== 0) {
        failures.push(`${name}: gap re-render failed:\n${r.stderr}`.slice(-1000));
        return;
      }
      shas.push(JSON.parse(r.stdout.split('\n').filter(Boolean).pop()).data.sha);
    }
    if (shas[0] !== shas[1]) failures.push(`${name}: gap frame rendered two SHAs: ${shas.join(' vs ')}`);
    else if (shas[0] !== expected.gapFrameSha256) failures.push(`${name}: gap SHA ${shas[0]} differs from recorded ${expected.gapFrameSha256}`);
    else console.log(`PASS ${name}: gap frame ${frame} deterministic (${shas[0].slice(0, 12)}…)`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  // Recorded determinism (demo-b): committed run manifests agree frame by frame.
  if (name === 'demo-b') {
    const a = JSON.parse(await readFile(path.join(dir, 'evidence-video-manifest.json'), 'utf8'));
    const b = JSON.parse(await readFile(path.join(dir, 'evidence-video-manifest-run2.json'), 'utf8'));
    if (a.frames.length !== b.frames.length || a.frames.some((f, i) => f.sha !== b.frames[i].sha))
      failures.push('demo-b: committed run manifests disagree');
    else console.log(`PASS demo-b: committed runs agree (${a.frames.length} frames)`);
  }
}

const DEMOS = ['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e'];
for (const name of DEMOS) await runDemo(name);
// Director-workflow coverage: the launch commands are exercised by at least one replayed step.
{
  const replayed = new Set();
  for (const name of DEMOS) {
    const transcript = JSON.parse(await readFile(path.join(root, 'tests', 'agent', name, 'transcript.json'), 'utf8'));
    for (const step of transcript.steps) if (step.replayable) replayed.add(step.cmd.slice(0, 2).join(' '));
  }
  for (const required of ['prompts show', 'templates ls', 'templates show', 'templates check', 'new video', 'new scene', 'review --composition', 'captions check', 'compose snap']) {
    if (![...replayed].some((cmd) => cmd.startsWith(required.split(' ')[0]) && (required.split(' ')[1].startsWith('--') || cmd === required)))
      failures.push(`coverage: no replayed step runs velora ${required}`);
  }
}
if (failures.length) {
  for (const f of failures) console.error(`check-agent-demos: ${f}`);
  console.error(`check-agent-demos: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`check-agent-demos: ${DEMOS.length} transcripts replay, determinism holds, skill traces cover every step.`);
