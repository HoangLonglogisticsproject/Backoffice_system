import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The proxy's own logic, against a stub origin.
 *
 * Not the backend — what can break here is the proxy: dropping the `/api`
 * prefix, replaying `host` to the wrong vhost, or flattening `Set-Cookie` so
 * the session never reaches the browser. A stub answers all three and needs no
 * database.
 */
interface Seen {
  url: string;
  method: string;
  host: string | undefined;
  cookie: string | undefined;
}

let server: Server;
let origin: string;
let seen: Seen;

beforeAll(async () => {
  server = createServer((request, response) => {
    seen = {
      url: request.url ?? '',
      method: request.method ?? '',
      host: request.headers.host,
      cookie: request.headers.cookie,
    };
    response.writeHead(200, {
      'content-type': 'application/json',
      // Two of them, which is what a naive header copy loses.
      'set-cookie': ['bo_session=abc; HttpOnly; Secure; SameSite=Strict', 'other=1'],
    });
    response.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  origin = `http://127.0.0.1:${address.port}`;
  process.env.BACKEND_ORIGIN = origin;
});

afterAll(() => {
  server.close();
});

/**
 * Imported AFTER the env var is set: the module reads it once, at load time.
 * `resetModules` is what makes a second import see a different environment —
 * a cache-busting query string would work at runtime and fail `tsc`.
 */
const load = async () => {
  vi.resetModules();
  return (await import('./[...path]')).default;
};

describe('the Vercel API proxy', () => {
  it('★ FORWARDS the /api prefix — nginx is what strips it', async () => {
    const handler = await load();
    await handler(new Request('https://demo.vercel.app/api/health'));

    // Not `/health`. Stripping here too would arrive at the VPS as `//health`.
    expect(seen.url).toBe('/api/health');
  });

  it('keeps the query string', async () => {
    const handler = await load();
    await handler(new Request('https://demo.vercel.app/api/departments?limit=2'));

    expect(seen.url).toBe('/api/departments?limit=2');
  });

  it('★ does NOT replay the vercel.app Host to the origin', async () => {
    const handler = await load();
    await handler(new Request('https://demo.vercel.app/api/health'));

    // Forwarding it would ask the VPS for a vhost it has never heard of.
    expect(seen.host).not.toContain('vercel.app');
    expect(seen.host).toContain('127.0.0.1');
  });

  it('carries the session cookie upstream', async () => {
    const handler = await load();
    await handler(
      new Request('https://demo.vercel.app/api/authorization/me', {
        headers: { cookie: 'bo_session=xyz' },
      }),
    );

    expect(seen.cookie).toBe('bo_session=xyz');
  });

  it('★ returns BOTH Set-Cookie headers, not one flattened value', async () => {
    const handler = await load();
    const response = await handler(new Request('https://demo.vercel.app/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ subject: 'a@b.c', password: 'x' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(seen.method).toBe('POST');
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('bo_session=abc');
    expect(cookies[0]).toContain('SameSite=Strict');
  });

  it('answers 502 when the deployment has no BACKEND_ORIGIN', async () => {
    // A missing variable is the deployment being unconfigured; saying so beats
    // a stack trace in a log nobody is watching.
    delete process.env.BACKEND_ORIGIN;
    const fresh = await load();
    const response = await fresh(new Request('https://demo.vercel.app/api/health'));

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('BACKEND_UNAVAILABLE');

    process.env.BACKEND_ORIGIN = origin;
  });
});
