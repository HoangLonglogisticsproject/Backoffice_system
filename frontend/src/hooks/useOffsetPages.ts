import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/SessionProvider';
import { ApiError, isApiError } from '@/utils/errors';
import type { OffsetPage, OffsetPageRequest } from '@/types/pagination';

export interface OffsetPages<T> {
  data: OffsetPage<T> | null;
  error: ApiError | null;
  /** True while a request is in flight, or while the session is still resolving. */
  loading: boolean;
  forbidden: boolean;
  notFound: boolean;

  items: T[];
  /** 1-based, and what the controls display. */
  page: number;
  goToPage: (page: number) => void;
  next: () => void;
  previous: () => void;
  /** Rows in the whole filtered range, not on this page. */
  total: number;
  totalPages: number;
  pageSize: number;
  setPageSize: (size: number) => void;
  /**
   * The ordinal of the first row on screen, 1-based, for the `STT` column the
   * spreadsheet had. `0` when the page is empty.
   */
  firstRowNumber: number;
  /**
   * The rows on screen are the PREVIOUS page's, held while this one loads.
   * For dimming the table rather than emptying it.
   */
  showingPreviousPage: boolean;
}

export interface OffsetPagesOptions {
  initialPageSize?: number;
  /** An extra gate on top of the session one — for a list behind a tab. */
  enabled?: boolean;
  /** How long a fetched page stays fresh. Defaults to the client's own. */
  staleTime?: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Walks a page-numbered list.
 *
 * ★ THE TWIN OF `useCursorPages`, AND NOT A REPLACEMENT FOR IT. Exactly one
 * endpoint returns this envelope — `GET /trip-schedules` — because its
 * mandatory date range bounds the result set, which is what makes an offset and
 * a `COUNT(*)` affordable there and nowhere else (ADR-0003). Every other list
 * stays on cursors. Reaching for this hook for a new list is almost certainly
 * the wrong call.
 *
 * What it can do that the cursor hook cannot, and the only reason it exists:
 * jump straight to a page, and say how many rows there are in total.
 *
 * ★ CACHED, AND THAT IS THE POINT OF THE `queryKey` ARGUMENT. Page-numbered
 * navigation is the one access pattern that revisits the SAME page over and
 * over — forward, back, forward again — and the earlier version re-read every
 * one of those from the server. The key identifies the list; the page and size
 * are appended here, so each page is cached on its own and going back is
 * instant.
 *
 * ★ AND THE OLD PAGE STAYS ON SCREEN WHILE THE NEXT ONE LOADS
 * (`keepPreviousData`). Without it every page change empties the table for the
 * duration of a round trip, which reads as "there are no trips" and makes the
 * whole screen flash on a slow connection.
 */
export function useOffsetPages<T>(
  /**
   * What identifies the LIST — the filters, not the position in it. Changing
   * any part of it resets to page one; see below for why that is not optional.
   */
  queryKey: readonly unknown[],
  read: (request: OffsetPageRequest) => Promise<OffsetPage<T>>,
  options: OffsetPagesOptions = {},
): OffsetPages<T> {
  const { state, loading: sessionLoading } = useSession();
  const ready = state?.status === 'ready';

  const [pageSize, setPageSize] = useState(options.initialPageSize ?? DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const walk = JSON.stringify(queryKey);
  const [currentWalk, setCurrentWalk] = useState(walk);

  // ★ RESET DURING RENDER, NOT IN AN EFFECT — the same reasoning as
  // `useCursorPages`. An effect runs AFTER the render that changed the filter,
  // so the hook would first fire a request for "page 5 of the NEW date range",
  // then reset and fire the real one: two requests, the first of them wrong and
  // very likely empty. Adjusting state while rendering is React's documented
  // answer, and the stale render never reaches the read.
  //
  // Without this, narrowing the range from a year to a week while sitting on
  // page 5 shows an empty table and looks like "there are no trips".
  let currentPage = page;
  if (currentWalk !== walk) {
    setCurrentWalk(walk);
    setPage(1);
    currentPage = 1;
  }

  const query = useQuery({
    queryKey: [...queryKey, { page: currentPage, limit: pageSize }],
    queryFn: () => read({ page: currentPage, limit: pageSize }),
    // The session gate, unchanged in meaning from `useSessionResource`: an
    // anonymous session would be a guaranteed 401 and a password-change one a
    // guaranteed 403, and both look like permission bugs in the console.
    enabled: ready && (options.enabled ?? true),
    placeholderData: keepPreviousData,
    staleTime: options.staleTime,
  });

  // ⚠ A 403 IS A RESULT, NOT AN ACCIDENT, and this hook hands it back rather
  // than signing anybody out — that decision belongs to the session layer.
  const error = useMemo(() => {
    if (!query.error) return null;
    // Anything that is not an ApiError never passed through the transport
    // layer, so it is a programming fault rather than a server answer.
    return isApiError(query.error) ? query.error : new ApiError(0, undefined, 'Unexpected error.');
  }, [query.error]);

  const data = query.data ?? null;
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  const goToPage = useCallback(
    (target: number) => {
      // Clamped to what exists. The server answers a page past the end with an
      // empty page rather than an error, so this is about not showing the user
      // a blank screen they have to guess their way out of.
      setPage(Math.max(1, totalPages === 0 ? 1 : Math.min(target, totalPages)));
    },
    [totalPages],
  );

  const next = useCallback(() => {
    setPage((current) => (totalPages === 0 ? current : Math.min(current + 1, totalPages)));
  }, [totalPages]);

  const previous = useCallback(() => {
    setPage((current) => Math.max(1, current - 1));
  }, []);

  const items = data?.items ?? [];

  return {
    data,
    error,
    loading: sessionLoading || query.isFetching,
    forbidden: error?.status === 403,
    notFound: error?.status === 404,
    items,
    page: currentPage,
    goToPage,
    next,
    previous,
    total,
    totalPages,
    pageSize,
    setPageSize,
    firstRowNumber: items.length === 0 ? 0 : (currentPage - 1) * pageSize + 1,
    showingPreviousPage: query.isPlaceholderData,
  };
}
