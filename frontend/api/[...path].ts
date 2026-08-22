/**
 * Same-origin proxy for the API, so the browser only ever talks to this host.
 *
 * ★ THIS EXISTS BECAUSE OF THE SESSION COOKIE, not for convenience. The backend
 * issues `bo_session` as HttpOnly, Secure, SameSite=Strict. Calling the VPS
 * directly from the browser would be cross-site, and a Strict cookie is not
 * sent cross-site — the user would log in successfully and be anonymous on the
 * next request. Proxying keeps every request on the Vercel origin, so the
 * cookie is same-site by construction and CORS never enters the picture.
 *
 * ★ AND IT IS A FUNCTION RATHER THAN A `vercel.json` REWRITE because the
 * destination has to come from an environment variable. Vercel does not
 * interpolate environment variables inside `vercel.json` — a rewrite
 * destination is a literal — so the backend origin would have to be committed.
 * It changes (a quick tunnel today, a domain later), and a URL in git that
 * moves every restart is a redeploy waiting to be forgotten.
 *
 * ★ THE `/api` PREFIX IS FORWARDED, NOT STRIPPED. nginx on the VPS is what
 * removes it (`proxy_pass http://upstream/`), and the app underneath has no
 * global prefix. Strip it here as well and every request arrives as `//health`.
 */

export const config = { runtime: 'edge' };

/** Set in the Vercel project, never committed. e.g. https://opsystem.example.com */
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN;

/**
 * Headers that describe THIS hop and must not be replayed to the next one.
 * `host` in particular: forwarding it would ask the VPS to serve a vercel.app
 * vhost it has never heard of.
 */
const HOP_BY_HOP = ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'];

export default async function handler(request: Request): Promise<Response> {
  if (!BACKEND_ORIGIN) {
    // A 502 rather than a crash: this is the deployment being unconfigured, and
    // saying so beats a stack trace in a function log nobody is watching.
    return Response.json(
      { error: { code: 'BACKEND_UNAVAILABLE', message: 'BACKEND_ORIGIN is not set.' } },
      { status: 502 },
    );
  }

  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, BACKEND_ORIGIN);

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);

  // Buffered rather than streamed: a streaming body needs `duplex: 'half'`,
  // which is not in the fetch types here and would cost a suppression. Bodies
  // on this API are small JSON — nginx caps them at 2 MB.
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer();

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    // The backend answers 401/403/409 as data, and a redirect it does issue is
    // the caller's to see. Following one here would hide it.
    redirect: 'manual',
  });

  // Constructed from the upstream headers so `Set-Cookie` survives intact —
  // including more than one of them, which a naive object copy flattens.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
