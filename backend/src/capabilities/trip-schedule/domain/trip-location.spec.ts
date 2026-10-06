import {
  GEOFENCED_MILESTONES,
  LOCATION_REFUSALS,
  LOCATION_REJECTIONS,
  MILESTONE_LOCATION_POLICY,
  geofencedPointOf,
  checkMilestoneLocation,
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

describe('checkMilestoneLocation', () => {
  it('passes a fresh, precise reading at the destination', () => {
    expect(checkMilestoneLocation(SCSC, fix(), NOW)).toEqual({ passed: true, distanceM: 0 });
  });

  it('refuses before anything else when the destination has no coordinates', () => {
    // Even a perfect reading cannot be measured against nowhere — and the
    // driver is told it is not their reading that is wrong.
    expect(checkMilestoneLocation(null, fix(), NOW)).toMatchObject({ reason: 'DESTINATION_MISSING' });
  });

  it('refuses when no reading was sent', () => {
    expect(checkMilestoneLocation(SCSC, null, NOW)).toMatchObject({ reason: 'LOCATION_REQUIRED' });
  });

  it.each([
    ['latitude NaN', fix({ latitude: Number.NaN })],
    ['longitude NaN', fix({ longitude: Number.NaN })],
    ['latitude out of range', fix({ latitude: 91 })],
    ['longitude out of range', fix({ longitude: -181 })],
    ['negative accuracy', fix({ accuracyM: -1 })],
    ['accuracy NaN', fix({ accuracyM: Number.NaN })],
  ])('refuses %s as invalid', (_label, evidence) => {
    expect(checkMilestoneLocation(SCSC, evidence, NOW)).toMatchObject({ reason: 'INVALID_COORDINATES' });
  });

  it('refuses a reading looser than the accuracy ceiling', () => {
    const evidence = fix({ accuracyM: MILESTONE_LOCATION_POLICY.maxAccuracyM + 0.1 });
    expect(checkMilestoneLocation(SCSC, evidence, NOW)).toMatchObject({ reason: 'ACCURACY_INSUFFICIENT' });
  });

  it('accepts a reading exactly at the accuracy ceiling', () => {
    const evidence = fix({ accuracyM: MILESTONE_LOCATION_POLICY.maxAccuracyM });
    expect(checkMilestoneLocation(SCSC, evidence, NOW)).toMatchObject({ passed: true });
  });

  it('refuses a fix older than the freshness window', () => {
    const evidence = fix({ capturedAt: new Date(NOW.getTime() - MILESTONE_LOCATION_POLICY.maxAgeMs - 1) });
    expect(checkMilestoneLocation(SCSC, evidence, NOW)).toMatchObject({ reason: 'LOCATION_STALE' });
  });

  it('accepts a fix exactly at the freshness window', () => {
    const evidence = fix({ capturedAt: new Date(NOW.getTime() - MILESTONE_LOCATION_POLICY.maxAgeMs) });
    expect(checkMilestoneLocation(SCSC, evidence, NOW)).toMatchObject({ passed: true });
  });

  it('★ refuses a fix stamped far in the FUTURE — a clock that moved between fix and send', () => {
    const evidence = fix({ capturedAt: new Date(NOW.getTime() + MILESTONE_LOCATION_POLICY.maxAgeMs + 1) });
    expect(checkMilestoneLocation(SCSC, evidence, NOW)).toMatchObject({ reason: 'LOCATION_STALE' });
  });

  it('refuses an unparseable capture time as stale', () => {
    expect(checkMilestoneLocation(SCSC, fix({ capturedAt: new Date('nope') }), NOW)).toMatchObject({
      reason: 'LOCATION_STALE',
    });
  });

  it('★ measures freshness against the time it is GIVEN, so a wrong handset clock cancels out', () => {
    // The phone is five years behind on both stamps. Against its own send
    // time the fix is five seconds old, which is what matters.
    const wrongNow = new Date('2021-01-01T00:00:00.000Z');
    const evidence = fix({ capturedAt: new Date(wrongNow.getTime() - 5_000) });
    expect(checkMilestoneLocation(SCSC, evidence, wrongNow)).toMatchObject({ passed: true });
  });

  it('refuses a good reading that is outside the radius, and says how far', () => {
    const away = north(SCSC, MILESTONE_LOCATION_POLICY.geofenceRadiusM + 50);
    const verdict = checkMilestoneLocation(SCSC, fix(away), NOW);

    expect(verdict).toMatchObject({ passed: false, reason: 'OUTSIDE_GEOFENCE' });
    expect(verdict.distanceM).toBeGreaterThan(MILESTONE_LOCATION_POLICY.geofenceRadiusM);
  });

  it('★ accepts a reading exactly on the boundary', () => {
    const edge = north(SCSC, MILESTONE_LOCATION_POLICY.geofenceRadiusM);
    // Floating point puts the derived point a hair either side; assert with a
    // policy whose radius is the measured distance, so "exactly on" is exact.
    const distanceM = distanceMeters(SCSC, edge);
    const policy = { ...MILESTONE_LOCATION_POLICY, geofenceRadiusM: distanceM };

    expect(checkMilestoneLocation(SCSC, fix(edge), NOW, policy)).toEqual({ passed: true, distanceM });
  });

  it('refuses one metre past the boundary', () => {
    const edge = north(SCSC, MILESTONE_LOCATION_POLICY.geofenceRadiusM);
    const distanceM = distanceMeters(SCSC, edge);
    const policy = { ...MILESTONE_LOCATION_POLICY, geofenceRadiusM: distanceM - 1 };

    expect(checkMilestoneLocation(SCSC, fix(edge), NOW, policy)).toMatchObject({
      reason: 'OUTSIDE_GEOFENCE',
    });
  });

  it('checks accuracy and freshness BEFORE distance, so a bad reading is never called "outside"', () => {
    // A district-wide reading 2 km away is not evidence of being 2 km away.
    const away = north(SCSC, 2_000);
    const verdict = checkMilestoneLocation(SCSC, fix({ ...away, accuracyM: 900 }), NOW);
    expect(verdict).toMatchObject({ reason: 'ACCURACY_INSUFFICIENT', distanceM: null });
  });
});

/**
 * ★ THE WIRING, KEPT ALIVE BY ITS OWN TESTS.
 *
 * `recordEvent` used to hold this inline. DL-118 turned the check off, which
 * made that code provably unreachable — so it moved here, where the rule it
 * wires already lives and where a test can still exercise it. These cases are
 * what stop it rotting into something that no longer works the day it is
 * switched back on.
 */
describe('which point a milestone is measured against', () => {
  const TRIP = {
    pickupLatitude: 10.8188,
    pickupLongitude: 106.6564,
    deliveryLatitude: 10.7769,
    deliveryLongitude: 106.7009,
  };

  /** What the list would hold with the check switched back on. */
  const BOTH_CONFIRMATIONS = ['PICKUP_CONFIRMED', 'DELIVERY_CONFIRMED'] as const;

  it('★ asks about nothing while the list is empty — the shipped state (DL-118)', () => {
    expect(GEOFENCED_MILESTONES).toEqual([]);

    for (const type of ['ARRIVED_PICKUP', 'PICKUP_CONFIRMED', 'ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED']) {
      expect(geofencedPointOf(TRIP, type)).toBeUndefined();
    }
  });

  it('★ measures each END against its OWN point — the two are different places', () => {
    // Confirming a delivery against the PICKUP's point was a real bug once.
    expect(geofencedPointOf(TRIP, 'PICKUP_CONFIRMED', BOTH_CONFIRMATIONS)).toEqual({
      latitude: 10.8188,
      longitude: 106.6564,
    });
    expect(geofencedPointOf(TRIP, 'DELIVERY_CONFIRMED', BOTH_CONFIRMATIONS)).toEqual({
      latitude: 10.7769,
      longitude: 106.7009,
    });
  });

  it('★ never measures an ARRIVAL, whatever the list says', () => {
    // Arriving is what the driver says on the way in; the check belongs to the
    // confirmation that follows. Listing an arrival cannot turn that on.
    const everything = ['ARRIVED_PICKUP', 'PICKUP_CONFIRMED', 'ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED'];

    expect(geofencedPointOf(TRIP, 'ARRIVED_PICKUP', everything)).toBeUndefined();
    expect(geofencedPointOf(TRIP, 'ARRIVED_DELIVERY', everything)).toBeUndefined();
  });

  it('★ answers `null`, not `undefined`, for a point Operations has not entered', () => {
    // The difference carries the whole meaning: `undefined` is "not checked
    // here", `null` is "checked, and the office owes a coordinate" — which is
    // refused as DESTINATION_MISSING rather than passed over in silence.
    const unlocated = { ...TRIP, pickupLatitude: null, pickupLongitude: null };

    expect(geofencedPointOf(unlocated, 'PICKUP_CONFIRMED', BOTH_CONFIRMATIONS)).toBeNull();
    expect(geofencedPointOf(unlocated, 'DELIVERY_CONFIRMED', BOTH_CONFIRMATIONS)).not.toBeNull();
  });

  it('treats half a point as no point at all', () => {
    const half = { ...TRIP, pickupLongitude: null };
    expect(geofencedPointOf(half, 'PICKUP_CONFIRMED', BOTH_CONFIRMATIONS)).toBeNull();
  });
});

describe('what a refusal says', () => {
  it('★ has a sentence for every rejection the rule can produce — none can be silent', () => {
    // A code with no sentence reaches a driver as an empty message, and the one
    // thing a refusal must do is say what to try next.
    expect(Object.keys(LOCATION_REFUSALS).sort()).toEqual([...LOCATION_REJECTIONS].sort());
    for (const sentence of Object.values(LOCATION_REFUSALS)) {
      expect(sentence.trim().length).toBeGreaterThan(0);
    }
  });

  it('★ never quotes the radius, the distance or the accuracy ceiling', () => {
    // Telling somebody they are 412 m outside a 300 m fence is telling them how
    // far to move to defeat it. The sentence says where to go, not by how much.
    for (const sentence of Object.values(LOCATION_REFUSALS)) {
      expect(sentence).not.toMatch(/\d/);
    }
  });
});
