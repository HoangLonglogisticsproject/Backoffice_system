import type { LocationEvidence } from '@/types/driver';

/**
 * One fresh reading from the handset, or a named reason there is none.
 *
 * ★ THE BROWSER IS A SENSOR, NOT A JUDGE. This asks the Geolocation API where
 * the phone is and hands the answer to the server exactly as given — position,
 * the phone's own accuracy estimate, the phone's own timestamp. It computes no
 * distance, decides nothing about a geofence, and sends nothing that looks like
 * a verdict. The server owns the trip's coordinates and the rule.
 *
 * ★ FOUR FAILURES, TOLD APART, because each is a different thing for the
 * driver to DO: enable permission, step outside, wait and retry, or use a
 * different phone. Collapsing them into "location failed" leaves somebody in a
 * lorry cab guessing which.
 */
export type LocationFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export class LocationError extends Error {
  constructor(readonly kind: LocationFailure) {
    super(`Location ${kind}`);
    this.name = 'LocationError';
  }
}

export const isLocationError = (error: unknown): error is LocationError =>
  error instanceof LocationError;

/**
 * ★ A FRESH FIX, EVERY TIME. `maximumAge: 0` refuses a cached position — the
 * server rejects a stale one anyway, and a reading captured at the previous
 * stop is exactly the thing a pickup confirmation must not be built on.
 * High accuracy asks for GPS rather than cell towers; the server's accuracy
 * ceiling would refuse most tower fixes regardless. Twenty seconds is long
 * enough for a cold GPS start under open sky and short enough that a phone in
 * a basement fails with a message instead of a spinner.
 */
export const CAPTURE_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 0,
};

/** The three codes the API defines, by number so no global is needed in tests. */
const FAILURE_BY_CODE: Record<number, LocationFailure> = {
  1: 'denied',
  2: 'unavailable',
  3: 'timeout',
};

export function captureLocation(
  geolocation: Geolocation | undefined = globalThis.navigator?.geolocation,
): Promise<LocationEvidence> {
  if (!geolocation) return Promise.reject(new LocationError('unsupported'));

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          // The HANDSET's clock. The server measures freshness against
          // `deviceReportedAt` — the same clock — so a wrong clock cancels
          // out, and neither stamp ever becomes the pickup's `actual_at`.
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      (failure) => reject(new LocationError(FAILURE_BY_CODE[failure.code] ?? 'unavailable')),
      CAPTURE_OPTIONS,
    );
  });
}
