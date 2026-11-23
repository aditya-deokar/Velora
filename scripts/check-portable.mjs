import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {npmCmd, NPM_SHELL} from './npm-cmd.mjs';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url));
const scratch=await mkdtemp(path.join(tmpdir(),'velora-frameworks-'));
const children=[];let browser;
const kind=process.argv[2]??'app';
const host=path.join(scratch,'host');
async function put(file,text){await mkdir(path.dirname(path.join(host,file)),{recursive:true});await writeFile(path.join(host,file),text)}
function run(exe, args, cwd = host) {
  return new Promise((resolve, reject) => {
    const resolved = npmCmd(exe);
    const child = spawn(resolved, args, {cwd, env: {...process.env, NEXT_TELEMETRY_DISABLED: '1'},
      stdio: ['ignore', 'pipe', 'pipe'], ...(resolved !== exe ? NPM_SHELL : {})});
    const label = [exe, ...args].join(' ');
    // Cold framework installs and builds can take longer on Windows runners.
    const timeout = process.platform === 'win32' ? 240_000 : 110_000;
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} timed out after ${timeout / 1000} s\n${output}`));
    }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${label} exited with ${signal ?? code}\n${output}`));
    });
  });
}
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
async function server(args){const port=await freePort();const child=spawn(process.execPath,['node_modules/next/dist/bin/next',...args,'-H','127.0.0.1','-p',String(port)],{cwd:host,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});children.push(child);let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);const url='http://127.0.0.1:'+port;for(let i=0;i<150;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.ok)return {url,child}}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100))}throw Error(log)}
async function editBridge(cli, origin) {
 const child = spawn(process.execPath, [cli, 'edit', '--scene', 'survey', '--url', origin, '--no-open', '--json'], { cwd: host, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
 children.push(child);
 return new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('The Next source edit bridge did not start.')), 45_000);
  let pending = '', error = '';
  child.stderr.on('data', data => { error += data; });
  child.stdout.on('data', data => {
   pending += data;
   const lines = pending.split('\n'); pending = lines.pop();
   for (const line of lines) {
    try {
     const result = JSON.parse(line);
     if (result.success && result.data?.url) { clearTimeout(timer); resolve(result.data.url); }
    } catch { /* Ignore informational output. */ }
   }
  });
  child.once('error', problem => { clearTimeout(timer); reject(problem); });
  child.once('exit', code => { clearTimeout(timer); reject(Error(`The Next source edit bridge exited (${code}). ${error.slice(-1200)}`)); });
 });
}
try{
 await mkdir(host,{recursive:true});
 const published=process.env.VELORA_REGISTRY_PACKAGE;
 const packed=published?undefined:JSON.parse(await run('npm',['pack','--ignore-scripts','--json','--pack-destination',scratch],root));
 const pkgName=published ? (published.startsWith('@') ? published.slice(0, published.lastIndexOf('@')) : published.split('@')[0]) : packed[0].name;
 const tarball=published?published.slice(pkgName.length + 1):path.join(scratch,packed[0].filename);
 const react=kind==='app'?'19.2.0':'18.3.1';
 await put('package.json',JSON.stringify({private:true,type:'module',dependencies:{react,'react-dom':react,[pkgName]:tarball,...(kind!=='react'?{next:'16.3.5'}:{'@types/react':'^18.3.0','@types/react-dom':'^18.3.0',typescript:'5.9.3'})}}));
 await run('npm',['install','--ignore-scripts','--no-audit','--no-fund',...(published?['--cache',path.join(scratch,'cache'),'--registry','https://registry.npmjs.org/']:[])]);
 if(published){const installed=JSON.parse(await readFile(path.join(host,'node_modules',pkgName,'package.json'),'utf8'));assert.equal(installed.name+'@'+installed.version,published);}
 const counter='"use client";\nimport React,{createContext,useContext,useState} from "react";\nconst Context=createContext("missing");\nexport function Provider({children}) {return <Context.Provider value="existing provider">{children}</Context.Provider>}\nexport default function Counter(){const value=useContext(Context);const [count,setCount]=useState(0);return <article style={{background:"#fafafa",color:"#111",padding:40,width:700,height:400}}><h1>{value}</h1><button onClick={()=>setCount(c=>c+1)}>Count {count}</button></article>}';
 await put('src/Counter.jsx',counter);
 if(kind==='app'){
  await put('app/layout.jsx','import React from "react"; import {Provider} from "../src/Counter"; export default function Layout({children}){return <html><body><Provider>{children}</Provider></body></html>}');
  await put('app/page.jsx','import React from "react"; import Counter from "../src/Counter"; export default function Page(){return <Counter/>}');
 }else if(kind==='pages'){
  await put('pages/_app.jsx','import React from "react"; import {Provider} from "../src/Counter"; export default function App({Component,pageProps}){return <Provider><Component {...pageProps}/></Provider>}');
  await put('pages/index.jsx','export {default} from "../src/Counter";');
 }
 const cli=path.join(host,'node_modules',pkgName,'dist/cli/velora.js');
 const initialized=JSON.parse(await run(process.execPath,[cli,'init','--json']));
 assert.equal(initialized.success,true);assert.equal(initialized.data.integration.kind,kind==='react'?'react':'next-'+kind);
 assert.equal(JSON.parse(await run(process.execPath,[cli,'init','--json'])).data.changed,false);
 const recipe={version:1,id:'survey',title:'Host survey',definition:{width:1000,height:700,scene:{nodes:[{id:'host'}],camera:{rotateY:20,perspective:1800},focus:{maxBlur:0}},motion:{durationMs:200,tracks:[]}}};
 await put('src/velora/scenes/survey.scene.json',JSON.stringify(recipe));
 await put('src/velora/scenes/survey.jsx',`"use client";\nimport React from "react"; import {Surface} from "${pkgName}"; import Counter from "../../Counter"; export default function HostScene(){return <Surface id="host"><Counter/></Surface>}`);
 await run(process.execPath,[cli,'sync']);
 await run(process.execPath,[cli,'validate']);
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let url;let dev;
 if(kind==='react'){
  await put('check.tsx',`import React from "react"; import {Scene,Surface} from "${pkgName}"; import {ProjectPreview} from "${pkgName}/preview"; export const check=<ProjectPreview projectId="test" enabled active><Scene><Surface id="test">Host</Surface></Scene></ProjectPreview>;`);
  await run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--strict','--jsx','react-jsx','--module','esnext','--moduleResolution','bundler','--target','es2022','--allowSyntheticDefaultImports','check.tsx']);
  await put('entry.jsx' ,'import React from "react"; import {createRoot} from "react-dom/client"; import {VeloraProjectPreview} from "./src/velora/ProjectPreview"; import Counter,{Provider} from "./src/Counter"; createRoot(document.getElementById("root")).render(<Provider><VeloraProjectPreview enabled active><Counter/></VeloraProjectPreview></Provider>);');
  const {outputFiles:[bundle]}=await build({absWorkingDir:host,entryPoints:['entry.jsx'],bundle:true,write:false,define:{'process.env.NODE_ENV':'"development"'}});
  const staticServer=createServer((req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.contents:'<div id="root"></div><script src="/bundle.js"></script>')});
  await new Promise(r=>staticServer.listen(0,'127.0.0.1',r));children.push({kill:()=>staticServer.close()});url='http://127.0.0.1:'+staticServer.address().port;
 }else{
  dev=await server(kind==='app'?['dev']:['dev','--webpack']);url=dev.url;
  await page.goto(url);await expect(page.getByRole('button',{name:'Count 0'})).toBeVisible();
  await page.getByRole('button',{name:'Count 0'}).click();await expect(page.getByRole('button',{name:'Count 1'})).toBeVisible();
  const opened=JSON.parse(await run(process.execPath,[cli,'open','--url',url,'--no-open','--json']));assert.equal(opened.data.url,url+'/velora?velora-preview=1');
  url=opened.data.url;
 }
 await page.goto(url);
 await expect(page.getByText('Host survey',{exact:true})).toBeVisible({timeout:30000});
 await page.getByText('Host survey',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Count 0'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'existing provider'})).toBeVisible();
 await page.getByRole('button',{name:'Count 0'}).click();
 await expect(page.getByRole('button',{name:'Count 1'})).toBeVisible();
 await page.getByRole('button',{name:'Count 1'}).evaluate(el=>el.dataset.kept='true');
 let hmrMs;
 if(kind!=='react'){
  recipe.title='Revised host survey';
  const started=Date.now();
  await put('src/velora/scenes/survey.scene.json',JSON.stringify(recipe));
  await page.waitForFunction(()=>document.querySelector('.velora-title')?.textContent==='Revised host survey');
  hmrMs=Date.now()-started;
  console.log(`[budget] ${kind} recipe save to visible ${hmrMs} ms (target ≤ 1000 ms)`);
  await expect(page.getByRole('button',{name:'Count 1'})).toBeVisible();
  await expect(page.locator('[data-kept="true"]')).toHaveText('Count 1');
 }
 await mkdir(path.join(root,'test-results'),{recursive:true});
 await page.screenshot({path:path.join(root,'test-results/portable-'+kind+'.png')});
 assert.deepEqual(errors,[]);
 let editUrl;
 if (!published) {
  const sceneFile=path.join(host,'src/velora/scenes/survey.scene.json');
  editUrl=kind==='react' ? url+'/?velora-scene=survey&velora-edit=1' : await editBridge(cli,dev.url);
  await page.goto(editUrl);
  await expect(page.getByRole('button',{name:'Ask agent',exact:true})).toBeVisible({timeout:30000});
  assert.ok(!page.url().includes('velora-bridge'));
  await page.locator('[data-item="camera"]').click();
  await page.getByRole('button',{name:'Animate x',exact:true}).click();
  await expect(page.getByRole('gridcell',{name:/camera x, keyframe at 0\.00 s/})).toBeVisible();
  if(kind==='react'){
   await expect(page.getByTestId('editor-save-state')).toHaveText('○ Not saved (no bridge)');
   await page.getByRole('button',{name:'Copy as command',exact:true}).click();
   assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/velora edit apply --scene 'survey' --ops - --write/);
   assert.deepEqual(JSON.parse(await readFile(sceneFile,'utf8')).definition.motion.tracks,[]);
  }else{
   await expect.poll(async()=>JSON.parse(await readFile(sceneFile,'utf8')).definition.motion.tracks).toContainEqual(
    expect.objectContaining({target:{kind:'camera'},property:'x'}));
  }
  await page.getByRole('button',{name:'Ask agent',exact:true}).click();
  const agentDialog=page.getByRole('dialog',{name:'Ask agent'});
  await agentDialog.getByLabel('What should the agent change?').fill('Polish the camera key.');
  await agentDialog.getByRole('button',{name:'Copy agent prompt',exact:true}).click();
  await expect(agentDialog.getByRole('status')).toHaveText('Prompt copied.');
  const prompt=await page.evaluate(()=>navigator.clipboard.readText());
  assert.ok(prompt.includes('Polish the camera key.') && prompt.includes('survey'));
  await page.keyboard.press('Escape');
  console.log(kind+': Studio keyframe and clipboard handoff passed');
 }
 if(kind==='app'){
  await run(process.execPath,[cli,'snapshot','--scene','survey','--url',dev.url]);
  await run(process.execPath,[cli,'export','--url',url+'&velora-scene=survey','--output','scene.mp4','--fps','30','--width','640','--height','480']);
  const probe=JSON.parse(await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=nb_frames,r_frame_rate','-of','json','scene.mp4']));
  assert.equal(probe.streams[0].r_frame_rate,'30/1');assert.ok(Number(probe.streams[0].nb_frames)>0);
  if (!published) {
   await page.goto(editUrl);
   await expect(page.getByRole('button', { name: 'Pick source element' })).toBeVisible({ timeout: 30_000 });
   await page.getByRole('button', { name: 'Pick source element' }).click();
   const box = await page.getByRole('heading', { name: 'existing provider' }).boundingBox();
   await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
   const panel = page.getByRole('dialog', { name: 'Source integration' });
   await panel.getByRole('button', { name: 'h1', exact: true }).click();
   await panel.getByLabel('Layer ID').fill('provider-title');
   await panel.getByRole('button', { name: 'Preview source edit' }).click();
   await expect(panel.getByRole('region', { name: 'Source diff' })).toContainText('provider-title');
   assert.equal(await readFile(path.join(host, 'src/Counter.jsx'), 'utf8'), counter);
   try {
    const [applied] = await Promise.all([
     page.waitForResponse(response => response.url().endsWith('/v1/source/apply'), { timeout: 20_000 }),
     panel.getByRole('button', { name: 'Apply source edit' }).click(),
    ]);
    assert.equal(applied.status(), 200, applied.ok() ? undefined : await applied.text());
    await expect.poll(() => readFile(path.join(host, 'src/Counter.jsx'), 'utf8')).toContain('id="provider-title" passthrough');
    await expect.poll(async () => JSON.parse(await readFile(path.join(host, 'src/velora/scenes/survey.scene.json'), 'utf8')).definition.scene.nodes).toContainEqual({ id: 'provider-title', parentId: 'host' });
    await expect(page.locator('[data-velora-id="provider-title"]')).toContainText('existing provider', { timeout: 30_000 });
    await expect(page.locator('[data-item="provider-title"]')).toBeVisible({ timeout: 30_000 });
    await page.goto(dev.url);
    await expect(page.getByRole('heading', { name: 'existing provider' })).toBeVisible();
    assert.equal(await page.locator('[data-velora-id="provider-title"]').count(), 0);
   } catch (error) {
    console.error('Next source scene after HMR:', (await page.locator('body').innerText()).slice(0, 1800), errors.slice(-4));
    throw error;
   }
   console.log('next-app: source pick, reviewed JSX + recipe diff, and fast refresh passed');
  }
 }
 if(kind!=='react'){
  dev.child.kill();await new Promise(r=>dev.child.once('exit',r));
  await run(process.execPath,['node_modules/next/dist/bin/next','build','--webpack']);
  for(const entry of await readdir(path.join(host,'.next/static'),{recursive:true}))if(entry.endsWith('.js')){
   const text=await readFile(path.join(host,'.next/static',entry),'utf8');
   assert.ok(!text.includes('Revised host survey'),'Production assets must exclude development recipes');
   assert.ok(!/data-velora-(editor-timeline|composition-editor)|WebGLRenderer|TransformControls|react-three-fiber/.test(text),'Production assets must exclude Studio and Three.js');
  }
  const production=await server(['start']);
  assert.equal((await fetch(production.url+'/velora')).status,404);
  await page.goto(production.url);await expect(page.getByRole('button',{name:'Count 0'})).toBeVisible();
 }
 if(hmrMs!==undefined && process.env.VELORA_VERIFY_HARDWARE==='1')
  assert.ok(hmrMs<=1000,`Next recipe save took ${hmrMs} ms to appear (budget: 1000 ms)`);
 console.log(kind+': installed package/init/retry/sync, shared studio, real provider/counter and '+(kind==='react'?'bundler-independent React 18 renderer':'hot-reload identity/production 404')+' passed.');
}catch(error){console.error(error);process.exitCode=1}
finally{await browser?.close();for(const child of children)child.kill();await rm(scratch,{recursive:true,force:true,maxRetries:8,retryDelay:250})}
