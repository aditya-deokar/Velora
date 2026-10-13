// Shared npm spawn target. Windows refuses to spawn `npm.cmd` without a
// shell (EINVAL), so shell:true is required there; it equals `npm` with no
// extra options everywhere else. Spawn args are constructed internally by
// each script, never from user input. Import {NPM} (or npmCmd for
// pass-through helpers) in any script that spawns npm so gates stay green
// on every platform.
export const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
export function npmCmd(command) {
  return command === 'npm' ? NPM : command;
}
export const NPM_SHELL = process.platform === 'win32' ? { shell: true } : {};
