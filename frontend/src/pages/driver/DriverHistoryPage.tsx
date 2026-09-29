import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMyHistory } from '@/hooks/driver';
import { isFinalRefusal } from '@/utils/driverErrors';
import { formatCalendarWeekday } from '@/utils/format/datetime';
import type { DriverTrip } from '@/types/driver';
import { AssignmentCard, AssignmentCardSkeleton } from './components/AssignmentCard';
import { DriverLoadError } from './components/DriverLoadError';

/**
 * The trips this driver has already run to the end.
 *
 * ★ WHAT MAKES A TRIP BELONG HERE IS THAT THE TRIP FINISHED, NOT THAT THE
 * DRIVER'S TURN ENDED. A completed trip keeps its assignments active, so the
 * server filters on the trip's own status; a driver swapped off a trip that
 * later finished still sees it, because they drove part of it.
 *
 * ★ THE LIST TAKES NO PARAMETER NAMING A DRIVER — the same security model as
 * the schedule. The scope is the session, and the page cursor only says where
 * to resume, so it can move this driver's own window and nothing else.
 *
 * ★ A BUTTON, NOT AN INFINITE SCROLLER. An observer firing on scroll would
 * fetch while a driver is skimming on mobile data, and it takes the end of the
 * list away from somebody who was heading for it. One tap, one page, and the
 * button disappears when there is nothing older.
 *
 * ★ NO MONEY AND NO COUNT. Not a filter applied here — the server never sends
 * either. "How many trips have I run" is a figure pay is reconciled against,
 * and this screen exists so a driver can look their own work up rather than so
 * it becomes a number either side quotes.
 */
export default function DriverHistoryPage() {
  const { t, language } = useLanguage();
  const { trips, loading, loadingMore, hasMore, error, loadMore, reload } = useMyHistory();

  // Grouped by the day they were scheduled for, newest first — the order the
  // server already returns, so this only inserts the headings.
  const days = useMemo(() => byDay(trips), [trips]);

  // ★ A FAILED REFRESH DOES NOT TAKE AWAY PAGES ALREADY ON SCREEN — a lost
  // signal is said above them and they stay. A REFUSAL DOES: after a 401/403
  // the addresses already loaded must not outlive the access that fetched
  // them. The same rule the schedule and the assignment detail follow.
  const blocking = Boolean(error) && (trips.length === 0 || isFinalRefusal(error));
  const settled = !loading && !blocking;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{t('driverHistory')}</h1>
        <p className="text-sm text-muted-foreground">{t('driverHistoryHint')}</p>
      </header>

      {loading ? (
        <div className="space-y-3">
          <output className="sr-only">{t('driverLoading')}</output>
          <AssignmentCardSkeleton />
          <AssignmentCardSkeleton />
        </div>
      ) : null}

      {error ? <DriverLoadError error={error} onRetry={reload} /> : null}

      {settled && trips.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('driverHistoryEmpty')}</p>
      ) : null}

      {settled && trips.length > 0 ? (
        <div className="space-y-5">
          {days.map(({ day, assignments }) => {
            const headingId = `history-day-${day}`;
            return (
              <section key={day} aria-labelledby={headingId} className="space-y-2">
                <h2 id={headingId} className="text-sm font-semibold text-muted-foreground">
                  {formatCalendarWeekday(day, language)}
                </h2>
                <ul className="space-y-3">
                  {assignments.map((assignment) => (
                    <li key={assignment.assignment.id}>
                      <AssignmentCard assignment={assignment} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {hasMore ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {t(loadingMore ? 'driverLoading' : 'driverHistoryMore')}
            </Button>
          ) : (
            // Said out loud, because a list that simply stops looks like one
            // that failed to load the rest.
            <p className="pb-2 text-center text-xs text-muted-foreground">
              {t('driverHistoryEnd')}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The trips grouped under the day they were scheduled for.
 *
 * ★ ORDER IS THE SERVER'S, NOT RE-SORTED HERE. The rows arrive newest first by
 * the column the history index is built on; sorting again on the client would
 * be a second opinion that disagrees the moment two trips share a date, and it
 * would fight the paging — a later page's rows would jump above an earlier
 * page's.
 */
const byDay = (trips: readonly DriverTrip[]): { day: string; assignments: DriverTrip[] }[] => {
  const days: { day: string; assignments: DriverTrip[] }[] = [];
  for (const trip of trips) {
    const last = days[days.length - 1];
    if (last && last.day === trip.scheduledOn) last.assignments.push(trip);
    else days.push({ day: trip.scheduledOn, assignments: [trip] });
  }
  return days;
};
