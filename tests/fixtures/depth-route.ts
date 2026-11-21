import { dashboard } from "./depth-dashboard";

const host = document.querySelector("#route-dashboard")!;
host.innerHTML = dashboard;
Object.assign(window, { originalDepthStructure: host.innerHTML });
