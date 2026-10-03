import { describe, expect, it } from 'vitest';
import { calendarError, deliversBeforePickup, timelineErrors } from './tripTimeline';

/** A Hồ Chí Minh wall-clock time as the ISO instant it is. */
const hcm = (local: string): string => new Date(`${local}:00+07:00`).toISOString();

describe('deliversBeforePickup — only when both exact instants are known', () => {
  it.each([
    ['same day, an hour earlier', '2026-09-23T17:36', '2026-09-23T16:36', true],
    ['the same instant', '2026-09-23T17:36', '2026-09-23T17:36', true],
    ['next day, an earlier hour', '2026-09-23T17:36', '2026-09-24T16:36', false],
    ['a minute later', '2026-09-23T17:36', '2026-09-23T17:37', false],
  ])('%s', (_case, pickup, delivery, refused) => {
    expect(deliversBeforePickup(hcm(pickup), hcm(delivery))).toBe(refused);
  });

  it('★ says nothing while an hour is unknown — partial times are ordinary', () => {
    expect(deliversBeforePickup(null, hcm('2026-09-23T16:36'))).toBe(false);
    expect(deliversBeforePickup(hcm('2026-09-23T17:36'), null)).toBe(false);
  });
});

describe('calendarError — the entry intent’s policy, on the pickup DATE', () => {
  const now = new Date('2026-09-29T03:00:00Z'); // 10:00 in Hồ Chí Minh

  it('★ a booking refuses a past day and takes today and after', () => {
    expect(calendarError('operational', '2026-09-28', now)).toBe('pickupOnPastDay');
    expect(calendarError('operational', '2026-09-29', now)).toBeNull();
    expect(calendarError('operational', '2026-10-01', now)).toBeNull();
  });

  it('★ a recorded run refuses a future day and takes today and before', () => {
    expect(calendarError('historical', '2026-09-22', now)).toBeNull();
    expect(calendarError('historical', '2026-09-29', now)).toBeNull();
    expect(calendarError('historical', '2026-09-30', now)).toBe('historicalInFuture');
  });

  it('applies no policy to a correction — an overdue trip is fixed, not re-booked', () => {
    expect(calendarError(null, '2020-01-01', now)).toBeNull();
  });
});

describe('timelineErrors', () => {
  it('★ holds the timeline in every mode, and puts each refusal under its own field', () => {
    const backwards = { scheduledOn: '2026-09-23', pickupAt: hcm('2026-09-23T17:36'), deliveryAt: hcm('2026-09-23T16:36') };
    // A booking typed that morning, both hours ahead; a record or a
    // correction at 23:00, both hours past.
    const nowFor = (mode: 'operational' | 'historical' | null) =>
      new Date(hcm(mode === 'operational' ? '2026-09-23T08:00' : '2026-09-23T23:00'));
    for (const mode of ['operational', 'historical', null] as const) {
      expect(timelineErrors(backwards, mode, nowFor(mode))).toEqual({
        scheduledOn: null,
        pickupAt: null,
        deliveryAt: 'deliveryNotAfterPickup',
      });
    }
  });

  describe('★ a booking at 2026-10-03 10:52 — the server’s boundary, mirrored', () => {
    const now = new Date(hcm('2026-10-03T10:52'));
    const booking = (pickup: string) => ({ scheduledOn: pickup.slice(0, 10), pickupAt: hcm(pickup), deliveryAt: null });
    const clear = { scheduledOn: null, pickupAt: null, deliveryAt: null };

    it.each([
      ['2026-10-03T09:00', { ...clear, pickupAt: 'pickupInPast' }],
      ['2026-10-03T10:51', { ...clear, pickupAt: 'pickupInPast' }],
      ['2026-10-03T10:52', clear],
      ['2026-10-03T11:00', clear],
      ['2026-10-04T08:00', clear],
    ])('%s → %j', (pickup, errors) => {
      expect(timelineErrors(booking(pickup), 'operational', now)).toEqual(errors);
    });

    it('refuses yesterday once, under the date', () => {
      expect(timelineErrors(booking('2026-10-02T15:00'), 'operational', now)).toEqual({
        ...clear,
        scheduledOn: 'pickupOnPastDay',
      });
    });

    it('takes today with no hour, and leaves a correction (no intent) alone', () => {
      expect(timelineErrors({ scheduledOn: '2026-10-03', pickupAt: null, deliveryAt: null }, 'operational', now)).toEqual(
        clear,
      );
      expect(timelineErrors(booking('2026-10-03T09:00'), null, now)).toEqual(clear);
    });
  });

  describe('★ a recorded run has ended — at 14:00 on 29/09', () => {
    const now = new Date(hcm('2026-09-29T14:00'));
    const entry = (scheduledOn: string, pickup?: string, delivery?: string) => ({
      scheduledOn,
      pickupAt: pickup ? hcm(pickup) : null,
      deliveryAt: delivery ? hcm(delivery) : null,
    });

    it('refuses tomorrow, once, under the date', () => {
      expect(timelineErrors(entry('2026-09-30', '2026-09-30T08:00'), 'historical', now)).toEqual({
        scheduledOn: 'historicalInFuture',
        pickupAt: null,
        deliveryAt: null,
      });
    });

    it('★ refuses 15:00 today, and a delivery at 18:00 today', () => {
      expect(timelineErrors(entry('2026-09-29', '2026-09-29T15:00', '2026-09-29T18:00'), 'historical', now)).toEqual({
        scheduledOn: null,
        pickupAt: 'historicalInstantInFuture',
        deliveryAt: 'historicalInstantInFuture',
      });
    });

    it('★ takes hours already past, and no hours at all', () => {
      const clear = { scheduledOn: null, pickupAt: null, deliveryAt: null };
      expect(timelineErrors(entry('2026-09-29', '2026-09-29T08:00', '2026-09-29T13:59'), 'historical', now)).toEqual(clear);
      expect(timelineErrors(entry('2026-09-29'), 'historical', now)).toEqual(clear);
    });

    it('★ leaves a BOOKING’s future hours alone — that is what a booking is for', () => {
      expect(timelineErrors(entry('2026-09-29', '2026-09-29T15:00', '2026-09-29T18:00'), 'operational', now)).toEqual({
        scheduledOn: null,
        pickupAt: null,
        deliveryAt: null,
      });
    });
  });
});
