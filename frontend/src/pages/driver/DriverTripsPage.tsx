import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, FileText, Truck, type LucideIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DriverEmptyState } from '@/components/driver/DriverEmptyState';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMyAssignments, useMyWorkday } from '@/hooks/driver';
import { useBusinessToday } from '@/hooks/useBusinessToday';
import { isScheduleView, scheduleOf, SCHEDULE_VIEWS, type ScheduleDay, type ScheduleView } from '@/utils/driverSchedule';
import { isFinalRefusal } from '@/utils/driverErrors';
import { formatCalendarWeekday } from '@/utils/format/datetime';
import type { TranslationKey } from '@/types/translate';
import { AssignmentCard, AssignmentCardSkeleton } from './components/AssignmentCard';
import { DriverLoadError } from './components/DriverLoadError';
import { MyRequestsSection, OpenBookingsSection } from './components/OpenBookingSections';
import { WorkdayPanel } from './components/WorkdayPanel';

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
 *
 * ★ "CA LÀM VIỆC HÔM NAY" LEADS: the lorries of the day, their fuel answer,
 * the trip in hand with "Tiếp tục chuyến", and the next one (`WorkdayPanel`).
 *
 * ★ THREE SECTIONS, AND ONLY THE FIRST IS THE DRIVER'S WORK (0035). "Chuyến
 * của tôi" is their assignments, split by day as before; "Booking đang mở" and
 * "Yêu cầu của tôi" are where they ask for more (`?section=open|requests`). An
 * ask is not a trip: it shows up in "Chuyến của tôi" only once Dispatch
 * approves it and chooses the lorry.
 */

const SECTIONS = ['mine', 'open', 'requests'] as const;
type Section = (typeof SECTIONS)[number];
const isSection = (value: unknown): value is Section => (SECTIONS as readonly unknown[]).includes(value);

const SECTION_LABEL: Record<Section, TranslationKey> = {
  mine: 'driverSectionMine',
  open: 'driverSectionOpen',
  requests: 'driverSectionRequests',
};

/**
 * ★ AN ICON BESIDE EACH SECTION, AND NEVER INSTEAD OF ONE. Three Vietnamese
 * labels of similar length are hard to tell apart at a glance in a lorry cab;
 * a shape is faster than reading. Every icon is `aria-hidden` — the label is
 * the name, and a driver using a screen reader hears exactly what a driver
 * reading hears.
 */
const SECTION_ICON: Record<Section, LucideIcon> = {
  mine: Truck,
  open: CalendarDays,
  requests: FileText,
};

/**
 * ★ TWO ROWS OF TABS, AND THEY MUST NOT LOOK THE SAME.
 *
 * The screen nests one set of tabs inside another: WHICH LIST (my trips · open
 * bookings · my requests) and then, inside "my trips", WHICH DAY. Drawn in the
 * same style, a driver reads six equal buttons and has to work out which row
 * governs which — so the two rows are deliberately different shapes.
 *
 * ⚠ STYLED HERE, NOT IN `components/ui/tabs`. That file is the primitive and
 * the Backoffice draws its own tabs from it; a driver-shaped default there
 * would change a screen nobody asked to change. These are overrides at the one
 * place that wants them.
 */

/** The outer row: full-width tabs, the live one lifted onto white and underlined. */
const SECTION_TAB = {
  // `overflow-hidden` so the lifted white tab cannot square off the container's
  // own rounded corner behind it. `items-stretch` because a label that wraps to
  // two lines makes its own tab taller — centred, the white panel beside it
  // would float with grey above and below, and the underline would stop short
  // of the row.
  list: 'h-auto min-h-14 w-full items-stretch overflow-hidden rounded-xl bg-muted p-0',
  trigger: [
    'min-h-14 gap-2 rounded-none rounded-t-xl border-b-[3px] border-transparent px-2',
    'whitespace-normal leading-tight',
    // The underline is the "you are here", the white panel is the lift; no drop
    // shadow, because the line already separates the tab from the row.
    'data-active:border-primary data-active:bg-background data-active:font-semibold',
    'data-active:text-primary data-active:shadow-none',
  ].join(' '),
} as const;

