// Flow Builder's server: static files at the root of flow.repo.lv and a health check. Nothing else.
// The builder runs entirely in the browser, so there is no API, no upload and no state here.
// Zero dependencies — node:http, node:fs and node:zlib only — so the image carries no node_modules.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib';

const BASE = '/';
const PORT = Number(process.env.PORT) || 3105;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);

// The page loads /theme.css from the shell on the same origin; everything else is self-hosted.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** In-memory cache of files and their compressed variants. dist/ is immutable per image. */
const cache = new Map();
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
let cachedBytes = 0;

async function load(absPath) {
  const hit = cache.get(absPath);
  if (hit) return hit;
  const info = await stat(absPath);
  if (!info.isFile()) return null;
  const body = await readFile(absPath);
  const ext = extname(absPath);
  const entry = { body, ext, gz: null, br: null };
  if (COMPRESSIBLE.has(ext) && body.length > 512) {
    entry.gz = gzipSync(body, { level: 9 });
    entry.br = brotliCompressSync(body, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } });
  }
  const size = body.length + (entry.gz?.length ?? 0) + (entry.br?.length ?? 0);
  if (cachedBytes + size <= MAX_CACHE_BYTES) {
    cache.set(absPath, entry);
    cachedBytes += size;
  }
  return entry;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

const notFound = (res) => send(res, 404, 'Not found\n', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });

export async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad request\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  if (BASE !== '/' && (pathname === '/' || pathname === BASE.slice(0, -1))) {
    return send(res, 308, '', { Location: BASE, 'Cache-Control': 'no-store' });
  }
  if (pathname === `${BASE}healthz`) {
    return send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  }
  if (!pathname.startsWith(BASE) || pathname.includes('\0')) return notFound(res);

  const rel = pathname.slice(BASE.length) || 'index.html';
  const abs = normalize(join(ROOT, rel));
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return notFound(res);

  let entry;
  try {
    entry = await load(abs);
  } catch {
    entry = null;
  }
  if (!entry) return notFound(res);

  const hashed = rel.startsWith('assets/');
  const headers = {
    'Content-Type': TYPES[entry.ext] ?? 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    Vary: 'Accept-Encoding',
  };
  const accept = String(req.headers['accept-encoding'] ?? '');
  let body = entry.body;
  if (entry.br && /\bbr\b/.test(accept)) {
    body = entry.br;
    headers['Content-Encoding'] = 'br';
  } else if (entry.gz && /\bgzip\b/.test(accept)) {
    body = entry.gz;
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(200, { ...SECURITY_HEADERS, ...headers, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function start(port = PORT, host = HOST) {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, 'Internal error\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      else res.destroy();
    });
  });
  // Static files only: short timeouts keep slow-loris style connections from piling up.
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  return server.listen(port, host, () => console.log(`flow: listening on http://${host}:${port}${BASE}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = start();
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}
