import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { TripRangeFilters } from './components/TripRangeFilters';

/**
 * The filter bar Lịch xe and Lịch sử chuyến share.
 *
 * ★ THE SEARCH IS SUBMITTED, NOT TYPED INTO. Every case here is about that one
 * distinction: typing changes the BOX, and only "Tìm" (or Enter) changes what
 * the board is narrowed by. A test that only checked the box would pass while
 * the button did nothing at all — which is exactly the failure this file was
 * written after.
 */
const bar = (over: Partial<Parameters<typeof TripRangeFilters>[0]['trips']> = {}) => {
  const trips = {
    range: { from: '2026-10-01', to: '2026-10-31' },
    setFrom: vi.fn(),
    setTo: vi.fn(),
    resetRange: vi.fn(),
    order: { sort: 'executionDate' as const, direction: 'desc' as const },
    setOrder: vi.fn(),
    customer: '',
    setCustomer: vi.fn(),
    appliedCustomer: '',
    submitCustomer: vi.fn(),
    clearCustomer: vi.fn(),
    ...over,
  };

  render(
    <LanguageProvider>
      <TripRangeFilters trips={trips} />
    </LanguageProvider>,
  );
  return trips;
};

const box = () => screen.getByLabelText('Tìm khách hàng');

describe('TripRangeFilters — the customer search', () => {
  it('typing changes the box and narrows NOTHING yet', () => {
    const trips = bar();

    fireEvent.change(box(), { target: { value: 'viễn' } });

    expect(trips.setCustomer).toHaveBeenCalledWith('viễn');
    // The board is untouched until it is asked to be.
    expect(trips.submitCustomer).not.toHaveBeenCalled();
  });

  it('★ CLICKING "Tìm" SUBMITS — the whole point of the button existing', () => {
    const trips = bar({ customer: 'viễn' });

    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));

    expect(trips.submitCustomer).toHaveBeenCalledTimes(1);
  });

  it('★ pressing Enter in the box submits too, without a key handler', () => {
    // A real `<form>`: the browser turns Enter in a single-input form into a
    // submit. A control that works for a mouse and not for a keyboard is half
    // a control.
    const trips = bar({ customer: 'viễn' });

    fireEvent.submit(box().closest('form') as HTMLFormElement);

    expect(trips.submitCustomer).toHaveBeenCalledTimes(1);
  });

  it('offers no "Bỏ lọc" while nothing is filtered', () => {
    bar({ customer: 'viễn' });

    // Typed but not submitted: there is nothing to clear yet.
    expect(screen.queryByRole('button', { name: /bỏ lọc/i })).toBeNull();
  });

  it('★ offers "Bỏ lọc" once a search is actually on, and it empties both', () => {
    const trips = bar({ customer: 'viễn', appliedCustomer: 'viễn' });

    fireEvent.click(screen.getByRole('button', { name: /bỏ lọc/i }));

    expect(trips.clearCustomer).toHaveBeenCalledTimes(1);
  });

  it('★ does not share an accessible name with the trip form’s own customer field', () => {
    // "Khách hàng" is the FORM's label. Two controls with one name on one screen
    // is one a screen reader — and a test — cannot tell from the other.
    bar();

    expect(screen.queryByLabelText('Khách hàng')).toBeNull();
    expect(box()).toBeInTheDocument();
  });

  it('★ on a phone the search wraps instead of overflowing — the box takes the row, the buttons follow in reading order', () => {
    // The layout itself is measured in real Chromium (360–1440 px); jsdom pins the
    // contract: the form may wrap, the box is full width below `sm` and 200 px from
    // `sm` up, and Tab still runs box → "Tìm" → "Bỏ lọc".
    bar({ customer: 'KAPV', appliedCustomer: 'KAPV' });
    const form = box().closest('form')!;

    expect(form).toHaveClass('flex-wrap', 'w-full', 'sm:w-auto');
    expect(box()).toHaveClass('w-full', 'sm:w-[200px]');
    expect([...form.querySelectorAll('input, button')].map((el) => el.id || el.textContent?.trim())).toEqual([
      'trip-customer-search',
      'Tìm',
      'Bỏ lọc',
    ]);
  });
});
