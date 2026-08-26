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
 *
 * ⚠ `BACKEND_ORIGIN` IS READ ONCE, AT MODULE LOAD. That is how a serverless
 * runtime works — the value is fixed for the life of the isolate — so changing
 * it in the Vercel project requires a REDEPLOY, not just a save. Left as is on
 * purpose: reading it per request would suggest a liveness this platform does
 * not offer.
 */

export const config = { runtime: 'edge' };

/**
 * How long to wait for the VPS before giving up.
 *
 * Without a bound, a backend that accepts the connection and then says nothing
 * — a tunnel that dropped, most likely — holds the function open until the
 * platform kills it, and the caller gets a Vercel error page instead of an
 * error they can read. Overridable so ops can tighten it, and so the specs can
 * exercise the timeout without waiting fifteen seconds for it.
 */
const TIMEOUT_MS = Number(process.env.BACKEND_TIMEOUT_MS) || 15_000;

/**
 * Headers that describe THIS hop and must not be replayed to the next one.
 * `host` in particular: forwarding it would ask the VPS to serve a vercel.app
 * vhost it has never heard of.
 */
const HOP_BY_HOP = ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'];

/**
 * ★ WHO THE CALLER IS, IS NOT THE CALLER'S TO SAY.
 *
 * These are set BY a proxy, about the hop it just handled. A browser that sends
 * them is not describing reality, it is proposing one — and nginx on the VPS
 * appends to `X-Forwarded-For` rather than replacing it, so anything arriving
 * here would be carried forward as though this proxy had vouched for it.
 *
 * That matters because the login throttle keys on `req.ip`. Whether a forged
 * entry actually reaches `req.ip` depends on `TRUSTED_PROXIES` being exactly
 * right on the far side; this removes the question instead of relying on the
 * answer. `Forwarded` in particular is not overwritten by anything downstream,
 * so without this it would arrive at the application verbatim.
 *
 * The correct values are added by the hop that can actually observe them —
 * nginx, from its own socket.
 */
const FORWARDING_IDENTITY = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
];

type Resolved = { origin: string } | { configError: string };

/**
 * ★ AN ORIGIN, NOT A URL. `new URL('/api/health', base)` resolves against the
 * base's ORIGIN — any path on the base is silently discarded, so
 * `https://host/base` would quietly become `https://host/api/health` and the
 * misconfiguration would look like a routing bug for as long as it took
 * somebody to read this file.
 *
 * Refused up front instead. The messages name the RULE and never echo the
 * value: this text reaches a browser, and the backend address is not something
 * to hand out in an error body.
 */
function resolveOrigin(raw: string | undefined): Resolved {
  if (!raw || raw.trim() === '') {
    return { configError: 'BACKEND_ORIGIN is not set.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { configError: 'BACKEND_ORIGIN is not a valid absolute URL.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { configError: 'BACKEND_ORIGIN must be an http(s) URL.' };
  }
  if (parsed.pathname !== '/') {
    return { configError: 'BACKEND_ORIGIN must be an origin only, with no path.' };
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    return { configError: 'BACKEND_ORIGIN must not carry a query string or fragment.' };
  }

  // `.origin` drops the trailing slash and anything else normalisable, so the
  // value used downstream is exactly scheme + host + port.
  return { origin: parsed.origin };
}

const BACKEND = resolveOrigin(process.env.BACKEND_ORIGIN);

/** The shape `toApiError` on the client already parses: `{ error: { code, message } }`. */
const fail = (code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { status: 502 });

export default async function handler(request: Request): Promise<Response> {
  if ('configError' in BACKEND) {
    // Distinct from an outage on purpose: this one is fixed in the Vercel
    // project, not on the VPS, and they are different people at 3am.
    return fail('BACKEND_MISCONFIGURED', BACKEND.configError);
  }

  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, BACKEND.origin);

  const headers = new Headers(request.headers);

  // ★ ORDER MATTERS: `Connection` names further headers as hop-by-hop, so its
  // value has to be read before it is itself deleted. Read after, and every
  // header it nominated travels on.
  const nominated = (headers.get('connection') ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== '');

  for (const name of FORWARDING_IDENTITY) headers.delete(name);
  for (const name of nominated) headers.delete(name);
  for (const name of HOP_BY_HOP) headers.delete(name);

  // Buffered rather than streamed: a streaming body needs `duplex: 'half'`,
  // which is not in the fetch types here and would cost a suppression. Bodies
  // on this API are small JSON — nginx caps them at 2 MB.
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      // The backend answers 401/403/409 as data, and a redirect it does issue is
      // the caller's to see. Following one here would hide it.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // ★ EVERY failure mode, one answer. A refused connection is a `TypeError`, a
    // timeout is a `TimeoutError` DOMException, DNS is another — and none of
    // them is worth telling a browser about in detail, because the details are
    // the backend's address and its network topology. Caught without inspecting
    // so nothing from the error can escape into the response.
    return fail('BACKEND_UNAVAILABLE', 'The API is not reachable right now.');
  }

  // Constructed from the upstream headers so `Set-Cookie` survives intact —
  // including more than one of them, which a naive object copy flattens.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
