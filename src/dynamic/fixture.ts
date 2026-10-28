import { createServer, type Server } from 'node:http';
import type { LocalRequest } from './types.js';

export const DUMMY_MARKER = 'XINSPECT_DUMMY_DATA_12345';
const MAX_REQUESTS = 2000;
const MAX_BODY = 64 * 1024;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>XInspect controlled test</title>
<link rel="icon" href="data:,"><style>body{font:18px system-ui;max-width:800px;margin:60px auto;padding:20px;background:#fff;color:#17202a}input,button{font:inherit;padding:8px;margin:8px}#result{padding:12px;background:#edf4fa}</style></head>
<body><h1>XInspect controlled test page</h1><p>This page contains only synthetic test data.</p>
<p id="marker">${DUMMY_MARKER}</p><label>Test field <input id="test-field" value=""></label>
<button id="test-button">Run test action</button><p id="result">Waiting for test action</p>
<script>document.querySelector('#test-button').addEventListener('click',()=>{document.querySelector('#result').textContent='Test action completed';});</script></body></html>`;

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine local server port');
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

export async function startFixture(port: number) {
  let requests: LocalRequest[] = [];
  let dropped = false;
  const server = createServer((req, res) => {
    // No user-supplied files are served. The listener is bound to IPv4 loopback.
    let body = Buffer.alloc(0);
    let truncated = false;
    req.on('data', (chunk: Buffer) => {
      const room = MAX_BODY - body.length;
      if (chunk.length > room) truncated = true;
      if (room > 0) body = Buffer.concat([body, chunk.subarray(0, room)]);
    });
    req.on('end', () => {
      if (requests.length < MAX_REQUESTS) requests.push({ method: req.method ?? '', path: (req.url ?? '').slice(0, 2048), body: body.toString('utf8'), truncated });
      else dropped = true;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); }
      else if (req.url === '/test-page.html' || req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE); }
      else if (req.url === '/observe') { res.setHeader('Content-Type', 'text/plain'); res.end('received synthetic test data'); }
      else { res.writeHead(404); res.end('not found'); }
    });
    req.on('error', () => res.destroy());
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  const boundPort = await listen(server, port);
  return {
    origin: `http://127.0.0.1:${boundPort}`,
    requests: () => [...requests],
    truncated: () => dropped,
    reset: () => { requests = []; dropped = false; },
    close: () => close(server)
  };
}

// Defense in depth for ordinary HTTP(S) traffic. This is not OS-level isolation:
// untrusted extensions still require an isolated VM and network restrictions.
export async function startDenyProxy() {
  let attempts: string[] = [];
  let dropped = false;
  const add = (url: string) => { if (attempts.length < MAX_REQUESTS) attempts.push(url.slice(0, 2048)); else dropped = true; };
  const server = createServer((req, res) => { add(req.url ?? ''); res.writeHead(403); res.end('XInspect blocks external HTTP requests'); });
  const tunnels = new Set<import('node:stream').Duplex>();
  server.on('connect', (req, socket) => {
    add(`CONNECT ${req.url ?? ''}`);
    tunnels.add(socket);
    socket.once('close', () => tunnels.delete(socket));
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  const port = await listen(server, 0);
  return { port, attempts: () => [...attempts], truncated: () => dropped, reset: () => { attempts = []; dropped = false; }, close: async () => { for (const socket of tunnels) socket.destroy(); await close(server); } };
}

export function allowedRequest(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return (!parsed.username && !parsed.password && parsed.origin === origin) || ['moz-extension:', 'about:', 'data:'].includes(parsed.protocol);
  } catch { return false; }
}
