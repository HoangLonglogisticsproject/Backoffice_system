import { describe, expect, it } from 'vitest';
import type { TripScheduleWithRefs } from '@/types/trip';
import { instantsOf, timesOf, timesPayload } from './tripFormTimes';

/** Only the three fields this module reads. */
const stored = (over: Partial<TripScheduleWithRefs>): TripScheduleWithRefs =>
  ({ scheduledOn: '2026-09-23', pickupAt: null, deliveryAt: null, ...over }) as TripScheduleWithRefs;

describe('the form’s temporal fields', () => {
  it('★ reads the delivery on the business clock too — one clock for the whole form', () => {
    expect(timesOf(stored({ deliveryAt: '2026-09-24T09:36:00.000Z' })).deliveryAt).toBe('2026-09-24T16:36');
    expect(instantsOf({ scheduledOn: '', pickupTime: '', deliveryAt: '2026-09-24T16:36' }).deliveryAt).toBe(
      '2026-09-24T09:36:00.000Z',
    );
  });

  it('★ reads the hour on the business clock, beside the date the server sent', () => {
    // 10:36 UTC is 17:36 in Hồ Chí Minh, whatever zone the suite runs in.
    expect(timesOf(stored({ pickupAt: '2026-09-23T10:36:00.000Z' }))).toMatchObject({
      scheduledOn: '2026-09-23',
      pickupTime: '17:36',
    });
  });

  it('★ names no pickup instant while the hour is unknown — never midnight', () => {
    expect(instantsOf({ scheduledOn: '2026-09-23', pickupTime: '', deliveryAt: '' })).toEqual({
      pickupAt: null,
      deliveryAt: null,
    });
    expect(instantsOf({ scheduledOn: '2026-09-23', pickupTime: '17:36', deliveryAt: '' }).pickupAt).toBe(
      '2026-09-23T10:36:00.000Z',
    );
  });

  it('sends every temporal field on a new trip', () => {
    expect(timesPayload({ scheduledOn: '2026-10-02', pickupTime: '', deliveryAt: '' }, null)).toEqual({
      scheduledOn: '2026-10-02',
      pickupAt: null,
      deliveryAt: null,
    });
  });

  it('★ sends nothing temporal on a correction that did not touch it — an hourless record stays so', () => {
    const legacy = stored({});
    expect(timesPayload(timesOf(legacy), legacy)).toEqual({});
  });

  it('★ sends the date and hour as a PAIR once either is touched, and the delivery on its own', () => {
    const trip = stored({ pickupAt: '2026-09-23T10:36:00.000Z' });

    expect(timesPayload({ ...timesOf(trip), scheduledOn: '2026-09-24' }, trip)).toEqual({
      scheduledOn: '2026-09-24',
      pickupAt: '2026-09-24T10:36:00.000Z',
    });
    expect(Object.keys(timesPayload({ ...timesOf(trip), deliveryAt: '2026-09-24T16:36' }, trip))).toEqual([
      'deliveryAt',
    ]);
  });
});
