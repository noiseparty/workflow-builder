import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo, Server } from 'node:net';
// @ts-expect-error — plain ESM server, no type declarations
import { start } from '../server/server.mjs';

let server: Server;
let base = '';

beforeAll(async () => {
  server = start(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = (path: string, init?: RequestInit) => fetch(base + path, { redirect: 'manual', ...init });

describe('server', () => {
  it('answers the health check', async () => {
    const r = await get('/demo/flow/healthz');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
  });

  it('redirects / and the bare base path to /demo/flow/', async () => {
    for (const p of ['/', '/demo/flow']) {
      const r = await get(p);
      expect(r.status).toBe(308);
      expect(r.headers.get('location')).toBe('/demo/flow/');
    }
  });

  it('refuses writes, paths outside the base and traversal', async () => {
    expect((await get('/demo/flow/', { method: 'POST', body: 'x' })).status).toBe(405);
    expect((await get('/elsewhere')).status).toBe(404);
    expect((await get('/demo/flow/..%2f..%2fpackage.json')).status).toBe(404);
    expect((await get('/demo/flow/%E0%A4%A')).status).toBe(400);
  });

  it('sends security headers', async () => {
    const r = await get('/demo/flow/healthz');
    expect(r.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
