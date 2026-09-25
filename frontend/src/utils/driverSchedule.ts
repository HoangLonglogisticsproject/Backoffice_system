import type { DriverTrip } from '@/types/driver';

/**
 * The driver's work schedule, as pure functions over the assignment list.
 *
 * ★ SPLIT BY THE TRIP'S DAY, NEVER BY A STATUS. `GET /driver/assignments`
 * carries no execution events, no completion and no dispatch status (contract
 * §5.4.1), so the list cannot say which work is finished. What it CAN say is
 * which business day each assignment is on — and today, later or earlier is
 * the whole question a driver opening the app asks first.
 *
 * ★ `today` IS A PARAMETER, and the caller takes it from
 * `todayAsCalendarDay()` — the business calendar (Asia/Ho_Chi_Minh), not the
 * handset's. A phone set to another zone must not move a trip into
 * "tomorrow".
 */
export const SCHEDULE_VIEWS = ['today', 'upcoming', 'past'] as const;

export type ScheduleView = (typeof SCHEDULE_VIEWS)[number];

export const isScheduleView = (value: unknown): value is ScheduleView =>
  SCHEDULE_VIEWS.includes(value as ScheduleView);

/**
 * `scheduledOn` and `today` are both `YYYY-MM-DD`, and for that shape string
 * order IS calendar order — so no date is parsed, and no timezone can creep in.
 */
export const scheduleViewOf = (scheduledOn: string, today: string): ScheduleView => {
  if (scheduledOn === today) return 'today';
  return scheduledOn > today ? 'upcoming' : 'past';
};

/** One business day and the assignments on it, in the order they are driven. */
export interface ScheduleDay {
  day: string;
  assignments: DriverTrip[];
}

/**
 * Within a day, by planned pickup; one with no pickup time yet goes last.
 *
 * The instants compare as strings for the reason `utils/driverExecution`
 * spells out: the API serialises every stamp as `YYYY-MM-DDTHH:mm:ss.sssZ`.
 * `sort` is stable, so equal times keep the server's order — which is how two
 * lorries of one trip stay in the order they were assigned.
 */
const byPlannedPickup = (a: DriverTrip, b: DriverTrip): number => {
  if (a.scheduledPickupAt === b.scheduledPickupAt) return 0;
  if (a.scheduledPickupAt === null) return 1;
  if (b.scheduledPickupAt === null) return -1;
  return a.scheduledPickupAt < b.scheduledPickupAt ? -1 : 1;
};

/**
 * Every assignment in its view, grouped by day.
 *
 * Today and upcoming read forward — the next thing first. The past reads
 * backward — yesterday before last week — because the only reason to look
 * there is the most recent work.
 */
export const scheduleOf = (
  assignments: readonly DriverTrip[],
  today: string,
): Record<ScheduleView, ScheduleDay[]> => {
  const byDay = new Map<string, DriverTrip[]>();
  for (const assignment of assignments) {
    const day = byDay.get(assignment.scheduledOn);
    if (day) day.push(assignment);
    else byDay.set(assignment.scheduledOn, [assignment]);
  }

  const schedule: Record<ScheduleView, ScheduleDay[]> = { today: [], upcoming: [], past: [] };
  for (const [day, onDay] of byDay) {
    schedule[scheduleViewOf(day, today)].push({ day, assignments: onDay.sort(byPlannedPickup) });
  }

  schedule.upcoming.sort((a, b) => a.day.localeCompare(b.day));
  schedule.past.sort((a, b) => b.day.localeCompare(a.day));
  return schedule;
};

/**
 * The mark a schedule card leaves on the history entry it opens.
 *
 * ★ HOW THE DETAIL KNOWS "BACK" IS THE SCHEDULE. Only an entry carrying this
 * was pushed from the schedule, so only then is the previous entry the tab
 * the driver left — and going back through history keeps that tab and its
 * scroll. Anything else (a shared link, a login redirect that replaced its
 * own entry) has no schedule behind it and goes to `/driver` instead.
 */
export const OPENED_FROM_SCHEDULE = { from: 'schedule' } as const;

export const wasOpenedFromSchedule = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && 'from' in state && state.from === OPENED_FROM_SCHEDULE.from;
