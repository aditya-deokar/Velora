// A non-React fixture site for any-site mode: static multi-page HTML with absolute asset paths, a WebSocket echo
// (like a dev server's HMR channel), frame-blocking headers and an off-machine redirect route.
// Usage: node server.mjs <port>   Prints "ready <port>" once listening.
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const port = Number(process.argv[2] ?? 4399);
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="/assets/site.css"></head><body><nav><a href="/">Home</a> <a href="/pricing">Pricing</a> <a href="/docs/start">Docs</a></nav>
<main><img src="/assets/logo.svg" width="64" height="64" alt="Orbit logo"><h1>${title}</h1>${body}</main></body></html>`;
const sections = (n) => Array.from({ length: n }, (_, i) => `<section class="band band-${i % 3}"><h2>Section ${i + 1}</h2><p>Plain HTML from a non-React server, framed through the Velora studio proxy.</p></section>`).join("");
const routes = {
  "/": () => page("Orbit — ship faster", `<p class="lede">Static pages, no React.</p>${sections(8)}`),
  "/pricing": () => page("Pricing", `<div class="plans"><div>Starter $0</div><div>Team $29</div><div>Scale $99</div></div>${sections(3)}`),
  "/docs/start": () => page("Getting started", `<ol><li>Install</li><li>Configure</li><li>Launch</li></ol>${sections(4)}`),
};
const css = `body{margin:0;font:18px/1.5 system-ui,sans-serif;background:#0e1116;color:#e8edf2}nav{padding:16px 32px;background:#161b22}nav a{color:#7ee0b5;margin-right:16px}
main{padding:32px}h1{font-size:56px;margin:12px 0}.lede{font-size:24px;color:#9aa4ae}.band{padding:48px;margin:16px 0;border-radius:16px}
.band-0{background:#1d2633}.band-1{background:#22303f}.band-2{background:#192029}.plans{display:flex;gap:16px}.plans div{padding:32px;background:#2f81f7;border-radius:12px;font-size:28px}`;
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#7ee0b5"/><circle cx="32" cy="32" r="12" fill="#0e1116"/></svg>`;

const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const frameHeaders = { "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'; default-src 'self' 'unsafe-inline'" };
  if (url.pathname === "/assets/site.css") return void response.writeHead(200, { "content-type": "text/css" }).end(css);
  if (url.pathname === "/assets/logo.svg") return void response.writeHead(200, { "content-type": "image/svg+xml" }).end(logo);
  if (url.pathname === "/away") return void response.writeHead(302, { location: "https://example.com/" }).end();
  if (url.pathname === "/health") return void response.writeHead(200, { "content-type": "text/plain" }).end("ok");
  const route = routes[url.pathname];
  if (!route) return void response.writeHead(404, { "content-type": "text/plain" }).end("not found");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", ...frameHeaders }).end(route());
});
// Minimal RFC 6455 echo for one text frame per message (fixture only).
server.on("upgrade", (request, socket) => {
  if (request.url !== "/ws") return socket.destroy();
  const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on("data", (buffer) => {
    const length = buffer[1] & 0x7f, mask = buffer.subarray(2, 6), payload = buffer.subarray(6, 6 + length);
    const text = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4])).toString();
    const reply = Buffer.from(`echo:${text}`);
    socket.write(Buffer.concat([Buffer.from([0x81, reply.length]), reply]));
  });
});
server.listen(port, "127.0.0.1", () => console.log(`ready ${port}`));
