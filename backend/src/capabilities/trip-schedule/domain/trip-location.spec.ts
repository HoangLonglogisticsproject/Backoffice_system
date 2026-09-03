import {
  PICKUP_LOCATION_POLICY,
  checkPickupLocation,
  distanceMeters,
  isCoordinates,
  isLatitude,
  isLongitude,
  type LocationEvidence,
} from './trip-location';

/**
 * The geofence rule, without a server.
 *
 * ★ THE BOUNDARIES ARE THE CASES. A distance that is clearly inside or clearly
 * outside is decided by any formula; what has to be pinned is which way the
 * rule falls when the number is exactly on the line, and whether the formula
 * survives the two places on the globe where naive arithmetic does not.
 */

/** Tân Sơn Nhất cargo terminal, roughly. */
const SCSC = { latitude: 10.8188, longitude: 106.6564 };

const NOW = new Date('2026-08-30T02:30:00.000Z');

const fix = (over: Partial<LocationEvidence> = {}): LocationEvidence => ({
  latitude: SCSC.latitude,
  longitude: SCSC.longitude,
  accuracyM: 12,
  capturedAt: new Date(NOW.getTime() - 5_000),
  ...over,
});

/** A point `metres` due north of `from`. One degree of latitude ≈ 111.195 km. */
const north = (from: typeof SCSC, metres: number) => ({
  latitude: from.latitude + metres / 111_195,
  longitude: from.longitude,
});

describe('coordinate validation', () => {
  it.each([-90, 0, 90, 10.8188])('accepts latitude %p', (value) => {
    expect(isLatitude(value)).toBe(true);
  });

  it.each([-90.0001, 90.0001, Number.NaN, Number.POSITIVE_INFINITY, '10', null, undefined])(
    'refuses latitude %p',
    (value) => {
      expect(isLatitude(value)).toBe(false);
    },
  );

  it.each([-180, 0, 180, 106.6564])('accepts longitude %p', (value) => {
    expect(isLongitude(value)).toBe(true);
  });

  it.each([-180.0001, 180.0001, Number.NaN, Number.NEGATIVE_INFINITY, '106'])(
    'refuses longitude %p',
    (value) => {
      expect(isLongitude(value)).toBe(false);
    },
  );

  it('needs both halves', () => {
    expect(isCoordinates(null)).toBe(false);
    expect(isCoordinates({ latitude: 10, longitude: Number.NaN })).toBe(false);
    expect(isCoordinates(SCSC)).toBe(true);
  });
});

describe('distanceMeters', () => {
  it('is zero from a point to itself', () => {
    expect(distanceMeters(SCSC, SCSC)).toBe(0);
  });

  it('is symmetric', () => {
    const other = { latitude: 10.7769, longitude: 106.7009 };
    expect(distanceMeters(SCSC, other)).toBeCloseTo(distanceMeters(other, SCSC), 6);
  });

  it('measures one degree of latitude as ~111.2 km', () => {
    const d = distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeGreaterThan(111_100);
    expect(d).toBeLessThan(111_300);
  });

  it('★ is short across the ±180° meridian, not most of the way round the world', () => {
    // 0.1° apart on either side of the date line. A formula that subtracted
    // longitudes and stopped there would call this 359.9°.
    const west = { latitude: 0, longitude: -179.95 };
    const east = { latitude: 0, longitude: 179.95 };
    expect(distanceMeters(west, east)).toBeLessThan(11_200);
  });

  it('★ is finite and small between two points at the pole', () => {
    // Every longitude is the same place at 90°N.
    const a = { latitude: 90, longitude: 0 };
    const b = { latitude: 90, longitude: 137 };
    expect(distanceMeters(a, b)).toBeCloseTo(0, 3);
  });

  it('never produces NaN from rounding on antipodes', () => {
    const d = distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(Math.PI * 6_371_008.8, 0);
  });
});