/**
 * The inner row: pills that hug their words, left-aligned.
 *
 * ★ SIZED TO THE LABEL, NOT TO THE ROW. Three equal thirds would read as a
 * second set of sections; chips that are only as wide as "Hôm nay (0)" read as
 * a filter over the list below, which is what they are.
 *
 * ⚠ `min-h-11` RATHER THAN THE MOCKUP'S 36px. Every tap target in this portal
 * is a 44px thumb, outdoors, in a lorry cab — the pills are a few pixels taller
 * than the drawing on purpose, and `flex-wrap` lets the third one drop to its
 * own line on a narrow phone instead of being squeezed.
 */
const VIEW_TAB = {
  list: 'h-auto w-full flex-wrap justify-start gap-2 rounded-xl bg-muted p-1.5',
  trigger: [
    'min-h-11 flex-none rounded-full border border-border bg-background px-4',
    'text-muted-foreground',
    'data-active:border-transparent data-active:bg-primary/10 data-active:font-semibold',
    'data-active:text-primary data-active:shadow-none',
  ].join(' '),
} as const;

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
  const requestedSection = params.get('section');
  const section: Section = isSection(requestedSection) ? requestedSection : 'mine';
  // The business calendar's today — never the handset's (see `driverSchedule`).
  const today = useBusinessToday();

  // `replace`: switching sections is not a place to go back to. "Mine" is the
  // bare `/driver`, so a notification or the nav lands on today's trips.
  const open = (next: unknown) => {
    if (!isSection(next)) return;
    setParams(next === 'mine' ? {} : { section: next }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{t('driverSchedule')}</h1>
        <p className="text-sm text-muted-foreground">{formatCalendarWeekday(today, language)}</p>
      </header>

      <Tabs value={section} onValueChange={open}>
        <TabsList aria-label={t('driverSchedule')} className={SECTION_TAB.list}>
          {SECTIONS.map((option) => {
            const Icon = SECTION_ICON[option];
            return (
              <TabsTrigger key={option} value={option} className={SECTION_TAB.trigger}>
                {/* `shrink-0` beside a label that may wrap to two lines on a
                    narrow phone: the icon keeps its size and the words move. */}
                <Icon className="size-4 shrink-0" aria-hidden />
                {t(SECTION_LABEL[option])}
              </TabsTrigger>
            );
          })}
        </TabsList>
        <TabsContent value="mine">
          <MyTrips today={today} />
        </TabsContent>
        <TabsContent value="open">
          <OpenBookingsSection />
        </TabsContent>
        <TabsContent value="requests">
          <MyRequestsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** The driver's own assignments, by day — the screen as it was before open bookings. */
function MyTrips({ today }: Readonly<{ today: string }>) {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const { assignments, loading, error, reload } = useMyAssignments();

  /**
   * ★ "HÔM NAY" IS A DIFFERENT QUESTION FROM THE OTHER TWO TABS, AND SO IT IS A
   * DIFFERENT SOURCE.
   *
   * `GET /driver/assignments` answers "what is still to do": it excludes a
   * FINISHED trip by construction (`LIFECYCLE_PREDICATE.operational`). That is
   * right for "Sắp tới" and for "Chưa đóng" — and wrong for today, where a turn
   * the driver finished an hour ago is the main thing they want to see. Counting
   * today from that list is what produced "Hôm nay (0)" sitting under a card
   * that said the day's trips were done.
   *
   * `GET /driver/workday` answers "what is your shift today", finished turns
   * included, with the lorry's fuel obligation beside each. That is the tab.
   *
   * ⚠ SO TWO ADJACENT TABS READ TWO ENDPOINTS, deliberately. Anything that makes
   * them agree by filtering on the client would have to re-derive "is this trip
   * finished", which is the server's to decide and already is.
   */
  const { workday } = useMyWorkday();
  const todayCount = (workday?.vehicles ?? []).reduce((total, lorry) => total + lorry.turns.length, 0);

  const requested = params.get('view');
  const view: ScheduleView = isScheduleView(requested) ? requested : 'today';
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

  // Each tab waits for ITS OWN read before it claims a number. A tab that shows
  // "(0)" because the other endpoint has not answered yet is worse than a tab
  // that shows no number at all for a moment.
  const countReady = (option: ScheduleView): boolean =>
    option === 'today' ? Boolean(workday) : settled;

  return (
    <Tabs value={view} onValueChange={show}>
      <TabsList aria-label={t('driverDaysLabel')} className={VIEW_TAB.list}>
        {SCHEDULE_VIEWS.map((option) => (
          <TabsTrigger key={option} value={option} className={VIEW_TAB.trigger}>
            {t(VIEW_LABEL[option])}
            {/* The space is its own text node: a name is built from each
                element's TRIMMED text, so one inside the span would be lost
                and a screen reader would hear "Hôm nay(2)".

                ★ THE BRACKETS ARE PART OF THE COUNT, not decoration around it.
                A bare number beside a label reads as part of the label — "Hôm
                nay 2" can be a date — and the brackets are what make it a
                tally, to a reader and to a screen reader alike. */}
            {countReady(option) ? (
              <>
                {' '}
                <span className="text-xs tabular-nums">
                  ({option === 'today' ? todayCount : countOf(schedule[option])})
                </span>
              </>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* ★ TODAY IS THE SHIFT PANEL — the lorries, their fuel, the turn in hand
          and the one after it. It owns its own loading, error and empty states
          because it reads its own endpoint. */}
      <TabsContent value="today">
        <WorkdayPanel onSeeUpcoming={() => show('upcoming')} />
      </TabsContent>

      {/* The other two are days of the schedule, from the assignments list. */}
      {SCHEDULE_VIEWS.filter((option) => option !== 'today').map((option) => (
        <TabsContent key={option} value={option}>
          {loading ? <ScheduleSkeleton /> : null}
          {error ? <DriverLoadError error={error} onRetry={reload} /> : null}
          {settled ? (
            <ScheduleDays
              view={option}
              days={schedule[option]}
              onSeeUpcoming={() => show('upcoming')}
              // Leaves the day view behind on purpose: open bookings are not a
              // day of the schedule, so `?view=` would mean nothing there.
              onSeeOpenBookings={() => setParams({ section: 'open' }, { replace: true })}
            />
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

const countOf = (days: readonly ScheduleDay[]): number =>
  days.reduce((total, day) => total + day.assignments.length, 0);

/**
 * One view's days. Today is one day and the header already names it; upcoming
 * and earlier can span many, so each day gets its own heading.
 */
function ScheduleDays({
  view,
  days,
  onSeeUpcoming,
  onSeeOpenBookings,
}: Readonly<{
  view: ScheduleView;
  days: readonly ScheduleDay[];
  /** From an empty TODAY: the next thing to look at is tomorrow. */
  onSeeUpcoming: () => void;
  /** From an empty WEEK: the next thing to do is ask for work (0035). */
  onSeeOpenBookings: () => void;
}>) {
  const { t, language } = useLanguage();

  if (days.length === 0) {
    /**
     * ★ ONE STEP OUT OF EACH EMPTINESS, AND NONE OUT OF THE PAST. Nothing today
     * → look at what is coming. Nothing coming → go and ask for a booking.
     * Nothing already driven → there is no action, and a button here would only
     * be a button for its own sake.
     */
    const WAY_OUT = {
      today: { label: 'driverEmptySeeUpcoming' as const, icon: <CalendarDays aria-hidden />, onClick: onSeeUpcoming },
      upcoming: { label: 'driverEmptySeeOpen' as const, icon: <Truck aria-hidden />, onClick: onSeeOpenBookings },
      past: undefined,
    } satisfies Record<ScheduleView, { label: TranslationKey; icon: ReactNode; onClick: () => void } | undefined>;

    return <DriverEmptyState title="driverEmptyTitle" message={EMPTY[view]} action={WAY_OUT[view]} />;
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
