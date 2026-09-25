import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMyAssignments } from '@/hooks/driver';
import { useBusinessToday } from '@/hooks/useBusinessToday';
import { isScheduleView, scheduleOf, SCHEDULE_VIEWS, type ScheduleDay, type ScheduleView } from '@/utils/driverSchedule';
import { isFinalRefusal } from '@/utils/driverErrors';
import { formatCalendarWeekday } from '@/utils/format/datetime';
import type { TranslationKey } from '@/types/translate';
import { AssignmentCard, AssignmentCardSkeleton } from './components/AssignmentCard';
import { DriverLoadError } from './components/DriverLoadError';

/**
 * The driver's work schedule — "which trips do I drive today?"
 *
 * ★ THE LIST TAKES NO PARAMETER, AND THAT IS THE SECURITY MODEL. The server
 * reads the caller's own assignments; the view is split here, on the client,
 * from what came back — there is no id or date a client could send to widen it.
 *
 * ★ ONE CARD PER ASSIGNMENT, OPENED BY `assignmentId` (ADR-0004, DL-115).
 *
 * ★ THE VIEW IS IN THE URL (`?view=upcoming`), so going back from a trip lands
 * on the tab the driver left, and today — the common case — is the bare
 * `/driver`.
 */

const VIEW_LABEL: Record<ScheduleView, TranslationKey> = {
  today: 'driverViewToday',
  upcoming: 'driverViewUpcoming',
  past: 'driverViewPast',
};

const EMPTY: Record<ScheduleView, TranslationKey> = {
  today: 'driverEmptyToday',
  upcoming: 'driverEmptyUpcoming',
  past: 'driverEmptyPast',
};

export default function DriverTripsPage() {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const { assignments, loading, error, reload } = useMyAssignments();

  const requested = params.get('view');
  const view: ScheduleView = isScheduleView(requested) ? requested : 'today';
  // The business calendar's today — never the handset's (see `driverSchedule`)
  // — and it turns over at midnight while the page stays open.
  const today = useBusinessToday();
  const schedule = useMemo(() => scheduleOf(assignments, today), [assignments, today]);
  // ★ A FAILED REFRESH DOES NOT TAKE AWAY A SCHEDULE ALREADY ON SCREEN — a
  // lost signal is said above the cards, which stay. A REFUSAL DOES: after a
  // 401/403 the addresses already loaded must not outlive the access that
  // fetched them. The same rule as the assignment detail.
  const blocking = Boolean(error) && (assignments.length === 0 || isFinalRefusal(error));
  const settled = !loading && !blocking;

  const show = (next: unknown) => {
    if (!isScheduleView(next)) return;
    // `replace`: switching tabs is not a place to go back to.
    setParams(next === 'today' ? {} : { view: next }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{t('driverSchedule')}</h1>
        <p className="text-sm text-muted-foreground">{formatCalendarWeekday(today, language)}</p>
      </header>

      <Tabs value={view} onValueChange={show}>
        {/* 48px with a 2px inset: each tab is a full 44px thumb target. */}
        <TabsList className="h-12 w-full p-0.5">
          {SCHEDULE_VIEWS.map((option) => (
            <TabsTrigger key={option} value={option}>
              {t(VIEW_LABEL[option])}
              {/* The space is its own text node: a name is built from each
                  element's TRIMMED text, so one inside the span would be lost
                  and a screen reader would hear "Hôm nay2". */}
              {settled ? (
                <>
                  {' '}
                  <span className="text-xs tabular-nums">{countOf(schedule[option])}</span>
                </>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {SCHEDULE_VIEWS.map((option) => (
          <TabsContent key={option} value={option}>
            {loading ? <ScheduleSkeleton /> : null}
            {error ? <DriverLoadError error={error} onRetry={reload} /> : null}
            {settled ? <ScheduleDays view={option} days={schedule[option]} /> : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

const countOf = (days: readonly ScheduleDay[]): number =>
  days.reduce((total, day) => total + day.assignments.length, 0);

/**
 * One view's days. Today is one day and the header already names it; upcoming
 * and earlier can span many, so each day gets its own heading.
 */
function ScheduleDays({ view, days }: Readonly<{ view: ScheduleView; days: readonly ScheduleDay[] }>) {
  const { t, language } = useLanguage();

  if (days.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t(EMPTY[view])}</p>;
  }

  return (
    <div className="space-y-5">
      {days.map(({ day, assignments }) => {
        const headingId = `schedule-day-${day}`;
        return (
          <section key={day} aria-labelledby={view === 'today' ? undefined : headingId} className="space-y-2">
            {view === 'today' ? null : (
              <h2 id={headingId} className="text-sm font-semibold text-muted-foreground">
                {formatCalendarWeekday(day, language)}
              </h2>
            )}
            <ul aria-label={view === 'today' ? t('driverViewToday') : undefined} className="space-y-3">
              {assignments.map((assignment) => (
                <li key={assignment.assignment.id}>
                  <AssignmentCard assignment={assignment} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Cards in the shape of the real ones, and one sentence for a screen reader.
 *
 * ★ THE SENTENCE IS THE `<output>`, THE CARDS ARE NOT. `<output>` is a status
 * live region by itself (polite, like `role="status"`) and takes phrasing
 * content only; the skeleton blocks are decoration (`aria-hidden`) beside it.
 */
function ScheduleSkeleton() {
  const { t } = useLanguage();
  return (
    <div className="space-y-3">
      <output className="sr-only">{t('driverLoading')}</output>
      <AssignmentCardSkeleton />
      <AssignmentCardSkeleton />
    </div>
  );
}
