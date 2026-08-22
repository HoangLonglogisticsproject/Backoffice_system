// @vitest-environment node
//
// Node, not jsdom. This file tests an Edge function — a server, with no DOM in
// sight — and the default jsdom environment actively breaks it: a jsdom
// `AbortSignal` handed to undici's `fetch` is a cross-realm object it refuses,
// which the proxy's catch-all then reports as an outage. Every forwarding spec
// failed with 502 until this line existed.

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The proxy's own logic, against a stub origin.
 *
 * Not the backend — what can break here is the proxy: dropping the `/api`
 * prefix, replaying `host` to the wrong vhost, flattening `Set-Cookie` so the
 * session never reaches the browser, or turning an outage into a platform error
 * page the client cannot parse. A stub answers all of those and needs no
 * database.
 */
interface Seen {
  url: string;
  method: string;
  host: string | undefined;
  cookie: string | undefined;
  body: string;
}

let server: Server;
let origin: string;
let seen: Seen;

/** A port nothing listens on, for the connection-refused case. */
const DEAD_ORIGIN = 'http://127.0.0.1:1';

/** Accepts the connection and then never answers, for the timeout case. */
let blackhole: Server;
let blackholeOrigin: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen = {
        url: request.url ?? '',
        method: request.method ?? '',
        host: request.headers.host,
        cookie: request.headers.cookie,
        body: Buffer.concat(chunks).toString(),
      };

      if (request.url?.startsWith('/api/conflict')) {
        response.writeHead(409, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'CONFLICT', message: 'nope' } }));
        return;
      }
      if (request.url?.startsWith('/api/redirect')) {
        response.writeHead(302, { location: '/somewhere' });
        response.end();
        return;
      }

      response.writeHead(200, {
        'content-type': 'application/json',
        // Two of them, which is what a naive header copy loses.
        'set-cookie': ['bo_session=abc; HttpOnly; Secure; SameSite=Strict', 'other=1'],
      });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  origin = `http://127.0.0.1:${address.port}`;

  blackhole = createServer(() => {
    // Deliberately no response: this is a tunnel that dropped after connecting.
  });
  await new Promise<void>((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
  const black = blackhole.address();
  if (black === null || typeof black === 'string') throw new Error('no port');
  blackholeOrigin = `http://127.0.0.1:${black.port}`;
});

afterAll(() => {
  server.close();
  blackhole.close();
});

beforeEach(() => {
  process.env.BACKEND_ORIGIN = origin;
  delete process.env.BACKEND_TIMEOUT_MS;
});

/**
 * Imported AFTER the environment is set: the module reads it once, at load time.
 * `resetModules` is what makes a second import see a different environment — a
 * cache-busting query string would work at runtime and fail `tsc`.
 */
const load = async () => {
  vi.resetModules();
  return (await import('./[...path]')).default;
};

const errorOf = async (response: Response) =>
  (await response.json()) as { error: { code: string; message: string } };

