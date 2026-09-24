import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Table, TableBody, TableCell, TableRow } from './table';

/**
 * The opt-in wiring between `Table` and the floating scrollbar.
 *
 * The scrollbar's own behaviour is pinned in
 * `synced-horizontal-scrollbar.spec.tsx`; what is worth a test here is that
 * `Table` hands it the right element — its scroll container, not the
 * `<table>` inside it — because passing the wrong one would produce a bar
 * that renders and moves nothing.
 */

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const wide = (element: HTMLElement) => {
  Object.defineProperty(element, 'scrollWidth', { value: 2400, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: 900, configurable: true });
  element.getBoundingClientRect = () =>
    ({ top: -100, bottom: 1400, left: 260, right: 1160, width: 900, height: 1500, x: 260, y: -100 }) as DOMRect;
};

const rows = (
  <TableBody>
    <TableRow>
      <TableCell>một</TableCell>
    </TableRow>
  </TableBody>
);

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Table', () => {
  it('has no floating scrollbar by default — a table that fits needs no second bar', () => {
    const { container } = render(<Table>{rows}</Table>);
    wide(container.querySelector('[data-slot="table-container"]') as HTMLElement);

    expect(screen.queryByTestId('synced-horizontal-scrollbar')).not.toBeInTheDocument();
  });

  it('★ with `stickyScrollbar`, drives the table’s own scroll container', () => {
    const { container } = render(<Table stickyScrollbar>{rows}</Table>);
    const scroller = container.querySelector('[data-slot="table-container"]') as HTMLElement;
    // jsdom gives everything zero size, so the container only looks wide once
    // these are declared; a resize is how a browser would report the same.
    wide(scroller);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    const bar = screen.getByTestId('synced-horizontal-scrollbar');
    bar.scrollLeft = 480;
    act(() => {
      bar.dispatchEvent(new Event('scroll'));
    });

    // The container scrolled — not the `<table>`, which has no overflow of
    // its own and would have swallowed the value.
    expect(scroller.scrollLeft).toBe(480);
  });
});
