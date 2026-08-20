import { useCallback, useState } from 'react';
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
  const [pageSize, setPageSize] = useState(initialPageSize);
  // Page one is "no cursor". Every entry after it is a cursor the server gave.
  const [visited, setVisited] = useState<(string | undefined)[]>([undefined]);

  // A different department — or a different page size — is a different walk, so
  // the history from the old one holds cursors that mean nothing to it.
  const walk = `${pageSize}:${JSON.stringify(deps)}`;
  const [currentWalk, setCurrentWalk] = useState(walk);

  // ★ RESET DURING RENDER, NOT IN AN EFFECT. An effect runs AFTER the render
  // that changed the page size, so this hook would first render the new size
  // holding the OLD cursor — firing a request for "50 rows after the cursor
  // from a walk of 20" — and only then reset and fire the real one. Two
  // requests, the first of them wrong. Adjusting the state while rendering is
  // React's documented answer: the stale render never reaches the read.
  let history = visited;
  if (currentWalk !== walk) {
    setCurrentWalk(walk);
    setVisited([undefined]);
    history = [undefined];
  }

  const cursor = history[history.length - 1];

  const resource = useSessionResource<Page<T>>(
    () => read({ limit: pageSize, cursor }),
    [...deps, cursor, pageSize],
  );

  const forward = resource.data?.nextCursor;

  const next = useCallback(() => {
    if (!forward) return;
    setVisited((stack) => {
      // A second click before the next page arrives would push the SAME cursor
      // again, leaving a duplicate entry that `previous()` then has to walk
      // through twice to get anywhere.
      if (stack[stack.length - 1] === forward) return stack;
      return [...stack, forward];
    });
  }, [forward]);

  const previous = useCallback(() => {
    setVisited((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }, []);

  return {
    ...resource,
    items: resource.data?.items ?? [],
    hasMore: resource.data?.hasMore ?? false,
    canGoBack: history.length > 1,
    next,
    previous,
    pageSize,
    setPageSize,
  };
}
