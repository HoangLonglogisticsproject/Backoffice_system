import { render, screen, act } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncedHorizontalScrollbar } from './synced-horizontal-scrollbar';

/**
 * The floating bar exists to put a handle on horizontal scrolling within
 * reach while the reader is in the MIDDLE of a long table. These tests pin
 * the two things that makes true — it appears exactly when the table's own
 * bar is out of reach, and the two stay on the same scroll position — and
 * nothing about how a browser draws a scrollbar.
 */

/** jsdom implements neither, and this component depends on both. */
const observed: Element[] = [];
let disconnects = 0;
let notifyResize: (() => void) | undefined;

class TestResizeObserver {
  constructor(callback: () => void) {
    notifyResize = callback;
  }
  observe(element: Element) {
    observed.push(element);
  }
  unobserve() {}
  disconnect() {
    disconnects += 1;
  }
}

/**
 * A stand-in for the table's scroll container. jsdom lays nothing out, so
 * every dimension this component reads has to be declared.
 */
function makeTarget({
  scrollWidth = 2000,
  clientWidth = 800,
  top = -200,
  bottom = 1200,
}: { scrollWidth?: number; clientWidth?: number; top?: number; bottom?: number } = {}) {
  const element = document.createElement('div');
  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: clientWidth, configurable: true });
  element.getBoundingClientRect = () => rectAt(top, bottom, clientWidth);
  document.body.appendChild(element);
  return element;
}

/** A rect 240px from the left edge — where the content sits beside the rail. */
function rectAt(top: number, bottom: number, width: number): DOMRect {
  const rect = {
    top,
    bottom,
    left: 240,
    right: 240 + width,
    width,
    height: bottom - top,
    x: 240,
    y: top,
  };
  return rect as DOMRect;
}

const mount = (target: HTMLElement) => {
  const ref = createRef<HTMLElement>();
  ref.current = target;
  return render(<SyncedHorizontalScrollbar targetRef={ref} />);
};

const bar = () => screen.queryByTestId('synced-horizontal-scrollbar');

beforeEach(() => {
  observed.length = 0;
  disconnects = 0;
  notifyResize = undefined;
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  // The viewport the visibility rule is measured against.
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('SyncedHorizontalScrollbar', () => {
  describe('when it appears', () => {
    it('★ stays hidden when the target does not overflow — nothing to reach for', () => {
      mount(makeTarget({ scrollWidth: 800, clientWidth: 800 }));
      expect(bar()).not.toBeInTheDocument();
    });

    it('appears when the target overflows and crosses the bottom of the viewport', () => {
      mount(makeTarget({ scrollWidth: 2000, clientWidth: 800, top: -200, bottom: 1200 }));
      expect(bar()).toBeInTheDocument();
    });

    it('★ hides once the table’s OWN scrollbar is in view — never two bars for one table', () => {
      // The whole table now ends above the fold, so its native bar is on
      // screen and a second one would sit a few pixels below it.
      mount(makeTarget({ bottom: 700 }));
      expect(bar()).not.toBeInTheDocument();
    });

    it('hides when the table has not been scrolled to yet', () => {
      mount(makeTarget({ top: 1000, bottom: 2000 }));
      expect(bar()).not.toBeInTheDocument();
    });

    it('lines up with the target rather than spanning the window, so it never runs under the rail', () => {
      mount(makeTarget({ clientWidth: 800 }));
      expect(bar()).toHaveStyle({ left: '240px', width: '800px' });
    });

    it('sizes its spacer to the content, which is what gives the thumb its size', () => {
      mount(makeTarget({ scrollWidth: 2000 }));
      expect(bar()?.firstElementChild).toHaveStyle({ width: '2000px' });
    });
  });

  describe('scroll synchronisation', () => {
    it('★ dragging the floating bar scrolls the table', () => {
      const target = makeTarget();
      mount(target);

      const floating = bar() as HTMLElement;
      floating.scrollLeft = 640;
      act(() => {
        floating.dispatchEvent(new Event('scroll'));
      });

      expect(target.scrollLeft).toBe(640);
    });

    it('★ scrolling the table moves the floating bar — shift+wheel, trackpad or its own scrollbar', () => {
      const target = makeTarget();
      mount(target);

      target.scrollLeft = 320;
      act(() => {
        target.dispatchEvent(new Event('scroll'));
      });

      expect((bar() as HTMLElement).scrollLeft).toBe(320);
    });

    it('★ does not loop: driving one side does not bounce the value back', () => {
      const target = makeTarget();
      mount(target);
      const floating = bar() as HTMLElement;

      floating.scrollLeft = 500;
      act(() => {
        floating.dispatchEvent(new Event('scroll'));
        // The echo a real browser fires because `scrollLeft` was assigned.
        target.dispatchEvent(new Event('scroll'));
      });

      expect(target.scrollLeft).toBe(500);
      expect(floating.scrollLeft).toBe(500);
    });

    it('adopts the table’s current position when it appears, instead of jumping to column one', () => {
      const target = makeTarget();
      target.scrollLeft = 900;
      mount(target);

      expect((bar() as HTMLElement).scrollLeft).toBe(900);
    });
  });

  describe('re-measuring', () => {
    it('★ recomputes when the target resizes — new columns, a page of wider data, a collapsing sidebar', () => {
      const target = makeTarget({ scrollWidth: 2000 });
      mount(target);
      expect(bar()?.firstElementChild).toHaveStyle({ width: '2000px' });

      Object.defineProperty(target, 'scrollWidth', { value: 3200, configurable: true });
      act(() => notifyResize?.());

      expect(bar()?.firstElementChild).toHaveStyle({ width: '3200px' });
    });

    it('observes both the container and its content', () => {
      const target = makeTarget();
      target.appendChild(document.createElement('table'));
      mount(target);

      expect(observed).toHaveLength(2);
      expect(observed[0]).toBe(target);
      expect(observed[1]).toBe(target.firstElementChild);
    });

    it('disappears when a resize leaves nothing to scroll', () => {
      const target = makeTarget({ scrollWidth: 2000, clientWidth: 800 });
      mount(target);
      expect(bar()).toBeInTheDocument();

      Object.defineProperty(target, 'scrollWidth', { value: 800, configurable: true });
      act(() => notifyResize?.());

      expect(bar()).not.toBeInTheDocument();
    });

    it('re-measures on a page scroll, which is how it knows the table moved', () => {
      const target = makeTarget({ bottom: 1200 });
      mount(target);
      expect(bar()).toBeInTheDocument();

      // The reader scrolled to the end of the table: its own bar is now visible.
      target.getBoundingClientRect = () => rectAt(-600, 600, 800);
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });

      expect(bar()).not.toBeInTheDocument();
    });
  });

  it('★ lets go of every listener and observer on unmount', () => {
    const target = makeTarget();
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeTarget = vi.spyOn(target, 'removeEventListener');

    mount(target).unmount();

    const windowEvents = removeWindow.mock.calls.map(([event]) => event);
    expect(windowEvents).toContain('scroll');
    expect(windowEvents).toContain('resize');
    expect(removeTarget.mock.calls.map(([event]) => event)).toContain('scroll');
    expect(disconnects).toBe(1);
  });
});
