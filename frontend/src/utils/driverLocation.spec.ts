import { describe, expect, it } from 'vitest';
import { CAPTURE_OPTIONS, LocationError, captureLocation } from './driverLocation';

/**
 * The capture, without a phone.
 *
 * A fake `Geolocation` rather than a patched `navigator`: the function takes
 * the API as a parameter for exactly this reason, so no test here touches a
 * global that another test is relying on.
 */
const succeeding = (over: Partial<GeolocationCoordinates> = {}, timestamp = 1_700_000_000_000) =>
  ({
    getCurrentPosition: (ok: PositionCallback) =>
      ok({
        coords: {
          latitude: 10.8188,
          longitude: 106.6564,
          accuracy: 12,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
          ...over,
        },
        timestamp,
        toJSON: () => ({}),
      }),
  }) as unknown as Geolocation;

const failing = (code: number) =>
  ({
    getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback) =>
      fail?.({ code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }),
  }) as unknown as Geolocation;

describe('captureLocation', () => {
  it('★ sends the reading as given — position, the phone’s accuracy, the phone’s clock', async () => {
    await expect(captureLocation(succeeding())).resolves.toEqual({
      latitude: 10.8188,
      longitude: 106.6564,
      accuracyM: 12,
      capturedAt: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it('★ computes no verdict: nothing in the reading says inside, outside or how far', async () => {
    const reading = await captureLocation(succeeding());
    expect(Object.keys(reading).sort()).toEqual(['accuracyM', 'capturedAt', 'latitude', 'longitude']);
  });

  it('passes a poor accuracy through unchanged — the server decides whether it is enough', async () => {
    const reading = await captureLocation(succeeding({ accuracy: 850 }));
    expect(reading.accuracyM).toBe(850);
  });

  it('refuses a fresh-fix request to be served from cache', () => {
    expect(CAPTURE_OPTIONS.maximumAge).toBe(0);
    expect(CAPTURE_OPTIONS.enableHighAccuracy).toBe(true);
  });

  it('names the browser having no geolocation at all', async () => {
    await expect(captureLocation(undefined)).rejects.toEqual(new LocationError('unsupported'));
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
    [99, 'unavailable'],
  ] as const)('maps API error code %i to "%s"', async (code, kind) => {
    await expect(captureLocation(failing(code))).rejects.toMatchObject({ kind });
  });
});
