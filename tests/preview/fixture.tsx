import { createRoot } from 'react-dom/client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Surface, useAnimatable, type PreviewDefinitionInput } from '../../src';
import { SceneLibrary, ScenePreview } from '../../src/preview';
const Context = createContext('');
const rack = new URLSearchParams(location.search).get("mode") === "focus";
const definition: PreviewDefinitionInput = {width:1400,height:980,
 scene:{camera:{perspective:1800,rotateX:12,rotateY:-18},focus:{distance:1800,fStop:2.8,maxBlur:6},nodes:[{id:'host'}]},
 motion:{durationMs:4000,tracks:[rack ? {target:{kind:'focus'},property:'distance',keyframes:[{timeMs:0,value:1800},{timeMs:4000,value:1560}]} : {target:{kind:'camera'},property:'x',keyframes:[{timeMs:0,value:-100},{timeMs:4000,value:100}]}]},
};
function Host() {
 const context=useContext(Context);const [count,setCount]=useState(0);
 return <article data-testid="host" style={{background:'#ecebea',color:'#28262e',fontFamily:'Arial',padding:40,height:800}}>
 <h2>{context}</h2><button onClick={()=>setCount(value=>value+1)}>Count {count}</button>
 <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:20,marginTop:30}}>
 {Array.from({length:30},(_,index)=><div key={index} style={{padding:18,background:'#fff'}}>Region {index+1}<p>Live text</p></div>)}
 </div></article>;
}
function Fixture() {
 const [invalid,setInvalid]=useState(false);
 const [data,setData]=useState('Loading');
 useEffect(()=>{fetch('/data.json').then(response=>response.json()).then(value=>setData(value.title));},[]);
 const input=useMemo(()=>invalid ? {...definition,scene:{...definition.scene,focus:{distance:-1}}} : definition,[invalid]);
 const children=useMemo(()=><Surface id="host" style={{width:1100,height:880,left:150,top:50}}><Context value={data}><Host/></Context></Surface>,[data]);
 return <><button data-test-only="" onClick={()=>setInvalid(value=>!value)}>{invalid?'Correct source':'Invalid source'}</button>
 <ScenePreview definition={input} title="Host project" hot={import.meta.hot}>{children}</ScenePreview></>;
}
// Test-only catalog reuses the same host UI; no scenes enter the product entry.
function CatalogHost() {return <Surface id="host" style={{width:1100,height:880,left:150,top:50}}><Context value="Provider content"><Host/></Context></Surface>}
const snapshot='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPdwAAAAASUVORK5CYII=';
const recipes=Array.from({length:30},(_,index)=>{const id='scene-'+String(index+1).padStart(2,'0');return {id,version:1,title:'Scene '+String(index+1).padStart(2,'0'),description:'Existing host components',definition,...(index===0?{snapshot:{image:snapshot,timeMs:0}}:index===1?{snapshot:{image:'data:image/png;base64,iVBORw0KGgoAAAA',timeMs:0}}:{})}});
const sources=Object.fromEntries(recipes.map(recipe=>['src/velora/scenes/'+recipe.id+'.scene.json',recipe]));
const bindings=Object.fromEntries(recipes.map(recipe=>['src/velora/scenes/'+recipe.id+'.tsx',CatalogHost]));
// Edit mode fixture: one editable scene with a dashboard Surface, a caption and an animatable counter.
function Counter(){const {value}=useAnimatable('hero-counter',{value:{type:'number',default:0,max:1280}});return <strong data-testid="counter">{Math.round(value)}</strong>;}
function EditableScene(){return <><Surface id="dashboard" style={{position:'absolute',left:200,top:160,width:800,height:520}} content={<div style={{width:800,height:520,background:'#3b82f6',borderRadius:24,display:'grid',placeItems:'center',color:'#fff',font:'48px Arial'}}>Dashboard <Counter/></div>}/>
 <Surface id="caption" style={{position:'absolute',left:300,top:740,width:600,height:120}} content={<div style={{width:600,height:120,background:'#ffd166',borderRadius:12}}/>}/></>;}
export const editableRecipe={version:1,id:'editable',title:'Editable scene',definition:{width:1400,height:980,scene:{camera:{perspective:1800},focus:{maxBlur:0},nodes:[{id:'dashboard'},{id:'caption'}]},motion:{durationMs:4000,speed:1,tracks:[{target:{kind:'surface',id:'caption'},property:'opacity',keyframes:[{timeMs:0,value:0},{timeMs:1000,value:1}]}]}}};
const editSources={'src/velora/scenes/editable.scene.json':editableRecipe};
const editBindings={'src/velora/scenes/editable.tsx':EditableScene};
const mode=new URLSearchParams(location.search).get('mode');
// Performance fixtures (Phase 05 budgets): 200 channel tracks x 1000 keyframes, and a 60-Surface scene.
const largeRecipe={version:1,id:'large',title:'Large timeline',definition:{width:1400,height:980,scene:{focus:{maxBlur:0},nodes:[{id:'dashboard'}]},motion:{durationMs:100000,speed:1,tracks:Array.from({length:200},(_,i)=>({target:{kind:'channel',id:`c-${i}`},property:'value',keyframes:Array.from({length:1000},(_,k)=>({timeMs:k*100,value:(k*7+i)%50,easing:k%3?'linear':'cinematic'}))}))}}};
const sixty=Array.from({length:60},(_,i)=>`s-${i}`);
const sixtyRecipe={version:1,id:'sixty',title:'Sixty surfaces',definition:{width:1400,height:980,scene:{focus:{maxBlur:0},nodes:sixty.map(id=>({id}))},motion:{durationMs:4000,speed:1,tracks:[
 ...sixty.slice(0,5).map(id=>({target:{kind:'surface',id},property:'y',keyframes:[{timeMs:0,value:0},{timeMs:1000,value:40},{timeMs:2000,value:-20},{timeMs:3000,value:10}]}))]}}};
function SixtyScene(){return <>{sixty.map((id,i)=><Surface key={id} id={id} style={{position:'absolute',left:(i%10)*130+20,top:Math.floor(i/10)*150+20,width:120,height:120}} content={<div style={{width:120,height:120,background:'#7cc4ff'}}/>}/>)}</>;}
const perfSources:Record<string,unknown>={'src/velora/scenes/large.scene.json':largeRecipe,'src/velora/scenes/sixty.scene.json':sixtyRecipe};
const perfBindings={'src/velora/scenes/large.tsx':EditableScene,'src/velora/scenes/sixty.tsx':SixtyScene};
createRoot(document.getElementById('root')!).render(mode==='library'?<SceneLibrary sources={sources} bindings={bindings} backHref="/"/>:mode==='editor'?<SceneLibrary sources={editSources} bindings={editBindings}/>:mode==='perf'?<SceneLibrary sources={perfSources} bindings={perfBindings}/>:<Fixture/>);
