import {studioTheme} from './studio-theme';
/** SOURCE OF TRUTH: libraryTheme. WHAT: catalog layout only. WHY: no host CSS leakage.
 * WHERE: SceneLibrary supplies actual recipes; canonical Scene handles perspective/focus.
 */
export const libraryTheme=`
${studioTheme}
[data-velora-library]{position:fixed;inset:0;background:#000;color:#f5f5f7;font:14px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;isolation:isolate}
[data-velora-library] a{color:inherit;text-decoration:none}
.velora-library-top{position:absolute;z-index:5;top:28px;left:36px;right:36px;display:flex;justify-content:space-between;pointer-events:none}.velora-library-top a{pointer-events:auto}.velora-library-brand{font-size:23px;font-weight:600;letter-spacing:-1px}
.velora-library-identity{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.velora-library-brand:focus-visible{outline:2px solid #fff;outline-offset:4px}
.velora-library-scroll{height:100svh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#333 #000;outline-offset:-4px}
/* Mask the final composited viewport, outside Scene's preserve-3d hierarchy. */
.velora-library-stage{position:sticky;top:0;height:100svh;overflow:hidden;mask-image:linear-gradient(to bottom,transparent,#000 min(180px,20svh));-webkit-mask-image:linear-gradient(to bottom,transparent,#000 min(180px,20svh))}
.velora-library-heading,.velora-scene-row{box-sizing:border-box;background:#19191c}.velora-library-heading{height:110px;border-radius:28px 28px 0 0;padding:28px 36px;display:flex;align-items:center;justify-content:space-between;gap:20px}.velora-library-heading h1{font-size:27px;margin:0;letter-spacing:-.8px;font-weight:550}.velora-library-heading>span{color:#929297}
.velora-scene-row{display:flex;align-items:center;gap:26px;height:150px;padding:28px 36px;border-top:1px solid #262628;outline-offset:-5px}.velora-scene-row:hover{background:#232326}.velora-scene-row:focus-visible{outline:3px solid #ddd;background:#29292c}
.velora-scene-number{position:relative;flex:none;width:76px;height:76px;overflow:hidden;display:grid;place-items:center;border-radius:18px;background:#29292d;color:#dadade;font-size:27px;font-weight:350;font-variant-numeric:tabular-nums}
.velora-scene-number img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.velora-scene-copy{min-width:0;display:flex;flex-direction:column;gap:7px}.velora-scene-copy strong{font-size:27px;line-height:1.2;font-weight:500;letter-spacing:-.7px}.velora-scene-copy>span{color:#99999f;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.velora-scene-duration{margin-left:auto;flex:none;font-size:17px;color:#a3a3a8;font-variant-numeric:tabular-nums}.velora-scene-duration>span{margin-left:20px;color:#ececf0}
.velora-library-hint{position:absolute;bottom:22px;left:0;right:0;text-align:center;font-size:12px;color:#999;pointer-events:none}
.velora-library-empty{position:absolute;inset:90px 0 24px;overflow:auto;display:flex;padding:20px;box-sizing:border-box}.velora-library-empty>div{width:100%;margin:auto;display:flex;flex:none;flex-direction:column;align-items:center;text-align:center;gap:14px}.velora-library-empty>div>span{font-size:11px;letter-spacing:2px;color:#aaa}.velora-library-empty h1{max-width:580px;font-size:clamp(32px,5vw,56px);font-weight:450;line-height:1.08;letter-spacing:-2px;margin:8px 0}.velora-library-empty>div>p{max-width:450px;color:#aaa;margin:0 0 10px}
.velora-library-notice,.velora-library-issues{position:absolute;z-index:6;top:75px;left:5%;right:5%;padding:12px 20px;background:#252529;border-radius:16px;max-height:25vh;overflow:auto}.velora-library-issues{top:auto;bottom:55px}.velora-library-issues summary{cursor:pointer}.velora-library-notice a{text-decoration:underline}
@media(max-width:600px){.velora-library-top{top:20px;left:24px;right:24px}.velora-library-heading{padding:20px;gap:12px}.velora-library-heading h1{font-size:24px}.velora-library-heading>span{font-size:11px}.velora-scene-row{padding:20px;gap:14px}.velora-scene-number{width:56px;height:56px;border-radius:12px;font-size:20px}.velora-scene-copy strong{font-size:20px}.velora-scene-copy>span{font-size:12px;max-width:160px}.velora-scene-duration{font-size:12px}.velora-scene-duration>span{display:none}}
`;
