import { useCallback, useEffect, useState } from 'react';
import { useSessionResource, type SessionResource } from '../session/useSessionResource';
import type { Page, PageRequest } from '../type/pagination';

export interface CursorPages<T> extends SessionResource<Page<T>> {
  items: T[];
  hasMore: boolean;
  /** True when this client has somewhere to go back to. */
  canGoBack: boolean;
  next: () => void;
  previous: () => void;
  pageSize: number;
  setPageSize: (size: number) => void;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Walks a keyset-paginated list, one page at a time.
 *
 * ★ GOING BACK IS THE CLIENT'S MEMORY, NOT A SERVER FEATURE. A cursor names the
 * position AFTER which to read, so it only ever points forward — there is no
 * "previous cursor" to ask for. What this keeps instead is the stack of cursors
 * it has already used: page one is `undefined`, and every `next()` pushes the
 * `nextCursor` the server just returned. `previous()` pops. The server is never
 * asked to walk backwards, and no cursor is ever constructed here.
 *
 * ⚠ THE CURSOR IS OPAQUE AND STAYS THAT WAY. Nothing in this file decodes one,
 * inspects one, or builds one — they are moved from response to request and
 * nowhere else. The moment a client parses a cursor, the server's sort key
 * becomes a public API that can never change.
 *
 * There is no total and no page number, because the API returns neither: a
 * count would re-scan the table on every page. `hasMore` is the whole of what
 * is known about what lies ahead.
 */
export function useCursorPages<T>(
  read: (page: PageRequest) => Promise<Page<T>>,
  deps: readonly unknown[],
  initialPageSize: number = DEFAULT_PAGE_SIZE,
): CursorPages<T> {
  const [pageSize, setSize] = useState(initialPageSize);
  // Page one is "no cursor". Every entry after it is a cursor the server gave.
  const [visited, setVisited] = useState<(string | undefined)[]>([undefined]);
  const cursor = visited[visited.length - 1];

  // A different department — or a different page size — is a different walk, so
  // the history from the old one would send meaningless cursors at it.
  //
  // The deps are collapsed into one string rather than spread into the array:
  // a spread makes the dependency list variable-length, which the exhaustive-deps
  // rule cannot verify and which would otherwise need a suppression comment.
  const walk = `${pageSize}:${JSON.stringify(deps)}`;
  useEffect(() => {
    setVisited([undefined]);
  }, [walk]);

  const resource = useSessionResource<Page<T>>(
    () => read({ limit: pageSize, cursor }),
    [...deps, cursor, pageSize],
  );

  const next = useCallback(() => {
    const forward = resource.data?.nextCursor;
    if (!forward) return;
    setVisited((stack) => [...stack, forward]);
  }, [resource.data?.nextCursor]);

  const previous = useCallback(() => {
    setVisited((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }, []);

  const setPageSize = useCallback((size: number) => {
    setSize(size);
  }, []);

  return {
    ...resource,
    items: resource.data?.items ?? [],
    hasMore: resource.data?.hasMore ?? false,
    canGoBack: visited.length > 1,
    next,
    previous,
    pageSize,
    setPageSize,
  };
}
