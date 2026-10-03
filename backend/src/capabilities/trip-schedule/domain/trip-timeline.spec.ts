import { boardDayFor, calendarRefusal, deliversBeforePickup } from './trip-timeline';

/** A Hồ Chí Minh wall-clock time (UTC+7, no DST) as the instant it is. */
const hcm = (local: string): Date => new Date(`${local}:00+07:00`);

describe('the timeline: delivery strictly after pickup', () => {
  it.each([
    ['23/09 17:36 → 23/09 16:36 (same day, earlier)', '2026-09-23T17:36', '2026-09-23T16:36', true],
    ['23/09 17:36 → 23/09 17:36 (the same instant)', '2026-09-23T17:36', '2026-09-23T17:36', true],
    ['23/09 17:36 → 24/09 16:36 (next day, earlier hour)', '2026-09-23T17:36', '2026-09-24T16:36', false],
    ['23/09 17:36 → 23/09 17:37', '2026-09-23T17:36', '2026-09-23T17:37', false],
  ])('%s', (_case, pickup, delivery, refused) => {
    expect(deliversBeforePickup(hcm(pickup), hcm(delivery))).toBe(refused);
  });

  it('has nothing to compare while either end is unknown — partial data is legal', () => {
    expect(deliversBeforePickup(null, hcm('2026-09-23T16:36'))).toBe(false);
    expect(deliversBeforePickup(hcm('2026-09-23T17:36'), null)).toBe(false);
    expect(deliversBeforePickup(null, null)).toBe(false);
  });
});

describe('the board day is the pickup day', () => {
  it('★ derives the day from the pickup, on the Hồ Chí Minh calendar — not UTC', () => {
    // 00:30 on the 24th in the office is still the 23rd in UTC.
    expect(boardDayFor({ pickupAt: hcm('2026-09-24T00:30'), scheduledOn: undefined }, null)).toEqual({
      ok: true,
      day: '2026-09-24',
    });
  });

  it('accepts a day sent beside a pickup when the two agree', () => {
    expect(boardDayFor({ pickupAt: hcm('2026-09-23T17:36'), scheduledOn: '2026-09-23' }, null)).toEqual({
      ok: true,
      day: '2026-09-23',
    });
  });

  it('★ refuses a day that contradicts the pickup — 29/09 beside 23/09 17:36', () => {
    expect(boardDayFor({ pickupAt: hcm('2026-09-23T17:36'), scheduledOn: '2026-09-29' }, null)).toEqual({
      ok: false,
      reason: 'NOT_THE_PICKUP_DAY',
    });
  });

  it('takes the bare day when no hour is known yet, and needs one or the other', () => {
    expect(boardDayFor({ pickupAt: null, scheduledOn: '2026-09-23' }, null)).toEqual({ ok: true, day: '2026-09-23' });
    expect(boardDayFor({ pickupAt: null, scheduledOn: undefined }, null)).toEqual({
      ok: false,
      reason: 'DAY_REQUIRED',
    });
  });

  describe('on a correction', () => {
    /** A row typed before the rule: its day disagrees with its pickup. */
    const legacy = { pickupAt: hcm('2026-09-23T17:36'), scheduledOn: '2026-09-29' };

    it('★ keeps a stored mismatch through an edit that moves neither — no silent re-dating', () => {
      expect(boardDayFor({ pickupAt: hcm('2026-09-23T17:36'), scheduledOn: undefined }, legacy)).toEqual({
        ok: true,
        day: '2026-09-29',
      });
      // An older client re-sending both, unchanged, is not moving anything either.
      expect(boardDayFor({ ...legacy }, legacy)).toEqual({ ok: true, day: '2026-09-29' });
    });

    it('★ re-derives the day when the pickup moves, and so converges the row', () => {
      expect(boardDayFor({ pickupAt: hcm('2026-09-25T08:00'), scheduledOn: undefined }, legacy)).toEqual({
        ok: true,
        day: '2026-09-25',
      });
    });

    it('refuses moving the day away from a pickup that stays', () => {
      const stored = { pickupAt: hcm('2026-09-23T17:36'), scheduledOn: '2026-09-23' };
      expect(boardDayFor({ pickupAt: stored.pickupAt, scheduledOn: '2026-09-29' }, stored)).toEqual({
        ok: false,
        reason: 'NOT_THE_PICKUP_DAY',
      });
    });

    it('keeps the stored day when the pickup is cleared', () => {
      const stored = { pickupAt: hcm('2026-09-23T17:36'), scheduledOn: '2026-09-23' };
      expect(boardDayFor({ pickupAt: null, scheduledOn: undefined }, stored)).toEqual({ ok: true, day: '2026-09-23' });
    });
  });
});

