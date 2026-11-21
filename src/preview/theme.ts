import {studioTheme} from './studio-theme';
/** SOURCE OF TRUTH: previewTheme, velora-bottom-blur, velora-controls.
 * WHAT: edge-to-edge scene surface and one scrollable bottom controls overlay.
 * WHY: three static, masked backdrop layers reveal the actual scene without a reserved dock.
 * WHERE: ScenePreview owns markup; scene/capture geometry and host UI remain independent.
 * Blur is capped at 320px/half the viewport, never animated, and ignores pointer events.
 */
export const previewTheme = `
${studioTheme}
[data-velora-layout=editor] .velora-editor-grid{position:absolute;inset:0;display:grid;grid-template-columns:var(--velora-left,260px) 1fr var(--velora-right,300px);grid-template-rows:auto 1fr var(--velora-bottom,280px);grid-template-areas:"top top top" "left center right" "bottom bottom bottom";background:#0b0b0d}
[data-velora-layout=editor] .velora-editor-top{grid-area:top;display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid #ffffff1f;min-width:0}
[data-velora-layout=editor] .velora-editor-top .velora-control{min-height:32px;padding:6px 12px}
[data-velora-layout=editor] .velora-editor-toolbar{flex:1;display:flex;align-items:center;gap:8px;min-width:0;overflow-x:auto}
[data-velora-layout=editor] .velora-editor-left{grid-area:left;overflow:auto;border-right:1px solid #ffffff1f}
[data-velora-layout=editor] .velora-editor-right{grid-area:right;overflow:auto;border-left:1px solid #ffffff1f}
[data-velora-layout=editor] .velora-editor-bottom{grid-area:bottom;overflow:hidden;border-top:1px solid #ffffff1f;display:flex;flex-direction:column;min-height:0}
[data-velora-layout=editor] .velora-editor-center{grid-area:center;position:relative;overflow:hidden;min-width:0;min-height:0}
[data-velora-layout=editor] .velora-editor-center .velora-viewport{position:absolute;inset:0}
[data-velora-layout=editor] .velora-editor-message{position:absolute;left:12px;right:12px;bottom:12px;z-index:3}
[data-velora-layout=editor] .velora-editor-export{position:absolute;top:56px;right:12px;z-index:5}
@media (max-width:1100px){[data-velora-layout=editor] .velora-editor-grid{grid-template-columns:1fr;grid-template-rows:auto minmax(240px,40vh) auto auto auto;grid-template-areas:"top" "center" "bottom" "right" "left";overflow:auto}}
[data-velora-preview]{position:fixed;inset:0;height:100dvh;overflow:hidden;background:#000;color:#fff;min-height:0;width:100%;box-sizing:border-box;isolation:isolate}
.velora-chrome{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-sizing:border-box;color:#fff}
.velora-viewport{position:absolute;inset:0;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center}
.velora-canvas{flex:none;position:relative;overflow:hidden;background:#000}
.velora-bottom-blur{position:absolute;inset:auto 0 0;height:min(320px,50%);pointer-events:none;z-index:1}
.velora-bottom-blur i{position:absolute;inset:0;pointer-events:none;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);mask-image:linear-gradient(transparent,#000 55%);-webkit-mask-image:linear-gradient(transparent,#000 55%)}
.velora-bottom-blur i:first-child{background:rgb(0 0 0 / .28)}
.velora-bottom-blur i:nth-child(2){top:25%;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);mask-image:linear-gradient(transparent,#000 65%);-webkit-mask-image:linear-gradient(transparent,#000 65%)}
.velora-bottom-blur i:nth-child(3){top:50%;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);mask-image:linear-gradient(transparent,#000 80%);-webkit-mask-image:linear-gradient(transparent,#000 80%)}
.velora-footer{position:absolute;inset:auto 0 0;z-index:2;pointer-events:none;padding:24px max(24px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));box-sizing:border-box}
.velora-controls{max-width:760px;max-height:calc(100dvh - 48px - env(safe-area-inset-bottom));overflow:auto;overscroll-behavior:contain;margin:0 auto;display:flex;flex-direction:column;gap:12px;pointer-events:auto;padding:6px;scrollbar-width:thin;scrollbar-color:#666 transparent}
.velora-header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-shrink:0}
.velora-heading{display:flex;align-items:center;gap:16px;min-width:0}
.velora-stage-chip{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:11px;color:inherit}
.velora-stage-chip select{min-height:28px;background:#23252b;color:#e5e8ef;border:1px solid #777c87;border-radius:4px}
.velora-stage-chip output{max-width:42ch;overflow-wrap:anywhere}
.velora-title{font-size:15px;font-weight:600;letter-spacing:-.2px;color:#fff;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.velora-control{appearance:none;box-sizing:border-box;border:1px solid #ffffff30;border-radius:999px;padding:11px 18px;background:#242424;color:#fff;font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:9px;white-space:nowrap;min-height:44px;flex-shrink:0;transition:background .15s;box-shadow:none}
.velora-control:hover{background:#3a3a3a}.velora-control:disabled{opacity:.45;cursor:default}
.velora-control:focus-visible,.velora-timeline:focus-visible,.velora-export-panel select:focus-visible,[data-velora-error] button:focus-visible{outline:2px solid #fff;outline-offset:3px}
.velora-primary{background:#fff;color:#111;border-color:transparent}.velora-primary:hover{background:#e5e5e5}
.velora-icon{width:44px;padding:12px}.velora-control svg{width:17px;height:17px;flex:none}
.velora-dock{display:flex;align-items:center;gap:12px;width:100%;flex-shrink:0}
.velora-timeline{appearance:none;min-width:30px;flex:1;height:44px;margin:0;border-radius:999px;accent-color:#fff;cursor:pointer;background:transparent}
.velora-timeline::-webkit-slider-runnable-track{height:4px;background:#858585;border-radius:999px}
.velora-timeline::-webkit-slider-thumb{appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:100%;background:#fff}
.velora-timeline::-moz-range-track{height:4px;background:#858585;border-radius:999px}
.velora-timeline::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:100%;background:#fff}
.velora-timeline:disabled{opacity:.45;cursor:default}
.velora-time{font-size:12px;font-variant-numeric:tabular-nums;color:#fff;white-space:nowrap;min-width:88px}
.velora-preview-meta{display:flex;align-items:center;justify-content:center;gap:6px 18px;flex-wrap:wrap;flex-shrink:0}
.velora-status{font-size:12px;color:#e5e5e5;display:flex;gap:7px;align-items:center;justify-content:center;min-height:20px;flex-shrink:0}
.velora-status-dot{width:5px;height:5px;background:currentColor;border-radius:50%}
.velora-message,[data-velora-preview] [data-velora-error]{background:#202020;border:1px solid #ffffff30;border-radius:20px;padding:16px 20px;font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;margin:0;max-height:25dvh;overflow:auto;overflow-wrap:anywhere;flex-shrink:0}
.velora-message p,[data-velora-error] p{margin:6px 0}.velora-message ul{padding-left:20px;margin:8px 0}
[data-velora-preview] [data-velora-error] button{border:0;border-radius:999px;padding:12px 20px;min-height:44px;background:#fff;color:#111;font:inherit;cursor:pointer}
.velora-empty{max-width:410px;text-align:center;padding:24px;margin:auto;align-self:center}
.velora-empty h1{font-size:38px;line-height:1.15;font-weight:500;letter-spacing:-1.8px;margin:24px 0 16px}
.velora-empty p{color:#aaa;line-height:1.8;margin:0;font-size:14px}
.velora-empty-symbol{display:inline-flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:26px;background:#202020;color:#fff;font-size:30px}
.velora-onboarding{flex-shrink:0}.velora-onboarding summary,.velora-export summary{list-style:none}.velora-onboarding summary::-webkit-details-marker,.velora-export summary::-webkit-details-marker{display:none}
.velora-export-slot:empty{display:none}
.velora-export-panel{margin-left:auto;width:min(350px,100%);box-sizing:border-box;padding:22px;background:#202020;border:1px solid #ffffff30;border-radius:24px;white-space:normal;overflow-wrap:anywhere}
.velora-export-panel p{color:#d4d4d4;line-height:1.6;margin:8px 0 16px}.velora-export-panel label{display:flex;align-items:center;justify-content:space-between;margin-top:8px}.velora-export-panel select{border:1px solid #ffffff40;background:#333;color:#fff;padding:9px 14px;border-radius:999px;font:inherit;margin-left:12px;min-height:44px;max-width:100%}
.velora-export-panel code{display:block;background:#111;color:#eee;font-size:11px;padding:14px;border-radius:14px;overflow-wrap:anywhere;white-space:pre-wrap;margin:16px 0}
[data-velora-preview] [data-velora-diagnostics]{display:none}
.velora-header-tools{display:flex;align-items:center;gap:10px;flex-shrink:0}
.velora-guides{position:relative}.velora-guides summary{list-style:none}.velora-guides summary::-webkit-details-marker{display:none}
.velora-guides-panel{position:fixed;left:max(24px,env(safe-area-inset-left));bottom:150px;width:240px;padding:16px;background:#202020;border:1px solid #ffffff30;border-radius:20px;display:flex;flex-direction:column;gap:10px;z-index:3}
.velora-guides-panel label{display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer}.velora-guides-panel select{margin-left:auto;background:#333;color:#fff;border:1px solid #ffffff40;border-radius:999px;padding:6px 10px;font:inherit}
.velora-aside{position:absolute;z-index:3;top:16px;right:16px;bottom:16px;width:min(340px,calc(100% - 32px));overflow:auto;overscroll-behavior:contain;padding:20px;background:rgb(24 24 27 / .92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid #ffffff24;border-radius:24px;display:flex;flex-direction:column;gap:14px}
.velora-aside[data-collapsed]{bottom:auto;width:auto;padding:6px}
.velora-aside{text-align:left}.velora-aside h2{font-size:15px;margin:0;font-weight:600;color:#fff;letter-spacing:-.2px}[data-velora-preview]:has(>.velora-aside:not([data-collapsed])) .velora-footer{padding-right:min(380px,40vw)}.velora-aside p{margin:0;color:#b5b5bb;font-size:12px;line-height:1.6}
.velora-field{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#d4d4d8}.velora-field>span{display:flex;justify-content:space-between;gap:8px}.velora-field output{color:#fff;font-variant-numeric:tabular-nums}
.velora-field input[type=range]{width:100%;accent-color:#fff}.velora-field select,.velora-field input[type=text]{background:#2a2a2e;color:#fff;border:1px solid #ffffff30;border-radius:12px;padding:9px 12px;font:inherit}
.velora-field small{color:#8e8e94;font-size:11px;line-height:1.5}
.velora-aside code{display:block;background:#111;color:#eee;font-size:11px;padding:12px;border-radius:12px;overflow-wrap:anywhere;white-space:pre-wrap}
.velora-aside .velora-actions{display:flex;flex-wrap:wrap;gap:8px}.velora-aside .velora-issues{color:#ffb4b4;font-size:12px;margin:0;padding-left:18px}
.velora-captions{position:absolute;left:50%;bottom:8%;transform:translateX(-50%);max-width:80%;padding:.3em .7em;background:rgb(0 0 0 / .72);color:#fff;border-radius:.3em;text-align:center;line-height:1.35;pointer-events:none}
.velora-strip{display:flex;gap:2px;height:44px;width:100%;flex-shrink:0;position:relative}
.velora-strip button{position:relative;min-width:2px;border:0;border-radius:8px;background:#2a2a2e;color:#ddd;font:11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:4px 8px;text-align:left;overflow:hidden;cursor:pointer;white-space:nowrap;text-overflow:ellipsis}
.velora-strip button[aria-current=true]{background:#46464c;color:#fff}.velora-strip button:focus-visible{outline:2px solid #fff;outline-offset:2px}
.velora-strip img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.35}.velora-strip span{position:relative}
.velora-strip i{position:absolute;top:0;bottom:0;width:2px;background:#fff;pointer-events:none}
.velora-strip b{position:absolute;bottom:0;width:1px;height:8px;background:#ffd166;pointer-events:none}
@media(max-width:700px){.velora-footer{padding:12px max(10px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left))}.velora-controls{gap:10px;max-height:calc(100dvh - 24px - env(safe-area-inset-bottom))}.velora-header{gap:8px}.velora-heading{flex-wrap:wrap;gap:8px}.velora-title{flex-basis:100%;font-size:13px}.velora-control{padding:10px 14px}.velora-icon{padding:12px}.velora-dock{gap:8px}.velora-time{min-width:76px;font-size:11px}.velora-empty h1{font-size:30px}}
@media(max-height:500px){.velora-footer{padding-top:8px;padding-bottom:max(8px,env(safe-area-inset-bottom))}.velora-controls{gap:8px;max-height:calc(100dvh - 16px - env(safe-area-inset-bottom))}.velora-empty-symbol{display:none}.velora-empty h1{font-size:24px;margin:0 0 8px}}
@media(prefers-reduced-motion:reduce){.velora-control{transition:none}}
`;
