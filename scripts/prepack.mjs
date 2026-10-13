import {spawnSync} from 'node:child_process';
import {NPM, NPM_SHELL} from './npm-cmd.mjs';
// npm pack --json owns stdout; build diagnostics must not corrupt its manifest.
const result=spawnSync(NPM,['run','build'],{stdio:['inherit',2,2],...NPM_SHELL});
process.exitCode=result.status??1;
