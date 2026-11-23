import { dashboard, opticsBoard } from "./depth-dashboard";

const host = document.querySelector("#route-dashboard")!;
host.innerHTML = new URLSearchParams(location.search).has("optics") ? opticsBoard : dashboard;
Object.assign(window, { originalDepthStructure: host.innerHTML });
