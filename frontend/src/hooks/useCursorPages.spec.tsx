import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useCursorPages } from './useCursorPages';
import type { Page, PageRequest } from '@/types/pagination';

// A session that is always `ready`, so the hook under test is the only thing
// deciding anything. `useSessionResource` gates on this by design.
vi.mock('../session/SessionProvider', () => ({
  useSession: () => ({ state: { status: 'ready' }, loading: false }),
}));

interface Row {
  id: string;
}

/**
 * Walking a keyset list.
 *
 * ★ THE POINT OF THESE TESTS IS THAT GOING BACK IS THE CLIENT'S MEMORY. Cursors
 * point forward only, so "previous" cannot be a request — it has to be a stack
 * this hook keeps. If that stack is wrong, the user silently re-reads a page or
 * skips one, and nothing errors.
 */
function makePages(pages: Array<{ items: Row[]; nextCursor: string | null }>) {
  const seen: Array<string | undefined> = [];

  const read = vi.fn(async (request: PageRequest): Promise<Page<Row>> => {
    seen.push(request.cursor);
    const index = request.cursor ? pages.findIndex((p) => p.nextCursor === request.cursor) + 1 : 0;
    const page = pages[index] ?? { items: [], nextCursor: null };
    return { items: page.items, nextCursor: page.nextCursor, hasMore: page.nextCursor !== null };
  });

  return { read, seen };
}

function Harness({ read }: Readonly<{ read: (request: PageRequest) => Promise<Page<Row>> }>) {
  const page = useCursorPages<Row>(read, [], 2);
  return (
    <div>
      <span data-testid="ids">{page.items.map((i) => i.id).join(',')}</span>
      <span data-testid="hasMore">{String(page.hasMore)}</span>
      <span data-testid="canGoBack">{String(page.canGoBack)}</span>
      <button type="button" onClick={page.next}>
        next
      </button>
      <button type="button" onClick={page.previous}>
        previous
      </button>
      <button type="button" onClick={() => page.setPageSize(50)}>
        resize
      </button>
    </div>
  );
}

const PAGES = [
  { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'CUR1' },
  { items: [{ id: 'c' }, { id: 'd' }], nextCursor: 'CUR2' },
  { items: [{ id: 'e' }], nextCursor: null },
];

describe('useCursorPages', () => {
  it('asks for page one with no cursor', async () => {
    const { read, seen } = makePages(PAGES);
    render(<Harness read={read} />);

    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('a,b'));
    expect(seen[0]).toBeUndefined();
    expect(screen.getByTestId('canGoBack')).toHaveTextContent('false');
  });

  it('hands the server back the cursor it just received, unmodified', async () => {
    const { read, seen } = makePages(PAGES);
    render(<Harness read={read} />);
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('a,b'));

    act(() => screen.getByText('next').click());

    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('c,d'));
    // Opaque: passed through byte for byte, never parsed or rebuilt.
    expect(seen).toContain('CUR1');
  });

  it('walks forward and back over the SAME pages, without re-reading a row', async () => {
    const { read } = makePages(PAGES);
    render(<Harness read={read} />);
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('a,b'));

    act(() => screen.getByText('next').click());
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('c,d'));
    expect(screen.getByTestId('canGoBack')).toHaveTextContent('true');

    act(() => screen.getByText('next').click());
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('e'));
    expect(screen.getByTestId('hasMore')).toHaveTextContent('false');

    act(() => screen.getByText('previous').click());
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('c,d'));

    act(() => screen.getByText('previous').click());
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('a,b'));
    // Back at the start, so there is nowhere further back to go.
    expect(screen.getByTestId('canGoBack')).toHaveTextContent('false');
  });

  it('refuses to advance past the end', async () => {
    const { read } = makePages([{ items: [{ id: 'only' }], nextCursor: null }]);
    render(<Harness read={read} />);
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('only'));

    act(() => screen.getByText('next').click());

    // `nextCursor` was null, so there is nothing to ask for and nothing moves.
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('only'));
    expect(screen.getByTestId('canGoBack')).toHaveTextContent('false');
  });

  it('changing the page size issues ONE request, and it carries no cursor', async () => {
    const { read, seen } = makePages(PAGES);
    render(<Harness read={read} />);
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('a,b'));

    act(() => screen.getByText('next').click());
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('c,d'));

    const before = read.mock.calls.length;
    act(() => screen.getByText('resize').click());
    await waitFor(() => expect(screen.getByTestId('canGoBack')).toHaveTextContent('false'));

    // ★ Resetting in an effect would render the NEW page size still holding the
    // OLD cursor, firing "50 rows after a cursor from a walk of 20" before
    // correcting itself. Exactly one request, and it starts from the top.
    const after = read.mock.calls.slice(before);
    expect(after).toHaveLength(1);
    expect(after[0][0].cursor).toBeUndefined();
    expect(after[0][0].limit).toBe(50);
    expect(seen[seen.length - 1]).toBeUndefined();
  });

  it('ignores a second next() before the page arrives', async () => {
    const { read } = makePages(PAGES);
    render(<Harness read={read} />);
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('a,b'));

    // Two clicks, one cursor: the stack must not gain a duplicate entry that
    // `previous()` then has to walk through twice.
    act(() => {
      screen.getByText('next').click();
      screen.getByText('next').click();
    });
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('c,d'));

    act(() => screen.getByText('previous').click());
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('a,b'));
    expect(screen.getByTestId('canGoBack')).toHaveTextContent('false');
  });

  it('starts the walk over when the page size changes', async () => {
    const { read } = makePages(PAGES);
    render(<Harness read={read} />);
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('a,b'));

    act(() => screen.getByText('next').click());
    await waitFor(() => expect(screen.getByTestId('canGoBack')).toHaveTextContent('true'));

    act(() => screen.getByText('resize').click());

    // A cursor is a position in a walk of a given size; carrying it into a
    // different size would resume from a meaningless place.
    await waitFor(() => expect(screen.getByTestId('canGoBack')).toHaveTextContent('false'));
  });
});
