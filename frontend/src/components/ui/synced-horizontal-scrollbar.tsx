import * as React from 'react';

import { cn } from '@/utils';

/**
 * A horizontal scrollbar that floats at the bottom of the viewport and drives
 * a wide element's own horizontal scrolling.
 *
 * ★ THE PROBLEM IS REACH, NOT OVERFLOW. A wide table already scrolls
 * sideways, but the native scrollbar sits at the table's BOTTOM EDGE. Reading
 * row 20 of 50 means the only control for "show me the columns on the right"
 * is a full page-scroll away, so the reader scrolls down to the bar, drags,
 * then scrolls back up to find their row. This puts a second handle on the
 * same scroll position, within reach the whole time the table is in view.
 *
 * ★ IT IS A REAL SCROLLBAR, NOT A DRAWN ONE. The bar is an `overflow-x: auto`
 * box containing one spacer as wide as the target's `scrollWidth`, so the
 * browser renders and drives its own scrollbar — momentum, shift+wheel,
 * trackpad, click-in-trough and platform styling all come for free. A div
 * with mouse handlers would have to reimplement every one of them, and would
 * get the edge cases wrong.
 *
 * ★ FIXED, MEASURED FROM THE TARGET — NOT `position: sticky`. Sticky would be
 * less code and was tried first: it does not work here, because sticky
 * resolves against the nearest scrollable ancestor and the tables this is for
 * sit inside `overflow-hidden` cards, which becomes that ancestor and pins the
 * bar inside the card instead of to the viewport. Reading `left`/`width` off
 * the target's own bounding rect also means the bar lines up with the table
 * whatever the shell is doing — sidebar expanded, collapsed, mid-transition —
 * without this component knowing a rail exists or what it is wide.
 */

interface SyncedHorizontalScrollbarProps {
  /**
   * The element that actually scrolls — the `overflow-x` container, not the
   * table inside it.
   */
  targetRef: React.RefObject<HTMLElement | null>;
  className?: string;
}

interface Geometry {
  /** Viewport coordinates of the target, so the bar lines up with it. */
  left: number;
  width: number;
  /** How wide the content is, which is what makes the bar's thumb its size. */
  scrollWidth: number;
  visible: boolean;
}

const HIDDEN: Geometry = { left: 0, width: 0, scrollWidth: 0, visible: false };

const same = (a: Geometry, b: Geometry): boolean =>
  a.left === b.left && a.width === b.width && a.scrollWidth === b.scrollWidth && a.visible === b.visible;

