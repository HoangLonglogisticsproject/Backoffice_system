import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { toApiError } from '@/utils/errors';

/**
 * The only place that talks HTTP.
 *
 * Two things are set here and nowhere else, because both are the kind of rule
 * that breaks by being forgotten at one call site rather than by being wrong:
 *
 *   withCredentials   the session is an HttpOnly cookie (contract §1). There is
 *                     no token to attach and nothing to read from JavaScript,
 *                     so a request that omits this is simply anonymous.
 *
 *   CSRF header       by METHOD, not by endpoint (contract §2). The guard looks
 *                     at the method, so a per-endpoint list is a list somebody
 *                     eventually forgets to add to — and the symptom is a 403
 *                     that looks like a permission bug.
 *
 * ⚠ NO AUTHORIZATION LOGIC LIVES HERE. This layer does not redirect, does not
 * inspect permissions and does not decide what a 403 means — see the note on
 * the response interceptor below.
 */

/** Contract §2: everything that is not one of these is a mutation. */
const SAFE_METHODS = new Set(['get', 'head', 'options']);

export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';

export const httpClient = axios.create({
  // Same-origin by default: production serves the client and the API from one
  // origin, which is also why CORS is off there. Development points this at the
  // API's own port.
  baseURL: import.meta.env.VITE_API_URL ?? '',

  // The session cookie, and the only credential that exists.
  withCredentials: true,

  headers: { 'Content-Type': 'application/json' },
});

httpClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const method = (config.method ?? 'get').toLowerCase();

  if (!SAFE_METHODS.has(method)) {
    config.headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
  }

  return config;
});

/**
 * Turns every failure into an `ApiError` and stops.
 *
 * ⚠ IT DOES NOT REDIRECT, and that is the whole point of this file.
 *
 * The obvious interceptor — `if (status === 401 || status === 403) go to login`
 * — locks a user out permanently. Somebody with a temporary credential logs in
 * successfully, `/authorization/me` answers 403 PASSWORD_CHANGE_REQUIRED, the
 * interceptor sends them back to login, they log in again, and it happens
 * again. The only way out is the change-password screen the interceptor never
 * lets them reach. Contract §3b describes this loop and forbids it.
 *
 * So transport reports; the session layer decides. The three answers are not
 * distinguishable by status alone — two of them are 403 — and telling them
 * apart needs `code`, which is a session concern, not a transport one.
 */
httpClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response) {
      return Promise.reject(
        toApiError(
          error.response.status,
          error.response.data,
          error.response.headers?.['retry-after'] as string | undefined,
        ),
      );
    }

    // No response at all: network down, DNS, CORS preflight refused. Status 0
    // rather than a made-up 500, so a caller can tell "server said no" from
    // "never reached the server".
    return Promise.reject(toApiError(0, undefined));
  },
);
