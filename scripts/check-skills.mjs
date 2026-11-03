import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skillsDir = path.join(root, 'skills');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const cliVersion = pkg.version;

const VELORA_SKILLS = [
  'velora', 'velora-init', 'velora-composition', 'velora-scenes', 'velora-render',
  'velora-gsap', 'velora-threejs', 'velora-ewmotion', 'velora-typography',
  'velora-transitions', 'velora-audio', 'velora-export', 'velora-debug',
  'velora-performance', 'velora-verify', 'velora-templates', 'velora-cinematography',
  'velora-brand', 'velora-looks', 'velora-motion-design', 'velora-editing', 'velora-launch',
];
const REQUIRED_SECTIONS = [
  '## When to Use This Skill',
  '## Commands',
  '## Prerequisites',
  '## Workflow',
  '## Worked Example',
  '## Anti-Patterns',
  '## Troubleshooting',
  '## Validation',
  '## Related Skills',
  '## When NOT to Use This Skill',
];

// Parse CLI_COMMANDS from src/core/cli-schema.ts without a TS build.
const cliSchema = await readFile(path.join(root, 'src/core/cli-schema.ts'), 'utf8');
const commandFlags = new Map();
for (const m of cliSchema.matchAll(/\{\s*name:\s*"([^"]+)"[^}]*?flags:\s*\[([^\]]*)\]/g)) {
  const name = m[1];
  const flags = [...m[2].matchAll(/"(--[a-z-]+)"/g)].map((f) => f[1]);
  commandFlags.set(name, new Set(flags));
}

function parseFrontmatter(text, file) {
  const issues = [];
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return { issues: [`${file}:1 missing opening ---`] };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end < 0) return { issues: [`${file} front-matter never closes`] };
  const fm = {};
  let current = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (/^\s*-\s+/.test(line) && current) {
      const list = fm[current];
      if (Array.isArray(list)) list.push(line.replace(/^\s*-\s+/, '').trim());
      else issues.push(`${file}:${i + 1} list item without list key`);
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      if (line.trim() !== '') issues.push(`${file}:${i + 1} unparseable front-matter line`);
      current = null;
      continue;
    }
    current = match[1];
    const value = match[2].trim();
    if (value === '') fm[current] = [];
    else if (value.startsWith('[') && value.endsWith(']')) fm[current] = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else fm[current] = value.replace(/^"(.*)"$/, '$1');
  }
  return { frontmatter: fm, body: lines.slice(end + 1).join('\n'), issues };
}

const failures = [];
function fail(msg) { failures.push(msg); }

// 1. Every expected skill exists with valid front-matter and sections.
for (const name of VELORA_SKILLS) {
  const file = path.join(skillsDir, name, 'SKILL.md');
  let text;
  try {
    // Windows checkouts (core.autocrlf) carry CRLF; parse line-ending agnostic.
    text = (await readFile(file, 'utf8')).replace(/\r\n?/g, '\n');
  } catch {
    fail(`Missing ${name}/SKILL.md`);
    continue;
  }
  const { frontmatter, body, issues } = parseFrontmatter(text, `${name}/SKILL.md`);
  for (const issue of issues ?? []) fail(issue);
  if (!frontmatter) continue;
  for (const field of ['name', 'description', 'license', 'version', 'when-to-use', 'commands', 'related-skills', 'not-for']) {
    if (frontmatter[field] === undefined || frontmatter[field] === '') fail(`${name}/SKILL.md missing front-matter ${field}`);
  }
  if (frontmatter.name !== undefined && frontmatter.name !== name) fail(`${name}/SKILL.md front-matter name is ${frontmatter.name}`);
  if (typeof frontmatter.description === 'string' && frontmatter.description.length < 10) fail(`${name}/SKILL.md description too short`);
  if (typeof frontmatter.version === 'string' && !/^\d+\.\d+\.\d+$/.test(frontmatter.version)) fail(`${name}/SKILL.md version must be X.Y.Z`);
  if (typeof frontmatter.version === 'string' && frontmatter.version !== cliVersion) fail(`${name}/SKILL.md version ${frontmatter.version} differs from package ${cliVersion}`);
  if (!Array.isArray(frontmatter.commands) || !frontmatter.commands.length) fail(`${name}/SKILL.md commands must be a non-empty list`);
  for (const cmd of frontmatter.commands ?? []) {
    if (!commandFlags.has(cmd)) fail(`${name}/SKILL.md front-matter commands unknown command "${cmd}"`);
  }
  // prerequisites may be empty list; related-skills must be known.
  for (const skill of frontmatter['related-skills'] ?? []) {
    if (!VELORA_SKILLS.includes(skill)) fail(`${name}/SKILL.md unknown related skill "${skill}"`);
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!body.split('\n').some((line) => line.trim() === section)) fail(`${name}/SKILL.md missing section "${section}"`);
  }
  // 2. Command refs: every `velora <command>` names a real command, and every
  // --flag in its segment (until the next velora mention or end of line)
  // belongs to that command. Top-level `velora --help` is skipped.
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mentions = [...line.matchAll(/(?:npx\s+)?velora\s+(-{0,2}[a-z-]+)/g)];
    for (let k = 0; k < mentions.length; k++) {
      const cmd = mentions[k][1];
      if (cmd.startsWith('-')) continue;
      if (!commandFlags.has(cmd)) {
        fail(`${name}/SKILL.md:${i + 1} unknown command "velora ${cmd}"`);
        continue;
      }
      const start = mentions[k].index + mentions[k][0].length;
      const end = k + 1 < mentions.length ? mentions[k + 1].index : line.length;
      const segment = line.slice(start, end);
      const allowed = commandFlags.get(cmd);
      for (const f of segment.matchAll(/(--[a-z-]+)/g)) {
        if (!allowed.has(f[1])) fail(`${name}/SKILL.md:${i + 1} "velora ${cmd} ${f[1]}" unknown flag (see velora ${cmd} --help)`);
      }
    }
  }
  // 3. No copied GSAP/Three.js bodies: link, don't duplicate.
  if (/gsap\.to\s*\(/.test(body) && name !== 'velora-gsap') fail(`${name}/SKILL.md copies GSAP API; link to gsap-* skills instead`);
}

