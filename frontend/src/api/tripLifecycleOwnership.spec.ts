import { describe, expect, it } from 'vitest';

/**
 * ★ THE BACKOFFICE DRIVES NO TRIP LIFECYCLE — read off the source itself.
 *
 * The server owns the status: a booking opens `pending`, the driver's first
 * milestone starts it, approval closes it. Two server routes stand outside
 * that and must have NO caller here:
 *
 *   PATCH /trip-schedules/:id/status    removed — a call would only 404
 *   POST  /trip-schedules/:id/complete  break-glass, `trip.complete.review`,
 *                                       deliberately offered by no screen
 *
 * A type check cannot see a URL, and a unit test only covers the screens it
 * renders; this reads every production module.
 */
const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.spec.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** A string ending in `/complete` or `/status` right before its closing quote. */
const TRIP_LIFECYCLE_ROUTE = /\/(complete|status)[`'"]/;

describe('the Backoffice and the trip lifecycle', () => {
  it('reads a real set of modules', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('★ calls neither the break-glass completion nor a trip status route from any module', () => {
    const offenders = Object.entries(sources)
      .filter(([, code]) => code.includes('trip-schedules') || code.includes('tripPath('))
      .filter(([, code]) => TRIP_LIFECYCLE_ROUTE.test(code))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it('keeps no client for them either — the wrappers are gone', () => {
    const offenders = Object.entries(sources)
      .filter(([, code]) => /\b(completeTrip|updateTripStatus|useCompleteTrip|useUpdateTripStatus)\b/.test(code))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
