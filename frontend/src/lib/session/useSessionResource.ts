import { useEffect, useState } from 'react';
import { ApiError, isApiError } from '../http/apiError';
import { useSession } from './SessionProvider';

/**
 * Runs a read ONLY while the session is `ready`, and reports what came back.
 *
 * The gate is the point. An `anonymous` session has no cookie, so the request
 * would be a guaranteed 401; a `password-change-required` session is refused
 * everything except the four identity endpoints (§12), so it would be a
 * guaranteed 403. Firing either produces noise that looks like a permission
 * problem and is really a sequencing one — and on the second it would push a
 * 403 through the app while the user is already on their way to the change
 * password screen.
 *
 * ⚠ A 403 IS A RESULT, NOT AN ACCIDENT. `GET /departments/:id/members` answers
 * 403 to an ordinary member by design (§6), and `GET /departments/:id` answers
 * 403 for somebody else's department (§5). Both are normal outcomes that the
 * screen renders. This hook therefore hands the error back and never signs
 * anybody out — that decision belongs to the session layer, and only a 401
 * warrants it.
 *
 * Deliberately NOT a cache. There is one reader per resource today, so a cache
 * would be a second source of truth to invalidate for no benefit. When a second
 * reader appears, that is the moment to reach for a query library — not before.
 */
export interface SessionResource<T> {
  data: T | null;
  error: ApiError | null;
  /** True while a request is in flight, or while the session is still resolving. */
  loading: boolean;
  /** Convenience for the common branch: the server said no, and re-login will not help. */
  forbidden: boolean;
  /** The resource does not exist, or is not visible enough to distinguish. */
  notFound: boolean;
}

export function useSessionResource<T>(
  read: () => Promise<T>,
  /**
   * Values the read depends on. Same contract as `useEffect` deps — the read is
   * re-run when they change, so a screen that switches department gets the new
   * one rather than the first.
   */
  deps: readonly unknown[],
): SessionResource<T> {
  const { state, loading: sessionLoading } = useSession();
  const ready = state?.status === 'ready';

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;

    if (!ready) {
      // Not an error: the session simply is not in a state where this read
      // means anything. `RequireSession` is already routing the user
      // elsewhere, and firing the request would only add a misleading 401/403.
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Guards against a slower earlier response overwriting a newer one when
    // the deps change mid-flight.
    let current = true;
    setLoading(true);

    read()
      .then((result) => {
        if (!current) return;
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!current) return;
        setData(null);
        // Anything that is not an ApiError never passed through the transport
        // layer, so it is a programming fault rather than a server answer.
        setError(isApiError(caught) ? caught : new ApiError(0, undefined, 'Unexpected error.'));
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
    // `read` is intentionally not a dependency: it is a fresh closure on every
    // render, and depending on it would re-fetch forever. `deps` is what the
    // caller declares the read actually varies with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sessionLoading, ...deps]);

  return {
    data,
    error,
    loading: loading || sessionLoading,
    forbidden: error?.status === 403,
    notFound: error?.status === 404,
  };
}