// 4. Root line budget.
{
  const rootText = (await readFile(path.join(skillsDir, 'velora/SKILL.md'), 'utf8')).replace(/\r\n?/g, '\n');
  const lines = rootText.split('\n').length;
  if (lines >= 500) fail(`velora/SKILL.md has ${lines} lines; budget is <500`);
  for (const must of ['routing', 'progressive', 'doctor', 'inspect', 'validate', 'render', 'frames', 'check']) {
    if (!rootText.toLowerCase().includes(must)) fail(`velora/SKILL.md should mention "${must}"`);
  }
}

// 5. skills-lock.json covers every velora skill with matching version.
{
  const lock = JSON.parse(await readFile(path.join(root, 'skills-lock.json'), 'utf8'));
  for (const name of VELORA_SKILLS) {
    const entry = lock.skills?.[name];
    if (!entry) { fail(`skills-lock.json missing ${name}`); continue; }
    if (entry.version !== cliVersion) fail(`skills-lock.json ${name} version ${entry.version} differs from ${cliVersion}`);
    if (!entry.skillPath || !entry.computedHash) fail(`skills-lock.json ${name} needs skillPath and computedHash`);
  }
}

// 6. Templates: every template dir has a README plus at least one JSON that parses.
{
  const templates = path.join(skillsDir, 'velora/templates');
  const entries = await readdir(templates);
  const expected = ['scene-minimal', 'composition-three-act', 'kinetic-title', 'product-survey', 'audio-captioned', 'webgl-stage'];
  for (const name of expected) {
    if (!entries.includes(name)) { fail(`templates missing ${name}`); continue; }
    const dir = path.join(templates, name);
    const files = await readdir(dir);
    if (!files.some((f) => f.toLowerCase() === 'readme.md')) fail(`templates/${name} missing README.md`);
    const jsons = files.filter((f) => f.endsWith('.json'));
    if (!jsons.length) fail(`templates/${name} has no JSON example`);
    for (const json of jsons) {
      try {
        JSON.parse(await readFile(path.join(dir, json), 'utf8'));
      } catch (error) {
        fail(`templates/${name}/${json} invalid JSON: ${error.message}`);
      }
    }
  }
}

// 7. Scripts exist and support --help.
{
  for (const script of ['new-scene.mjs', 'check-frames.mjs', 'compare-renders.mjs']) {
    const file = path.join(skillsDir, 'velora/scripts', script);
    try {
      await stat(file);
    } catch {
      fail(`scripts missing ${script}`);
      continue;
    }
    const text = await readFile(file, 'utf8');
    if (!text.includes('--help')) fail(`scripts/${script} must support --help`);
  }
}

// 8. REFERENCE.md and COMPATIBILITY.md exist.
for (const doc of ['REFERENCE.md', 'COMPATIBILITY.md']) {
  try {
    await stat(path.join(skillsDir, 'velora', doc));
  } catch {
    fail(`skills/velora/${doc} missing`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`check-skills: ${f}`);
  console.error(`check-skills: ${failures.length} issue(s)`);
  process.exit(1);
}
console.log(`check-skills: ${VELORA_SKILLS.length} skills, templates, scripts, and lock all green (CLI ${cliVersion}).`);
