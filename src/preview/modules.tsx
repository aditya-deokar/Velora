import {useEffect,useState,type ComponentType,type ReactNode} from 'react';
import {SceneLibrary} from './SceneLibrary';
import {usePreviewConnection,type PreviewHot} from './connection';
/** SOURCE OF TRUTH: SceneModules adapter.
 * WHAT: load explicitly supplied host source modules only for the development library.
 * WHY: normal app entry and production never import authored scene modules.
 * WHERE: host adapter passes lazy module loaders; core load-scene validates metadata.
 * Composition documents load the same way (root *.composition.json); asset URLs pass through.
 */
export type SceneModules=Record<string,()=>Promise<unknown>>;
export type CompositionModules=Record<string,()=>Promise<unknown>>;
const NO_COMPOSITIONS:CompositionModules={};
const pause=()=>{};
export function SceneModuleLibrary({modules,hot,backHref,children,compositionModules=NO_COMPOSITIONS,assetUrls}:{modules:SceneModules;hot?:PreviewHot;backHref?:string;children?:ReactNode;compositionModules?:CompositionModules;assetUrls?:Record<string,string>}){
 const connection=usePreviewConnection(hot,pause);
 const [retry,setRetry]=useState(0);
 const [state,setState]=useState<{sources:Record<string,unknown>;bindings:Record<string,ComponentType>;compositions:Record<string,unknown>;error?:string}|null>(null);
 useEffect(()=>{
  let active=true;
  const load=async()=>{
   const sources:Record<string,unknown>={};const bindings:Record<string,ComponentType>={};const compositions:Record<string,unknown>={};
   try{
    const entries=Object.entries(modules);
    if(entries.length>256)throw new Error('Keep this library at or below 128 scene/component pairs.');
    const results=await Promise.allSettled(entries.map(async([path,loader])=>{
     const value=await loader();const item=value&&typeof value==='object'&&'default' in value?value.default:undefined;
     const normalized=path.replace(/^\//,'');
     if(path.endsWith('.composition.json'))compositions[path]=item;
     else if(path.endsWith('.scene.json'))sources[normalized]=item;
     else if(/\.[jt]sx$/.test(path)&&(typeof item==='function'||(typeof item==='object'&&item!==null)))bindings[normalized]=item as ComponentType;
    }));
    const failed=results.find(result=>result.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason;
    // A broken composition file is reported by the player; it never blocks the scene library.
    await Promise.all(Object.entries(compositionModules).slice(0,64).map(async([path,loader])=>{
     try{const value=await loader();compositions[path]=value&&typeof value==='object'&&'default' in value?value.default:value;}catch(error){compositions[path]={error:error instanceof Error?error.message:'Unreadable composition.'};}
    }));
    if(active)setState({sources,bindings,compositions});
   }catch(error){if(active)setState({sources,bindings,compositions,error:error instanceof Error?error.message:'Scene source could not be loaded.'})}
  };void load();return()=>{active=false};
 },[modules,compositionModules,retry,connection.generation]);
 if(!state)return <div role="status" style={{padding:40,color:'#eee',background:'#000'}}>Loading your scenes…</div>;
 return <><SceneLibrary sources={state.sources} bindings={state.bindings} compositions={state.compositions} assetUrls={assetUrls} hot={hot} backHref={backHref}>{children}</SceneLibrary>{state.error&&<aside role="alert" style={{position:'fixed',zIndex:20,bottom:60,left:24,right:24,padding:24,borderRadius:20,background:'#252529',color:'#fff'}}>Correct the scene source: {state.error} <button onClick={()=>setRetry(value=>value+1)}>Retry</button></aside>}</>;
}