describe('the calendar policy is the intent’s', () => {
  // Today is 29/09, and it is 14:00 in the office.
  const now = hcm('2026-09-29T14:00');
  const entry = (scheduledOn: string, pickup?: string, delivery?: string) => ({
    scheduledOn,
    pickupAt: pickup ? hcm(pickup) : null,
    deliveryAt: delivery ? hcm(delivery) : null,
  });

  describe('a booking (operational)', () => {
    it('★ refuses a past DAY, and an hour today already gone', () => {
      expect(calendarRefusal('operational', entry('2026-09-28'), now)).toEqual({
        field: 'scheduledOn',
        reason: 'PAST_DAY',
      });
      expect(calendarRefusal('operational', entry('2026-09-29', '2026-09-29T08:00'), now)).toEqual({
        field: 'pickupAt',
        reason: 'PAST_INSTANT',
      });
    });

    it('★ refuses today with no hour — nothing would show the pickup is not already gone', () => {
      expect(calendarRefusal('operational', entry('2026-09-29'), now)).toEqual({
        field: 'pickupAt',
        reason: 'TIME_REQUIRED',
      });
    });

    it('takes a later day with no hour — there the hour stays optional', () => {
      expect(calendarRefusal('operational', entry('2026-09-30'), now)).toBeNull();
    });

    it('★ takes a future pickup hour — that is what a booking is', () => {
      expect(
        calendarRefusal('operational', entry('2026-09-29', '2026-09-29T15:00', '2026-09-29T18:00'), now),
      ).toBeNull();
      expect(calendarRefusal('operational', entry('2026-10-01', '2026-10-01T08:00'), now)).toBeNull();
    });
  });

  describe('★ a booking at 2026-10-03 10:52:43 (Hồ Chí Minh) — the operational boundary', () => {
    const now = new Date('2026-10-03T10:52:43+07:00');
    const booking = (pickup: string) => ({
      scheduledOn: pickup.slice(0, 10),
      pickupAt: pickup.length > 10 ? hcm(pickup) : null,
      deliveryAt: null,
    });

    it.each([
      ['yesterday', '2026-10-02', { field: 'scheduledOn', reason: 'PAST_DAY' }],
      ['today, no pickup time', '2026-10-03', { field: 'pickupAt', reason: 'TIME_REQUIRED' }],
      ['today 09:00', '2026-10-03T09:00', { field: 'pickupAt', reason: 'PAST_INSTANT' }],
      ['today 10:51', '2026-10-03T10:51', { field: 'pickupAt', reason: 'PAST_INSTANT' }],
      ['today 10:52 — the current minute, seconds ignored', '2026-10-03T10:52', null],
      ['today 10:53', '2026-10-03T10:53', null],
      ['today 11:00', '2026-10-03T11:00', null],
      ['tomorrow, no pickup time', '2026-10-04', null],
      ['tomorrow 08:00', '2026-10-04T08:00', null],
    ])('%s → %j', (_case, pickup, refusal) => {
      expect(calendarRefusal('operational', booking(pickup), now)).toEqual(refusal);
    });

    it('leaves the historical intent its own rule — today with no hour, or 09:00, is a run that happened', () => {
      expect(calendarRefusal('historical', booking('2026-10-03'), now)).toBeNull();
      expect(calendarRefusal('historical', booking('2026-10-03T09:00'), now)).toBeNull();
      expect(calendarRefusal('historical', booking('2026-10-03T10:53'), now)).toEqual({
        field: 'pickupAt',
        reason: 'FUTURE_INSTANT',
      });
    });

    it('reads the business clock, not the server’s — 03:52 UTC is 10:52 in Hồ Chí Minh', () => {
      expect(calendarRefusal('operational', booking('2026-10-03T10:51'), new Date('2026-10-03T03:52:00Z'))).toEqual({
        field: 'pickupAt',
        reason: 'PAST_INSTANT',
      });
    });
  });

  describe('a recorded run (historical) — it has happened AND ended', () => {
    it('★ refuses tomorrow', () => {
      expect(calendarRefusal('historical', entry('2026-09-30'), now)).toEqual({
        field: 'scheduledOn',
        reason: 'FUTURE_DAY',
      });
    });

    it('★ refuses today with a pickup later than now — 15:00 at 14:00', () => {
      expect(calendarRefusal('historical', entry('2026-09-29', '2026-09-29T15:00', '2026-09-29T18:00'), now)).toEqual(
        { field: 'pickupAt', reason: 'FUTURE_INSTANT' },
      );
    });

    it('★ refuses today with a delivery later than now, the pickup already past', () => {
      expect(calendarRefusal('historical', entry('2026-09-29', '2026-09-29T10:00', '2026-09-29T18:00'), now)).toEqual(
        { field: 'deliveryAt', reason: 'FUTURE_INSTANT' },
      );
    });

    it('★ takes exact times already past — today’s included — and takes none at all', () => {
      expect(calendarRefusal('historical', entry('2026-09-29', '2026-09-29T08:00', '2026-09-29T13:59'), now)).toBeNull();
      expect(calendarRefusal('historical', entry('2026-09-22', '2026-09-22T17:36', '2026-09-23T16:36'), now)).toBeNull();
      expect(calendarRefusal('historical', entry('2026-09-29'), now)).toBeNull();
      expect(calendarRefusal('historical', entry('2026-09-29', '2026-09-29T09:00'), now)).toBeNull();
    });
  });

  it('holds no policy for an in-process caller that names no intent', () => {
    expect(calendarRefusal(undefined, entry('2020-01-01'), now)).toBeNull();
    expect(calendarRefusal(undefined, entry('2099-01-01', '2099-01-01T08:00'), now)).toBeNull();
  });

  it('reads today on the business calendar, not the server’s', () => {
    // 23:30 UTC on the 28th is already the 29th in Hồ Chí Minh.
    expect(calendarRefusal('operational', entry('2026-09-28'), new Date('2026-09-28T23:30:00Z'))).toEqual({
      field: 'scheduledOn',
      reason: 'PAST_DAY',
    });
  });
});