export function SyncedHorizontalScrollbar({
  targetRef,
  className,
}: Readonly<SyncedHorizontalScrollbarProps>) {
  const barRef = React.useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = React.useState<Geometry>(HIDDEN);

  /**
   * ★ THE LOOP IS BROKEN BY POSITION, NOT BY TIMING. Assigning `scrollLeft`
   * makes the other box fire its own `scroll` event, so the two would hand
   * the value back and forth for ever. The guard is simply that neither side
   * writes when the two already agree: the echo arrives, finds them equal,
   * and stops there.
   *
   * A "I am currently syncing" flag cleared on the next frame was the first
   * version and is worse, because a scroll event can arrive after that frame.
   * A stale echo would then be free to write the OLD position back over a
   * newer one — interrupting a drag or momentum scroll mid-flight — and a
   * flag still set when a real scroll arrived would drop it. Comparing
   * positions has neither failure: by the time a late echo is handled, both
   * boxes are already at the newer position, so it does nothing.
   */

  const measure = React.useCallback(() => {
    const target = targetRef.current;
    if (!target) {
      setGeometry((previous) => (previous.visible ? HIDDEN : previous));
      return;
    }

    const rect = target.getBoundingClientRect();
    const viewportBottom = window.innerHeight;
    // A pixel of slack: sub-pixel layout makes scrollWidth exceed clientWidth
    // by a fraction on tables that do not actually overflow.
    const overflows = target.scrollWidth - target.clientWidth > 1;

    // ★ ONLY WHILE THE TABLE CROSSES THE BOTTOM OF THE VIEWPORT. Above that
    // the table is not in view at all; below it the table's own scrollbar has
    // come into view, and showing both would be two bars a few pixels apart
    // that scroll the same thing.
    const visible = overflows && rect.top < viewportBottom && rect.bottom > viewportBottom;

    setGeometry((previous) => {
      const next: Geometry = {
        left: rect.left,
        width: rect.width,
        scrollWidth: target.scrollWidth,
        visible,
      };
      return same(previous, next) ? previous : next;
    });
  }, [targetRef]);

  // Geometry: anything that can move the table or change its width.
  React.useEffect(() => {
    measure();

    // `capture` because the page scrolls inside the shell's `<main>`, not the
    // window, and a scroll event from a nested container does not bubble.
    window.addEventListener('scroll', measure, { capture: true, passive: true });
    window.addEventListener('resize', measure);

    const target = targetRef.current;
    let observer: ResizeObserver | undefined;
    if (target && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      // The container for viewport width — which the sidebar collapsing
      // changes — and its content for scrollWidth, which a different set of
      // columns or a longer cell changes.
      observer.observe(target);
      if (target.firstElementChild) observer.observe(target.firstElementChild);
    }

    return () => {
      window.removeEventListener('scroll', measure, { capture: true });
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure, targetRef]);

  // Target → bar.
  React.useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const onTargetScroll = () => {
      const bar = barRef.current;
      // The sub-pixel tolerance matters: browsers report fractional
      // `scrollLeft` at some zoom levels but round on assignment, so exact
      // equality would see a difference that is not one and write back.
      if (!bar || Math.abs(bar.scrollLeft - target.scrollLeft) < 1) return;
      bar.scrollLeft = target.scrollLeft;
    };

    target.addEventListener('scroll', onTargetScroll, { passive: true });
    return () => target.removeEventListener('scroll', onTargetScroll);
  }, [targetRef]);

  // Bar → target.
  const onBarScroll = React.useCallback(() => {
    const target = targetRef.current;
    const bar = barRef.current;
    if (!target || !bar || Math.abs(target.scrollLeft - bar.scrollLeft) < 1) return;
    target.scrollLeft = bar.scrollLeft;
  }, [targetRef]);

  // Appearing mid-scroll must not jump the table back to column one.
  React.useEffect(() => {
    if (!geometry.visible) return;
    const bar = barRef.current;
    const target = targetRef.current;
    if (bar && target) bar.scrollLeft = target.scrollLeft;
  }, [geometry.visible, geometry.scrollWidth, targetRef]);

  if (!geometry.visible) return null;

  return (
    <div
      data-slot="synced-horizontal-scrollbar"
      data-testid="synced-horizontal-scrollbar"
      // ★ HIDDEN FROM ASSISTIVE TECHNOLOGY ON PURPOSE. It is a second handle
      // on scrolling the reader can already do from the table itself, and the
      // table keeps its own native scroll container untouched. Announcing a
      // duplicate scroll region would add noise, not reach.
      aria-hidden="true"
      className={cn(
        // ★ AN EXPLICIT HEIGHT, BECAUSE THE SPACER CANNOT PROVIDE ONE. Where
        // the platform draws OVERLAY scrollbars (macOS by default) the bar
        // adds no layout height and stays hidden until something scrolls, so
        // a box sized by its content would be about two pixels tall: invisible
        // and impossible to grab. 17px is the tallest classic scrollbar
        // (Windows) so neither platform is clipped, and on the overlay ones it
        // is the strip that has to be hovered for the thumb to appear.
        'fixed bottom-0 z-20 h-[17px] overflow-x-auto overflow-y-hidden',
        'border-t border-gray-200 bg-white/95 shadow-[0_-1px_3px_rgba(0,0,0,0.06)]',
        className,
      )}
      style={{ left: geometry.left, width: geometry.width }}
      ref={barRef}
      onScroll={onBarScroll}
      tabIndex={-1}
    >
      {/* Width is the whole point; the height only has to be non-zero. */}
      <div style={{ width: geometry.scrollWidth, height: 1 }} />
    </div>
  );
}
