import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, readdir, writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { npmCmd, NPM_SHELL } from './npm-cmd.mjs';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { chromium } from 'playwright';

// Installed consumer evidence: use the packed artifact and an independent host app,
// never aliases back into src/ or the demo. All writes stay inside a disposable fixture.
const root = fileURLToPath(new URL('../', import.meta.url));
// The installed directory and import specifier follow the name this package publishes.
const packageName = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).name;
const scratch = await mkdtemp(path.join(tmpdir(), 'velora-installed-'));
const host = path.join(scratch, 'host');
const registryPackage = process.env.VELORA_REGISTRY_PACKAGE;
const commandEnv = registryPackage ? {...process.env, npm_config_cache:path.join(scratch,'npm-cache'), npm_config_registry:'https://registry.npmjs.org/'} : process.env;
const processes = [];
let browser;
let unrelated;
function run(command,args,cwd=host) {
  return new Promise((resolve,reject)=>{
    const exe=npmCmd(command);const child=spawn(exe,args,{cwd,env:commandEnv,stdio:['ignore','pipe','pipe'],...(exe!==command?NPM_SHELL:{})});
    let stdout='',stderr='';
    child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
    const timer=setTimeout(()=>child.kill('SIGTERM'),120000);
    child.on('error',e=>{clearTimeout(timer);reject(e)});
    child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr})});
  });
}
async function ok(command,args,cwd) {const r=await run(command,args,cwd);assert.equal(r.code,0,`${command} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);return r.stdout;}
async function port() {const s=createServer();await new Promise((r,j)=>s.listen(0,'127.0.0.1',r).once('error',j));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
// Keep the tail of a spawned server's output so a failed start explains itself.
function logged(child) {let out='';const keep=d=>{out=(out+d).slice(-6000)};child.stdout?.on('data',keep);child.stderr?.on('data',keep);child.log=()=>out;return child;}
async function waitFor(url,child) {
  // A time budget, not an attempt count: refused connections return instantly, and a cold Vite start on a
  // Windows CI runner (antivirus scanning node_modules) takes far longer than 120 quick retries.
  const deadline=Date.now()+90_000;
  let last='no response';
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw Error(`Fixture dev server exited (${child.exitCode}) for ${url}:\n${child.log?.() ?? ''}`);
    try {const r=await fetch(url,{signal:AbortSignal.timeout(2000)});if(r.ok)return;last=`HTTP ${r.status}`;}catch(error){last=String(error?.cause?.code ?? error?.message ?? error);}
    await new Promise(r=>setTimeout(r,250));
  }
  throw Error(`Fixture server did not answer ${url} within 90 s (last: ${last}). Server output:\n${child.log?.() ?? ''}`);
}
try {
  await cp(path.join(root,'tests/fixtures/project-host'),host,{recursive:true});
  await writeFile(path.join(host,'.env'),'FIXTURE_SENTINEL=keep-me\n');
  const originalEntry=await readFile(path.join(host,'src/main.tsx'),'utf8');
  const originalConfig=await readFile(path.join(host,'vite.config.mjs'),'utf8');
  const originalApp=await readFile(path.join(host,'src/App.tsx'),'utf8');
  const originalPackage=JSON.parse(await readFile(path.join(host,'package.json'),'utf8'));
  if (!registryPackage) {
    // Leave the published-release check on its original host. The current artifact
    // must also open the real studio from a React 18 installation with no Three peers.
    originalPackage.dependencies.react = originalPackage.dependencies['react-dom'] = '18.3.1';
    await writeFile(path.join(host,'package.json'),JSON.stringify(originalPackage,null,2)+'\n');
  }
  let tarball;
  if(!registryPackage) {
  const rawPack = await ok('npm',['pack','--json',...(process.env.VELORA_VERIFY_PREBUILT==='1'?['--ignore-scripts']:[]),'--pack-destination',scratch],root);
  const packed=JSON.parse(rawPack.match(/\[\s*\{[\s\S]*\}\s*\]/)[0]);
  tarball=path.join(scratch,packed[0].filename);
  assert.ok(packed[0].files.some(f=>f.path==='dist/cli/velora.js'));
  assert.ok(packed[0].files.some(f=>f.path==='LICENSE'));
  assert.ok(packed[0].files.some(f=>f.path==='README.md'));
  assert.ok(!packed[0].files.some(f=>/^(local-project|tests|app|docs)\//.test(f.path)));
  const metadata=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  assert.equal(metadata.license,'MIT');
  assert.notEqual(metadata.private,true);
  assert.ok(packed[0].files.some(f=>f.path==='dist/library/preview.js'));
  assert.ok(!packed[0].files.some(f=>f.path.includes('.env')));
  }
  await ok('npm',['install','--ignore-scripts','--no-audit','--no-fund']);
  const chosen=await port();const origin=`http://127.0.0.1:${chosen}`;
  const server=logged(spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(chosen),'--strictPort'],{cwd:host,stdio:['ignore','pipe','pipe']}));processes.push(server);
  await waitFor(origin,server);
  const parentCli=path.join(root,'dist/cli/velora.js');
  if(registryPackage || process.env.VELORA_VERIFY_AGENT==='1') await ok('npm',['install','--ignore-scripts','--no-audit','--no-fund',registryPackage ?? tarball]);
  if(registryPackage) {
    const installed=JSON.parse(await readFile(path.join(host,'node_modules',packageName,'package.json'),'utf8'));
    assert.equal(installed.name+'@'+installed.version,registryPackage,'Install exact published version');
  }
  const initResult=registryPackage || process.env.VELORA_VERIFY_AGENT==='1'
    ? await run('npm',['exec','--offline','--','velora','init','--url',origin,'--no-open','--json'])
    : await run(process.execPath,[parentCli,'init','--project',host,'--package',tarball,'--url',origin,'--no-open','--json']);
  if(initResult.code!==0) {
    await mkdir(path.join(root,'test-results'),{recursive:true});
    await writeFile(path.join(root,'test-results/install-debug.txt'),
      initResult.stderr+'\nHTML:\n'+await (await fetch(origin)).text()+'\nENTRY:\n'+await (await fetch(origin+'/src/main.tsx')).text());
  }
  assert.equal(initResult.code,0,initResult.stderr);
  const initialized=JSON.parse(initResult.stdout);
  assert.equal(initialized.success,true);
  assert.equal(initialized.data.handoff.path,'VELORA.md');
  assert.equal(initialized.data.handoff.guideCommand,'npx velora guide --json');
  assert.equal(new URL(initialized.data.url).port,String(chosen));
  const entryAfter=await readFile(path.join(host,'src/main.tsx'),'utf8');
  assert.ok(entryAfter.includes('<DashboardProvider><App /></DashboardProvider>'));
  assert.ok(entryAfter.includes('Existing provider composition'));
  assert.notEqual(entryAfter,originalEntry);
  const installedPkg = packageName;
  assert.ok(existsSync(path.join(host,'node_modules',installedPkg,'package.json')),'Setup installs the published package name');
  if (!registryPackage) {
    assert.equal(JSON.parse(await readFile(path.join(host,'node_modules/react/package.json'),'utf8')).version,'18.3.1');
    assert.ok(!existsSync(path.join(host,'node_modules/three')) && !existsSync(path.join(host,'node_modules/@react-three/fiber')));
  }
  const cli=path.join(host,'node_modules',installedPkg,'dist/cli/velora.js');
  const installedGuide=JSON.parse(await ok(process.execPath,[cli,'guide','--json']));
  const publicGuide=JSON.parse(await ok(process.execPath,['--input-type=module','-e',`import {getAuthoringGuide} from '${installedPkg}'; console.log(JSON.stringify(getAuthoringGuide()))`]));
  const {cliVersion: _installedCliVersion, command: _installedCommand, ...installedCanonical}=installedGuide;
  const {cliVersion: _publicCliVersion, ...publicCanonical}=publicGuide;
  assert.deepEqual(installedCanonical,publicCanonical,'Installed CLI and browser-compatible package share the exact guide');
  assert.equal(installedGuide.version,3);
  assert.ok(installedGuide.concepts.some(c=>c.id==='focus'));
  assert.ok(installedGuide.concepts.some(c=>c.id==='editing-rhythm'),'Guide v3 ships the director concepts');
  assert.ok(installedGuide.capabilities.prompts.ids.includes('launch-film'),'Guide v3 points at the prompt library');
  assert.ok(Array.isArray(installedGuide.commands) && installedGuide.commands.some(c=>c.name==='doctor'));
  assert.equal(installedGuide.command,'guide');
  assert.equal(typeof installedGuide.cliVersion,'string');
  assert.ok((await ok(process.execPath,[cli,'--help'])).includes('velora guide'));
  const guideFailure=await run(process.execPath,[cli,'guide','--unknown']);assert.notEqual(guideFailure.code,0);

  await ok(process.execPath,[cli,'init','--project',host,'--json']);
  assert.equal(await readFile(path.join(host,'src/main.tsx'),'utf8'),entryAfter);
  await ok(process.execPath,[cli,'validate','--project',host,'--json']);
  assert.equal(await readFile(path.join(host,'vite.config.mjs'),'utf8'),originalConfig);
  assert.equal(await readFile(path.join(host,'src/App.tsx'),'utf8'),originalApp);
  assert.equal(await readFile(path.join(host,'.env'),'utf8'),'FIXTURE_SENTINEL=keep-me\n');
  const installedPackage=JSON.parse(await readFile(path.join(host,'package.json'),'utf8'));
  assert.deepEqual(installedPackage.scripts,originalPackage.scripts);
  assert.deepEqual(installedPackage.hostSetting,originalPackage.hostSetting);
  const invalid=await run(process.execPath,[cli,'open','--project',host,'--url','https://example.com','--no-open','--json']);assert.notEqual(invalid.code,0);
  const unused=await port();const missing=await run(process.execPath,[cli,'open','--project',host,'--url',`http://127.0.0.1:${unused}`,'--no-open','--json']);assert.notEqual(missing.code,0);
  unrelated=httpServer((_req,res)=>res.end('<html><body>Another app</body></html>'));
  await new Promise(r=>unrelated.listen(0,'127.0.0.1',r));
  const wrong=await run(process.execPath,[cli,'open','--project',host,'--url',`http://127.0.0.1:${unrelated.address().port}`,'--no-open','--json']);assert.notEqual(wrong.code,0);
  await mkdir(path.join(host,'src/velora/scenes'),{recursive:true});
  await writeFile(path.join(host,'src/velora/scenes/revenue.scene.json'),JSON.stringify({version:1,id:'revenue',title:'Revenue scene',definition:{scene:{nodes:[{id:'host'}]}}}));
  await writeFile(path.join(host,'src/velora/scenes/revenue.tsx'),`import {Surface} from '${installedPkg}';import {App,DashboardProvider} from '../../App';export default function RevenueScene(){return <DashboardProvider><Surface id="host" style={{width:1400,height:980}}><App/></Surface></DashboardProvider>}`);
  browser=await chromium.launch({channel:'chromium',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  let requests=0;const errors=[];
  page.on('request',r=>{if(r.url().endsWith('/api/value'))requests++});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(initialized.data.url);
  await page.getByRole('link',{name:/Revenue scene/}).click();
  await page.getByText('Revenue: 12840',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-velora-scene]').count(),1);
  assert.equal(await page.locator('[data-velora-project]').count(),1);
  await page.getByRole('button',{name:'Inspect 0',exact:true}).click();
  await page.getByRole('button',{name:'Inspect 1',exact:true}).waitFor();
  assert.equal(requests,1,'Provider should request data once in preview');
  assert.deepEqual(errors,[],'Installed consumer must not throw browser errors');
  await mkdir(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/installed-preview.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Preview must fit a mobile viewport');
  if(process.env.VELORA_VERIFY_ITERATE==='1') {
    const {verifyIteration}=await import('./verify-iteration.mjs');
    await verifyIteration({page,host,origin,server,processes,waitFor,root,originalApp});
  }
  if(process.env.VELORA_VERIFY_AGENT==='1') {
    const {verifyAgent}=await import('./verify-agent.mjs');
    await verifyAgent({page,host,origin,root,cli,ok,installedGuide});
  }
  await page.goto(origin);
  await page.getByText('Revenue: 12840',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-velora-scene]').count(),0,'Ordinary host URL stays ordinary');
  await ok('npm',['run','build']);
  const assets=path.join(host,'dist/assets');
  const productionCode=(await Promise.all((await readdir(assets)).filter(name=>name.endsWith('.js')).map(name=>readFile(path.join(assets,name),'utf8')))).join('\n');
  assert.ok(!productionCode.includes('velora-library-scroll')&&!productionCode.includes('data-velora-capture'),'Production host must not ship the unused studio renderer');
  // v2.1 S5: the Edit-mode editor is a lazy chunk the production host never ships.
  assert.ok(!/WebGLRenderer|TransformControls|react-three-fiber/.test(productionCode),'Production host must not ship optional Three.js code');
  assert.ok(!productionCode.includes('data-velora-editor-timeline')&&!productionCode.includes('velora-editor-grid'),'Production host must not ship the studio editor chunk');
  const previewPort=await port();const productionOrigin=`http://127.0.0.1:${previewPort}`;
  const production=logged(spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(previewPort),'--strictPort'],{cwd:host,stdio:['ignore','pipe','pipe']}));processes.push(production);
  await waitFor(productionOrigin,production);
  await page.goto(productionOrigin+'/?velora-preview=1');
  await page.getByRole('heading',{name:'Existing revenue dashboard'}).waitFor();
  assert.equal(await page.locator('[data-velora-scene]').count(),0,'Production build cannot enable developer preview');
  console.log((registryPackage ? 'Published '+registryPackage : 'Installed tarball')+': init/retry, source/config preservation, real provider/counter, configured port, missing/wrong server, normal route and production exclusion passed.');
} finally {
  await browser?.close();
  if(unrelated)await new Promise(r=>unrelated.close(r));
  await Promise.all(processes.map(p=>new Promise(r=>{if(p.exitCode!==null)return r();p.once('exit',r);p.kill('SIGTERM')})));
  // Windows releases a killed process's directory handles late (EBUSY); retry instead of failing a passed run.
  await rm(scratch,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
