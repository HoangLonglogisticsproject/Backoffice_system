import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CursorPagination } from './pagination';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * The page controls, against the contract they actually have to obey.
 *
 * The assertions that matter are the absences: no page numbers, no total, no
 * "page 3 of 26". The API returns `{ items, nextCursor, hasMore }` and no count,
 * so any of those would have to be invented — and an invented total is a lie
 * the user acts on.
 */
const renderControls = (props: Partial<React.ComponentProps<typeof CursorPagination>> = {}) =>
  render(
    <LanguageProvider>
      <CursorPagination
        shown={20}
        hasMore
        canGoBack={false}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        pageSize={20}
        {...props}
      />
    </LanguageProvider>,
  );

describe('CursorPagination', () => {
  it('shows how many rows are on screen, and never a total', () => {
    renderControls({ shown: 20 });

    expect(screen.getByText(/20/)).toBeInTheDocument();
    // "of 256" cannot be rendered honestly — the server never sent a count.
    expect(screen.queryByText(/\/\s*\d+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/of \d+/i)).not.toBeInTheDocument();
  });

  it('offers no page numbers to click', () => {
    renderControls();

    // A numbered page implies a knowable last page. There isn't one.
    for (const n of ['1', '2', '3', '26']) {
      expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
    }
  });

  it('disables next when the server said there is no more', () => {
    const onNext = vi.fn();
    renderControls({ hasMore: false, onNext });

    const next = screen.getByRole('button', { name: /next|sau/i });
    expect(next).toBeDisabled();

    fireEvent.click(next);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('disables previous until this client has somewhere to go back to', () => {
    renderControls({ canGoBack: false });
    expect(screen.getByRole('button', { name: /previous|trước/i })).toBeDisabled();
  });

  it('advances only when there is a next page', () => {
    const onNext = vi.fn();
    renderControls({ hasMore: true, onNext });

    fireEvent.click(screen.getByRole('button', { name: /next|sau/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('goes back when history allows it', () => {
    const onPrevious = vi.fn();
    renderControls({ canGoBack: true, onPrevious });

    fireEvent.click(screen.getByRole('button', { name: /previous|trước/i }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('locks both directions while a page is in flight', () => {
    renderControls({ isLoading: true, canGoBack: true, hasMore: true });

    expect(screen.getByRole('button', { name: /next|sau/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /previous|trước/i })).toBeDisabled();
  });
});
