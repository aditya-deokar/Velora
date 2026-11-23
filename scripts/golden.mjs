import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** v2.1 goldens (tests/core/fixtures/v21-golden): byte-level records of today's motion, spatial,
 * optics, shot, formatting-corpus and capture behavior.
 *
 *   node scripts/golden.mjs            compare only (never writes; fails on any drift)
 *   node scripts/golden.mjs --update   regenerate deliberately, then review and commit the diff
 *   node scripts/golden.mjs --update --capture   also re-record browser frame SHAs (needs npm run build:test)
 *
 * Anything else is refused, so an accidental diff can only fail CI, never rewrite the record.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const unknown = args.filter(arg => !['--update', '--capture'].includes(arg));
if (unknown.length) {
  console.error(`Unknown argument ${unknown.join(' ')}. Use --update to regenerate goldens deliberately.`);
  process.exit(2);
}
const update = args.includes('--update');
const run = (command, commandArgs, env = {}) => {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  return result.status ?? 1;
};
const env = update ? { VELORA_GOLDEN: 'update' } : { VELORA_GOLDEN: 'compare' };
const files = ['tests/core/motion.test.ts', 'tests/core/spatial-golden.test.ts'];
let status = run('npx', ['vitest', 'run', ...files.map(file => path.normalize(file)), '-t', 'v2.1'], env);
if (status === 0 && args.includes('--capture')) status = run('npx', ['playwright', 'test', 'tests/browser/capture-golden.spec.ts'], env);
if (status === 0) console.log(update ? 'Goldens regenerated. Review the diff before committing.' : 'Goldens match.');
process.exit(status);