describe('the Vercel API proxy', () => {
  describe('forwarding', () => {
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

    it('★ sends the POST body byte for byte', async () => {
      const handler = await load();
      const payload = JSON.stringify({ subject: 'uyen@hoanglonglti.com', password: 'x' });

      await handler(
        new Request('https://demo.vercel.app/api/auth/login', {
          method: 'POST',
          body: payload,
          headers: { 'content-type': 'application/json' },
        }),
      );

      expect(seen.method).toBe('POST');
      expect(seen.body).toBe(payload);
    });

    it.each(['PATCH', 'DELETE'])('passes %s through unchanged', async (method) => {
      const handler = await load();
      await handler(
        new Request('https://demo.vercel.app/api/users/1/status', {
          method,
          body: method === 'DELETE' ? undefined : '{"status":"disabled"}',
        }),
      );

      expect(seen.method).toBe(method);
      expect(seen.url).toBe('/api/users/1/status');
    });
  });

  describe('responses', () => {
    it('★ returns BOTH Set-Cookie headers, not one flattened value', async () => {
      const handler = await load();
      const response = await handler(new Request('https://demo.vercel.app/api/health'));

      const cookies = response.headers.getSetCookie();
      expect(cookies).toHaveLength(2);
      expect(cookies[0]).toContain('bo_session=abc');
      expect(cookies[0]).toContain('SameSite=Strict');
    });

    it('passes a 409 through with its error envelope intact', async () => {
      // The client branches on `code`; swallowing the status would turn a
      // conflict into an unexplained failure.
      const handler = await load();
      const response = await handler(new Request('https://demo.vercel.app/api/conflict'));

      expect(response.status).toBe(409);
      expect((await errorOf(response)).error.code).toBe('CONFLICT');
    });

    it('passes a 302 through with Location, without following it', async () => {
      const handler = await load();
      const response = await handler(new Request('https://demo.vercel.app/api/redirect'));

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/somewhere');
    });
  });

  // ------------------------------------------------------- the outage path --

  describe('★ when the backend cannot answer', () => {
    /**
     * Before this existed, `fetch` rejected and nothing caught it: Vercel
     * answered 500 FUNCTION_INVOCATION_FAILED, an HTML platform page. The
     * client's `toApiError` cannot parse that, so an outage surfaced as an
     * unexplained failure rather than as an error with a code.
     */
    it('answers 502 BACKEND_UNAVAILABLE when the connection is refused', async () => {
      process.env.BACKEND_ORIGIN = DEAD_ORIGIN;
      const handler = await load();

      const response = await handler(new Request('https://demo.vercel.app/api/health'));

      expect(response.status).toBe(502);
      expect((await errorOf(response)).error.code).toBe('BACKEND_UNAVAILABLE');
    });

    it('answers 502 BACKEND_UNAVAILABLE when the backend never replies', async () => {
      // A tunnel that accepted the connection and then went away. Without the
      // timeout this holds the function open until the platform kills it.
      process.env.BACKEND_ORIGIN = blackholeOrigin;
      process.env.BACKEND_TIMEOUT_MS = '250';
      const handler = await load();

      const started = Date.now();
      const response = await handler(new Request('https://demo.vercel.app/api/health'));
      const elapsed = Date.now() - started;

      expect(response.status).toBe(502);
      expect((await errorOf(response)).error.code).toBe('BACKEND_UNAVAILABLE');
      // It gave up on its own rather than hanging.
      expect(elapsed).toBeLessThan(5_000);
    });

    it('★ says nothing about WHERE the backend is', async () => {
      // The message reaches a browser. The backend's address is not something
      // to hand out in an error body, and neither is the underlying cause.
      process.env.BACKEND_ORIGIN = DEAD_ORIGIN;
      const handler = await load();

      const body = JSON.stringify(await (await handler(
        new Request('https://demo.vercel.app/api/health'),
      )).json());

      expect(body).not.toContain('127.0.0.1');
      expect(body).not.toContain('ECONNREFUSED');
      expect(body).not.toMatch(/fetch failed/i);
    });
  });

  // ------------------------------------------------- the configuration path --

  describe('★ BACKEND_ORIGIN must be an origin', () => {
    /**
     * `new URL('/api/health', base)` resolves against the base's ORIGIN, so any
     * path on the base is silently discarded — `https://host/base` would become
     * `https://host/api/health` and look like a routing bug for as long as it
     * took somebody to read the proxy. Refused up front instead.
     */
    it.each([
      ['https://api.example.com', 'scheme and host'],
      ['https://api.example.com/', 'a bare trailing slash'],
      ['https://api.example.com:8443', 'an explicit port'],
    ])('accepts %s — %s', async (value) => {
      process.env.BACKEND_ORIGIN = value;
      const handler = await load();

      // Reaching the network at all means configuration was accepted; the
      // request then fails as an outage, which is a different code.
      const response = await handler(new Request('https://demo.vercel.app/api/health'));
      expect((await errorOf(response)).error.code).not.toBe('BACKEND_MISCONFIGURED');
    });

    it.each([
      ['https://api.example.com/api', 'a path that would double the prefix'],
      ['https://api.example.com/base', 'an arbitrary path'],
      ['https://api.example.com/?x=1', 'a query string'],
      ['https://api.example.com/#frag', 'a fragment'],
      ['api.example.com', 'no scheme at all'],
      ['ftp://api.example.com', 'a scheme that is not http(s)'],
      ['', 'an empty value'],
    ])('REFUSES %s — %s', async (value) => {
      process.env.BACKEND_ORIGIN = value;
      const handler = await load();

      const response = await handler(new Request('https://demo.vercel.app/api/health'));

      expect(response.status).toBe(502);
      expect((await errorOf(response)).error.code).toBe('BACKEND_MISCONFIGURED');
    });

    it('reports a missing variable as configuration, not as an outage', async () => {
      delete process.env.BACKEND_ORIGIN;
      const handler = await load();

      const response = await handler(new Request('https://demo.vercel.app/api/health'));
      const { error } = await errorOf(response);

      expect(response.status).toBe(502);
      expect(error.code).toBe('BACKEND_MISCONFIGURED');
      // Fixed in the Vercel project, not on the VPS — different people.
      expect(error.message).toContain('BACKEND_ORIGIN');
    });
  });
});
