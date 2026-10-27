import {useEffect,useMemo,useRef,useState,type ComponentType,type MouseEvent,type ReactNode} from 'react';
import {VELORA_BRAND,RESOURCES,motionDuration,matrixFor,TransformSchema} from '../core';
import {Scene,Surface,SceneErrorBoundary} from '../react';
import {ScenePreview} from './ScenePreview';
import type {PreviewHot} from './connection';
import {BrandAttribution} from './BrandAttribution';
import {GettingStarted} from './GettingStarted';
import {libraryTheme} from './library-theme';
import {TemplateGallery} from './TemplateGallery';
import {QuickShot} from './QuickShot';
import {CompositionPlayer} from './CompositionPlayer';

/** SOURCE OF TRUTH: SceneLibrary.
 * WHAT: list and navigate the host's validated source recipes through one catalog.
 * Projected row visibility and centered scroll endpoints belong to this list layout.
 * WHY: discovered files, deep links and CLI reopening share load-scene validation.
 * WHERE: ProjectPreview supplies Vite modules; ScenePreview owns selected playback.
 * Tabs (Scenes | Templates | Compositions), quick shots and the composition player are URL state
 * (velora-tab, velora-quick, velora-composition), so back, forward and reload restore the view.
 * children are the host's live app: quick shots slot them into the template's subject.
 */
export type SceneLibraryProps={sources?:Record<string,unknown>;bindings?:Record<string,ComponentType>;hot?:PreviewHot;backHref?:string;
 children?:ReactNode;compositions?:Record<string,unknown>;assetUrls?:Record<string,string>};