describe('checkPickupLocation', () => {
  it('passes a fresh, precise reading at the destination', () => {
    expect(checkPickupLocation(SCSC, fix(), NOW)).toEqual({ passed: true, distanceM: 0 });
  });

  it('refuses before anything else when the destination has no coordinates', () => {
    // Even a perfect reading cannot be measured against nowhere — and the
    // driver is told it is not their reading that is wrong.
    expect(checkPickupLocation(null, fix(), NOW)).toMatchObject({ reason: 'DESTINATION_MISSING' });
  });

  it('refuses when no reading was sent', () => {
    expect(checkPickupLocation(SCSC, null, NOW)).toMatchObject({ reason: 'LOCATION_REQUIRED' });
  });

  it.each([
    ['latitude NaN', fix({ latitude: Number.NaN })],
    ['longitude NaN', fix({ longitude: Number.NaN })],
    ['latitude out of range', fix({ latitude: 91 })],
    ['longitude out of range', fix({ longitude: -181 })],
    ['negative accuracy', fix({ accuracyM: -1 })],
    ['accuracy NaN', fix({ accuracyM: Number.NaN })],
  ])('refuses %s as invalid', (_label, evidence) => {
    expect(checkPickupLocation(SCSC, evidence, NOW)).toMatchObject({ reason: 'INVALID_COORDINATES' });
  });

  it('refuses a reading looser than the accuracy ceiling', () => {
    const evidence = fix({ accuracyM: PICKUP_LOCATION_POLICY.maxAccuracyM + 0.1 });
    expect(checkPickupLocation(SCSC, evidence, NOW)).toMatchObject({ reason: 'ACCURACY_INSUFFICIENT' });
  });

  it('accepts a reading exactly at the accuracy ceiling', () => {
    const evidence = fix({ accuracyM: PICKUP_LOCATION_POLICY.maxAccuracyM });
    expect(checkPickupLocation(SCSC, evidence, NOW)).toMatchObject({ passed: true });
  });

  it('refuses a fix older than the freshness window', () => {
    const evidence = fix({ capturedAt: new Date(NOW.getTime() - PICKUP_LOCATION_POLICY.maxAgeMs - 1) });
    expect(checkPickupLocation(SCSC, evidence, NOW)).toMatchObject({ reason: 'LOCATION_STALE' });
  });

  it('accepts a fix exactly at the freshness window', () => {
    const evidence = fix({ capturedAt: new Date(NOW.getTime() - PICKUP_LOCATION_POLICY.maxAgeMs) });
    expect(checkPickupLocation(SCSC, evidence, NOW)).toMatchObject({ passed: true });
  });

  it('★ refuses a fix stamped far in the FUTURE — a clock that moved between fix and send', () => {
    const evidence = fix({ capturedAt: new Date(NOW.getTime() + PICKUP_LOCATION_POLICY.maxAgeMs + 1) });
    expect(checkPickupLocation(SCSC, evidence, NOW)).toMatchObject({ reason: 'LOCATION_STALE' });
  });

  it('refuses an unparseable capture time as stale', () => {
    expect(checkPickupLocation(SCSC, fix({ capturedAt: new Date('nope') }), NOW)).toMatchObject({
      reason: 'LOCATION_STALE',
    });
  });

  it('★ measures freshness against the time it is GIVEN, so a wrong handset clock cancels out', () => {
    // The phone is five years behind on both stamps. Against its own send
    // time the fix is five seconds old, which is what matters.
    const wrongNow = new Date('2021-01-01T00:00:00.000Z');
    const evidence = fix({ capturedAt: new Date(wrongNow.getTime() - 5_000) });
    expect(checkPickupLocation(SCSC, evidence, wrongNow)).toMatchObject({ passed: true });
  });

  it('refuses a good reading that is outside the radius, and says how far', () => {
    const away = north(SCSC, PICKUP_LOCATION_POLICY.geofenceRadiusM + 50);
    const verdict = checkPickupLocation(SCSC, fix(away), NOW);

    expect(verdict).toMatchObject({ passed: false, reason: 'OUTSIDE_GEOFENCE' });
    expect(verdict.distanceM).toBeGreaterThan(PICKUP_LOCATION_POLICY.geofenceRadiusM);
  });

  it('★ accepts a reading exactly on the boundary', () => {
    const edge = north(SCSC, PICKUP_LOCATION_POLICY.geofenceRadiusM);
    // Floating point puts the derived point a hair either side; assert with a
    // policy whose radius is the measured distance, so "exactly on" is exact.
    const distanceM = distanceMeters(SCSC, edge);
    const policy = { ...PICKUP_LOCATION_POLICY, geofenceRadiusM: distanceM };

    expect(checkPickupLocation(SCSC, fix(edge), NOW, policy)).toEqual({ passed: true, distanceM });
  });

  it('refuses one metre past the boundary', () => {
    const edge = north(SCSC, PICKUP_LOCATION_POLICY.geofenceRadiusM);
    const distanceM = distanceMeters(SCSC, edge);
    const policy = { ...PICKUP_LOCATION_POLICY, geofenceRadiusM: distanceM - 1 };

    expect(checkPickupLocation(SCSC, fix(edge), NOW, policy)).toMatchObject({
      reason: 'OUTSIDE_GEOFENCE',
    });
  });

  it('checks accuracy and freshness BEFORE distance, so a bad reading is never called "outside"', () => {
    // A district-wide reading 2 km away is not evidence of being 2 km away.
    const away = north(SCSC, 2_000);
    const verdict = checkPickupLocation(SCSC, fix({ ...away, accuracyM: 900 }), NOW);
    expect(verdict).toMatchObject({ reason: 'ACCURACY_INSUFFICIENT', distanceM: null });
  });
});
