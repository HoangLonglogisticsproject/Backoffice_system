import { describe, expect, it } from 'vitest';
import { isScheduleView, scheduleOf, scheduleViewOf } from './driverSchedule';
import type { ScheduleDay } from './driverSchedule';
import type { DriverTrip } from '@/types/driver';

const TODAY = '2026-08-30';

const assignment = (id: string, scheduledOn: string, scheduledPickupAt: string | null = null): DriverTrip => ({
  tripId: `t-${id}`,
  scheduledOn,
  vehicle: { id: `v-${id}`, plate: '51D65233' },
  customer: { id: 'c1', name: 'VIỄN ĐẠT' },
  pickupAddress: 'BÃI XE MIỀN NAM',
  pickupContact: null,
  deliveryAddress: 'TCS',
  deliveryContact: null,
  cargoInfo: null,
  pickupLocation: null,
  deliveryLocation: null,
  scheduledPickupAt,
  scheduledDeliveryAt: null,
  driverInstructions: null,
  assignment: { id, assignedAt: '2026-08-29T01:00:00.000Z' },
});

/** Each day as `[day, assignment ids]` — the shape the screen renders. */
const ids = (days: ScheduleDay[]) => days.map(({ day, assignments }) => [day, assignments.map((a) => a.assignment.id)]);

describe('isScheduleView', () => {
  it.each(['today', 'upcoming', 'past'])('accepts %s', (view) => {
    expect(isScheduleView(view)).toBe(true);
  });

  // ★ The view comes from `?view=` — anything a user can type into a URL.
  it.each(['done', '', null, undefined, 1])('rejects %j', (value) => {
    expect(isScheduleView(value)).toBe(false);
  });
});

describe('scheduleViewOf', () => {
  it.each([
    ['2026-08-30', '2026-08-30', 'today'],
    ['2026-08-31', '2026-08-30', 'upcoming'],
    ['2026-08-29', '2026-08-30', 'past'],
    ['2026-09-01', '2026-08-31', 'upcoming'],
    ['2026-08-31', '2026-09-01', 'past'],
    ['2027-01-01', '2026-12-31', 'upcoming'],
    ['2026-12-31', '2027-01-01', 'past'],
  ])('%s against today %s is %s', (scheduledOn, today, view) => {
    expect(scheduleViewOf(scheduledOn, today)).toBe(view);
  });
});

describe('scheduleOf', () => {
  it('answers three empty views for no work', () => {
    expect(scheduleOf([], TODAY)).toEqual({ today: [], upcoming: [], past: [] });
  });

  it('groups by scheduledOn into its view', () => {
    const schedule = scheduleOf(
      [
        assignment('a1', '2026-08-30'),
        assignment('a2', '2026-08-31'),
        assignment('a3', '2026-08-30'),
        assignment('a4', '2026-08-29'),
      ],
      TODAY,
    );

    expect(ids(schedule.today)).toEqual([['2026-08-30', ['a1', 'a3']]]);
    expect(ids(schedule.upcoming)).toEqual([['2026-08-31', ['a2']]]);
    expect(ids(schedule.past)).toEqual([['2026-08-29', ['a4']]]);
  });

  it('reads upcoming forward and the past backward — the nearest day first either way', () => {
    const schedule = scheduleOf(
      [
        assignment('u3', '2026-09-15'),
        assignment('p1', '2026-08-29'),
        assignment('u1', '2026-08-31'),
        assignment('p3', '2026-07-01'),
        assignment('u2', '2026-09-01'),
        assignment('p2', '2026-08-01'),
      ],
      TODAY,
    );

    expect(schedule.upcoming.map((d) => d.day)).toEqual(['2026-08-31', '2026-09-01', '2026-09-15']);
    expect(schedule.past.map((d) => d.day)).toEqual(['2026-08-29', '2026-08-01', '2026-07-01']);
  });

  it('orders a day by planned pickup, with no pickup time last', () => {
    const schedule = scheduleOf(
      [
        assignment('none-1', TODAY, null),
        assignment('late', TODAY, '2026-08-30T09:00:00.000Z'),
        assignment('none-2', TODAY, null),
        assignment('early', TODAY, '2026-08-30T01:00:00.000Z'),
      ],
      TODAY,
    );

    expect(ids(schedule.today)).toEqual([[TODAY, ['early', 'late', 'none-1', 'none-2']]]);
  });

  it('★ keeps the server order on equal pickup times — two lorries of one trip stay as assigned', () => {
    // Deliberately NOT id order: the server's order is the assignment order,
    // and a re-sort by anything else would swap the lorries on the driver.
    const pickup = '2026-08-30T01:00:00.000Z';
    const schedule = scheduleOf([assignment('lorry-b', TODAY, pickup), assignment('lorry-a', TODAY, pickup)], TODAY);

    expect(ids(schedule.today)).toEqual([[TODAY, ['lorry-b', 'lorry-a']]]);
  });

  it('leaves the caller’s array in its original order', () => {
    // The list is the TanStack Query cache; sorting it in place would reorder
    // the cached response under every other reader.
    const input = [
      assignment('late', TODAY, '2026-08-30T09:00:00.000Z'),
      assignment('past', '2026-08-01'),
      assignment('early', TODAY, '2026-08-30T01:00:00.000Z'),
      assignment('next', '2026-09-01'),
    ];

    scheduleOf(input, TODAY);

    expect(input.map((a) => a.assignment.id)).toEqual(['late', 'past', 'early', 'next']);
  });
});