type Tab='scenes'|'templates'|'compositions';
const TABS:[Tab,string][]=[['scenes','Scenes'],['templates','Templates'],['compositions','Compositions']];
function studioView(){
 const query=typeof location==='undefined'?new URLSearchParams():new URL(location.href).searchParams;
 const tab=query.get('velora-tab');
 return {tab:(tab==='templates'||tab==='compositions'?tab:'scenes') as Tab,quick:query.get('velora-quick')??undefined,composition:query.get('velora-composition')??undefined};
}
const EMPTY_COMPOSITIONS:Record<string,unknown>={};
const EMPTY_SOURCES:Record<string,unknown>={};
const EMPTY_BINDINGS:Record<string,ComponentType>={};
const ROW=150;
// Positive X tilt recedes at the top and approaches the viewer at the bottom.
// The lens stays fixed at the viewport center while the entire list travels through it.
const camera={perspective:1400,rotateX:42};
const focus={distance:1400,fStop:4,focalLength:220,maxBlur:7};
const view=matrixFor(TransformSchema.parse({rotateX:camera.rotateX}));
// Viewport culling consumes the canonical camera matrix, not flat scroll indices.
// Invert the projected vertical coordinate on this list's z=0 plane. Keep a full
// row plus the blur footprint beyond each edge; a visible horizon retains its tail.
function visibleRows(scroll:number,height:number,count:number){
 const localY=(screenY:number)=>{
  const y=screenY-height/2;
  const denominator=camera.perspective*view[5]+y*view[9];
  return denominator<=0?-Infinity:height/2+y*camera.perspective/denominator;
 };
 const top=localY(-3*focus.maxBlur);
 const bottom=localY(height+3*focus.maxBlur);
 return {start:Math.max(0,Math.floor((scroll+top-(height/2-ROW/2))/ROW)-1),
  end:Math.min(count,Math.ceil((scroll+bottom-(height/2-ROW/2))/ROW)+2)};
}
// Image failures are local to the thumbnail; a replacement source retries naturally.
function SnapshotImage({src}:{src:string}){
 const [failed,setFailed]=useState<string>();
 return failed===src?null:<img src={src} alt="" loading="lazy" decoding="async" onError={()=>setFailed(src)}/>;
}
function selection(){return typeof location==='undefined'?undefined:new URL(location.href).searchParams.get('velora-scene')??undefined;}
export function SceneLibrary({sources=EMPTY_SOURCES,bindings=EMPTY_BINDINGS,hot,backHref,children,compositions=EMPTY_COMPOSITIONS,assetUrls}:SceneLibraryProps){
 const [sceneId,setSceneId]=useState(selection);
 const [route,setRoute]=useState(studioView);
 const [scroll,setScroll]=useState(0);
 const [size,setSize]=useState({width:1200,height:1000});
 const {width,height}=size;
 const scroller=useRef<HTMLDivElement>(null);
 const savedScroll=useRef(0);
 const catalog=useMemo(()=>RESOURCES['resolve-recipes']({sources:Object.entries(sources).map(([path,document])=>({path,document})),bindingPaths:Object.keys(bindings),...(sceneId?{sceneId}:{})}),[sources,bindings,sceneId]);
 const selected=catalog.selected;
 const Component=selected?bindings[selected.binding]:undefined;
 const content=useMemo(()=>Component?<Component/>:null,[Component]);
 useEffect(()=>{const pop=()=>{setSceneId(selection());setRoute(studioView())};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[]);
 useEffect(()=>{if(selected&&Component)return;const element=scroller.current;if(!element)return;const measure=()=>setSize({width:element.clientWidth,height:element.clientHeight});const observer=new ResizeObserver(measure);observer.observe(element);measure();element.scrollTop=savedScroll.current;return()=>observer.disconnect()},[selected?.id,Component]);
 const destination=(id?:string)=>{const url=new URL(location.href);if(id)url.searchParams.set('velora-scene',id);else url.searchParams.delete('velora-scene');return url.pathname+url.search+url.hash;};
 const navigate=(event:MouseEvent<HTMLAnchorElement>,id?:string)=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();history.pushState({},'',destination(id));setSceneId(id);setRoute(studioView());};
 // One URL builder for tabs, quick shots and compositions; unrelated host params are preserved.
 const studioHref=(next:{tab?:Tab;composition?:string})=>{const url=new URL(location.href);for(const key of ['velora-scene','velora-quick','velora-route','velora-params','velora-composition','velora-tab'])url.searchParams.delete(key);
  if(next.tab&&next.tab!=='scenes')url.searchParams.set('velora-tab',next.tab);if(next.composition){url.searchParams.set('velora-tab','compositions');url.searchParams.set('velora-composition',next.composition);}return url.pathname+url.search+url.hash;};
 const go=(href:string)=>{history.pushState({},'',href);setSceneId(selection());setRoute(studioView());};
 const follow=(event:MouseEvent<HTMLAnchorElement>,href:string)=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();go(href);};
 const compositionList=useMemo(()=>Object.entries(compositions).map(([path,document])=>{const value=document as {id?:unknown;title?:unknown;scenes?:unknown};
  const scenes=Array.isArray(value?.scenes)?value.scenes as {startMs?:number;durationMs?:number}[]:[];
  return {path,id:typeof value?.id==='string'?value.id:path,title:typeof value?.title==='string'?value.title:path,durationMs:scenes.reduce((end,scene)=>Math.max(end,(scene.startMs??0)+(scene.durationMs??0)),0),document};}),[compositions]);
 if(route.quick)return <QuickShot hot={hot} backHref={studioHref({tab:'templates'})} onBack={()=>go(studioHref({tab:'templates'}))}>{children}</QuickShot>;
 const playing=route.composition?compositionList.find(entry=>entry.path===route.composition||entry.id===route.composition):undefined;
 if(playing)return <CompositionPlayer key={playing.path} path={playing.path} document={playing.document} scenes={catalog.scenes} bindings={bindings} assetUrls={assetUrls}
  backHref={studioHref({tab:'compositions'})} onBack={()=>go(studioHref({tab:'compositions'}))}/>;
 const tabs=<nav className="velora-library-tabs" aria-label="Studio">{TABS.map(([tab,label])=>{const href=studioHref({tab});return <a key={tab} href={href} aria-current={route.tab===tab&&!sceneId?'page':undefined} onClick={event=>follow(event,href)}>{label}</a>;})}</nav>;
 const top=<div className="velora-library-top"><div className="velora-library-identity"><a href={destination()} onClick={event=>navigate(event)} className="velora-library-brand">{VELORA_BRAND.name.toLowerCase()}</a><BrandAttribution showName={false}/></div>{backHref&&<a href={backHref}>Back to app</a>}</div>;
 if(route.tab==='templates'&&!sceneId)return <main data-velora-library="" data-velora-tab="templates"><style>{libraryTheme}</style>{top}{tabs}
  <TemplateGallery onOpen={search=>go(location.pathname+search+location.hash)}/></main>;
 if(route.tab==='compositions'&&!sceneId)return <main data-velora-library="" data-velora-tab="compositions"><style>{libraryTheme}</style>{top}{tabs}
  <section className="velora-gallery" aria-label="Compositions">
   {route.composition&&<div className="velora-library-notice" role="alert" style={{position:'static',margin:'0 auto 16px',maxWidth:900}}>Composition “{route.composition}” was not found.</div>}
   {compositionList.length===0?<div className="velora-compositions"><p style={{color:'#aaa'}}>No compositions yet. Create one with <code>npx velora new video --blueprint product-reel-20s --id reel --route / --json</code>. Files named <code>*.composition.json</code> at the project root appear here.</p></div>:
   <div className="velora-compositions">{compositionList.map(entry=>{const href=studioHref({composition:entry.path});return <a key={entry.path} href={href} data-composition={entry.id} onClick={event=>follow(event,href)}><strong>{entry.title}</strong><span>{(entry.durationMs/1000).toFixed(1)}s · {entry.path.replace(/^\//,'')}</span></a>;})}</div>}
  </section></main>;
 if(selected&&Component)return <ScenePreview key={selected.id} definition={selected.definition} title={selected.title} backHref={destination()} onBack={()=>{history.pushState({},'',destination());setSceneId(undefined)}} hot={hot}>{content}</ScenePreview>;
 const planeWidth=Math.min(940,Math.max(320,width-64));
 const {start,end}=visibleRows(scroll,height,catalog.scenes.length);
 return <main data-velora-library=""><style>{libraryTheme}</style>
  {top}{tabs}
  {sceneId&&<div className="velora-library-notice" role="alert">This scene cannot be opened. Correct its source or <a href={destination()} onClick={event=>navigate(event)}>return to scenes</a>.</div>}
  {catalog.issues.length>0&&<details className="velora-library-issues"><summary>Some scene sources need attention ({catalog.issues.length})</summary><ul>{catalog.issues.map((issue,index)=><li key={index}>{issue.path}: {issue.message}</li>)}</ul></details>}
  {catalog.scenes.length===0?<section className="velora-library-empty"><div><span>YOUR SCENE LIBRARY</span><h1>A place for every perspective.</h1><p>Your app’s scenes appear here as your coding agent creates them.</p><GettingStarted label="Connect your first scene"/></div></section>:
   <div ref={scroller} className="velora-library-scroll" role="region" aria-label="Scenes" tabIndex={0} onScroll={event=>{savedScroll.current=event.currentTarget.scrollTop;setScroll(event.currentTarget.scrollTop)}}>
    <div style={{height:`calc(100svh + ${Math.max(0,(catalog.scenes.length-1)*ROW)}px)`}}>
     <div className="velora-library-stage">
      <SceneErrorBoundary><Scene camera={camera} focus={focus} style={{width:'100%',height:'100%'}}>
       <Surface id="scene-list" transform={{y:-scroll}} style={{position:'absolute',left:(width-planeWidth)/2,top:height/2-110-ROW/2,width:planeWidth,height:1}}>
        <Surface id="scene-list-heading" style={{position:'absolute',top:0,width:planeWidth,height:110}}><header className="velora-library-heading"><h1>Your scenes</h1><span>{catalog.scenes.length} perspectives</span></header></Surface>
        {catalog.scenes.slice(start,end).map((scene,index)=>{const number=start+index;return <Surface key={scene.id} id={`scene-row-${scene.id}`} style={{position:'absolute',top:110+number*ROW,width:planeWidth,height:ROW}}>
          <a className="velora-scene-row" data-scene-id={scene.id} onFocus={event=>{if(event.currentTarget.matches(':focus-visible')&&scroller.current)scroller.current.scrollTop=Math.max(0,number*ROW)}} href={destination(scene.id)} onClick={event=>navigate(event,scene.id)}>
           <span className="velora-scene-number">{String(number+1).padStart(2,'0')}{scene.snapshot&&<SnapshotImage src={scene.snapshot.image}/>}</span><span className="velora-scene-copy"><strong>{scene.title}</strong><span>{scene.description||'A new perspective on your product'}</span></span>
           <span className="velora-scene-duration">{Math.round((scene.definition.motion?motionDuration(scene.definition.motion):0)/1000)}s <span aria-hidden="true">↗</span></span>
          </a>
         </Surface>})}
       </Surface>
      </Scene></SceneErrorBoundary>
     </div>
    </div>
   </div>}
  {catalog.scenes.length>0&&<p className="velora-library-hint">Scroll to explore · Select a scene to watch</p>}
 </main>;
}
