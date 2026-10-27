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
.velora-library-tabs{position:absolute;z-index:6;top:24px;left:50%;transform:translateX(-50%);display:flex;gap:4px;padding:4px;background:#19191c;border:1px solid #ffffff1c;border-radius:999px}
.velora-library-tabs a{padding:8px 16px;border-radius:999px;color:#a3a3a8;font-size:13px;font-weight:500}.velora-library-tabs a[aria-current=page]{background:#f5f5f7;color:#111}.velora-library-tabs a:focus-visible{outline:2px solid #fff;outline-offset:2px}
.velora-gallery{position:absolute;inset:80px 0 0;overflow:auto;padding:12px max(24px,4vw) 48px;box-sizing:border-box}
.velora-gallery-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 auto 22px;max-width:1240px}
.velora-gallery-filters button{border:1px solid #ffffff26;background:transparent;color:#cfcfd4;border-radius:999px;padding:7px 14px;font:inherit;font-size:12px;cursor:pointer}.velora-gallery-filters button[aria-pressed=true]{background:#f5f5f7;color:#111;border-color:transparent}
.velora-gallery-filters select{margin-left:auto;background:#19191c;color:#fff;border:1px solid #ffffff26;border-radius:999px;padding:7px 12px;font:inherit;font-size:12px}
.velora-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px;max-width:1240px;margin:0 auto}
.velora-card{text-align:left;display:flex;flex-direction:column;gap:12px;padding:14px;background:#141416;border:1px solid #ffffff14;border-radius:24px;outline-offset:3px}.velora-card:hover,.velora-card:focus-within{background:#1c1c1f;border-color:#ffffff30}
.velora-card-media{position:relative;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000}.velora-card-media svg{position:absolute;inset:0;width:100%;height:100%}
.velora-card h2{font-size:16px;margin:0;font-weight:550;letter-spacing:-.2px;color:#f5f5f7;line-height:1.3}.velora-card p{margin:0;color:#9a9aa0;font-size:12.5px;line-height:1.55}
.velora-card-tags{display:flex;flex-wrap:wrap;gap:6px}.velora-card-tags span{font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;color:#bdbdc2;border:1px solid #ffffff1f;border-radius:999px;padding:2px 8px}
.velora-card a.velora-card-open{align-self:flex-start;margin-top:auto;padding:9px 16px;border-radius:999px;background:#f5f5f7;color:#111;font-weight:550;font-size:13px}
.velora-compositions{max-width:900px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.velora-compositions a{display:flex;justify-content:space-between;gap:20px;padding:22px 26px;border-radius:22px;background:#19191c}.velora-compositions a:hover{background:#232326}.velora-compositions a:focus-visible{outline:3px solid #ddd}
.velora-compositions strong{font-size:20px;font-weight:500}.velora-compositions span{color:#9a9aa0}
@media(max-width:600px){.velora-library-top{top:20px;left:24px;right:24px}.velora-library-heading{padding:20px;gap:12px}.velora-library-heading h1{font-size:24px}.velora-library-heading>span{font-size:11px}.velora-scene-row{padding:20px;gap:14px}.velora-scene-number{width:56px;height:56px;border-radius:12px;font-size:20px}.velora-scene-copy strong{font-size:20px}.velora-scene-copy>span{font-size:12px;max-width:160px}.velora-scene-duration{font-size:12px}.velora-scene-duration>span{display:none}}
`;
