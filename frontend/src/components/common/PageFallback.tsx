import { Skeleton } from '@/components/ui/skeleton';

/**
 * What stands in the content area while a route's code, or the session, is
 * still on its way.
 *
 * ★ IT EXISTS BECAUSE THE ALTERNATIVE WAS A WHITE SCREEN. Every page used to be
 * imported statically, so a reload fetched the whole application — forty
 * screens, the map library, the login background — before anything could be
 * drawn. Split by route, the wait is far shorter, but it is not zero, and the
 * shape it has here is the difference between "loading" and "broken".
 *
 * ★ ONE ANNOUNCEMENT FOR THE WHOLE REGION. `Skeleton` is `aria-hidden` by
 * construction — a screen reader hearing nine placeholder blocks learns
 * nothing. `role="status"` on the container says the one thing that is true,
 * once, and `aria-busy` says it is not finished.
 *
 * Deliberately generic: it stands in for every screen, so it can only draw what
 * they share — a title, and rows of something. A per-page skeleton belongs to
 * that page, not here.
 */
export function PageFallback() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-4">
      {/* The only text in here, and the only thing announced. */}
      <span className="sr-only">Đang tải…</span>

      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />

      <div className="space-y-3 pt-4">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
