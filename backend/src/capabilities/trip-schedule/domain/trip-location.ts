/**
 * Where things are, and whether a reported position is close enough.
 *
 * ★ PURE, AND THE ONLY PLACE THE RULE LIVES. Radius, accuracy floor, freshness
 * window and the distance formula are all here, so "is this driver at the
 * pickup" has exactly one answer in the codebase — the service asks, the
 * controller never does, and the browser is never believed about it.
 *
 * ★ LOCATION ASSURANCE, NOT ANTI-FRAUD. Contract §11: a browser's GPS is a
 * verification SIGNAL. What this module establishes is that an authenticated,
 * assigned driver's handset reported a fresh, reasonably precise position
 * within the radius, and that the SERVER measured it. It does not, and cannot,
 * establish that the handset was not lying.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** A finite number inside the range the axis has. `NaN` fails both bounds. */
export const isLatitude = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;

export const isLongitude = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;

export const isCoordinates = (value: Coordinates | null | undefined): value is Coordinates =>
  value != null && isLatitude(value.latitude) && isLongitude(value.longitude);

/** Mean Earth radius, metres. The figure the haversine formula is quoted for. */
const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres, by the haversine formula.
 *
 * Good to well under a metre over the distances a geofence measures, stable at
 * the poles, and correct across the ±180° meridian because it only ever sees
 * the SINE of half the longitude difference — 359.9° and 0.1° apart give the
 * same value. No projection, no library: a geofence needs one distance, and
 * this is the standard way to get it.
 */
export const distanceMeters = (a: Coordinates, b: Coordinates): number => {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * What a handset says about where it is. All four move together — see the
 * CHECK in 0019.
 */
export interface LocationEvidence extends Coordinates {
  /** The handset's own error estimate, metres. */
  accuracyM: number;
  /** The HANDSET's clock at the fix. Diagnostic; never what `actual_at` is. */
  capturedAt: Date;
}

export interface LocationPolicy {
  /** How far from the destination still counts as "there". Inclusive. */
  geofenceRadiusM: number;
  /** A reading looser than this is a reading of a district, not a gate. Inclusive. */
  maxAccuracyM: number;
  /** A fix older than this must be retaken. Inclusive. */
  maxAgeMs: number;
}

/**
 * ★ THE ONE SOURCE OF TRUTH FOR THE THREE NUMBERS, AND THEY ARE DEFAULTS.
 *
 * The business has not fixed any of them. These are working values chosen so
 * the check is real without being hostile: a lorry parked at the far side of a
 * warehouse yard passes; a phone that can only say "somewhere in the district"
 * does not; a position captured before the driver left the previous stop does
 * not.
 *
 *   300 m   a large yard is a few hundred metres across; 300 m holds a lorry
 *           anywhere inside one while excluding the next street.
 *   100 m   outdoor phone GPS is 5–30 m; 100 m is the point past which the
 *           handset is guessing from cell towers.
 *   2 min   the portal captures a fresh fix on the tap, so anything older is a
 *           replay or a very slow network — either way, retake it.
 *
 * ponytail: one constant, not an env variable and not a setting table. Promote
 * it to configuration the day a second deployment or a per-customer radius is
 * asked for, and not before.
 */
export const MILESTONE_LOCATION_POLICY: LocationPolicy = {
  geofenceRadiusM: 300,
  maxAccuracyM: 100,
  maxAgeMs: 2 * 60 * 1000,
};

/**
 * Why a position was not accepted. Each one is a different thing for the
 * driver to DO, which is why they are told apart at all.
 */
export const LOCATION_REJECTIONS = [
  /** Operations has not entered coordinates for the pickup. Not the driver's to fix. */
  'DESTINATION_MISSING',
  /** The milestone needs a reading and none was sent. */
  'LOCATION_REQUIRED',
  /** Not a place on Earth. */
  'INVALID_COORDINATES',
  /** The handset is not sure enough where it is. */
  'ACCURACY_INSUFFICIENT',
  /** The fix is too old to describe where the handset is now. */
  'LOCATION_STALE',
  /** A good reading, and it is somewhere else. */
  'OUTSIDE_GEOFENCE',
] as const;

export type LocationRejection = (typeof LOCATION_REJECTIONS)[number];

export type LocationVerdict =
  | { passed: true; distanceM: number }
  | { passed: false; reason: LocationRejection; distanceM: number | null };

/**
 * The geofence, decided — for whichever milestone is being confirmed. The
 * pickup is measured against the pickup point and the delivery against the
 * delivery point; the rule, the radius and the thresholds are the same one.
 *
 * `reportedAt` is what the fix's age is measured from. The caller passes the
 * HANDSET's send time when it has one — the same clock that stamped
 * `capturedAt`, so a phone that is an hour wrong is an hour wrong on both
 * sides and the age comes out right. Absent that, the server's clock stands in.
 *
 * Every bound is INCLUSIVE: a reading exactly on the radius is inside, an
 * accuracy exactly at the ceiling is acceptable, a fix exactly at the window is
 * fresh. Boundaries are where two callers with the same numbers disagree, so
 * the rule says which way they fall.
 */
export const checkMilestoneLocation = (
  destination: Coordinates | null,
  evidence: LocationEvidence | null,
  reportedAt: Date,
  policy: LocationPolicy = MILESTONE_LOCATION_POLICY,
): LocationVerdict => {
  if (!isCoordinates(destination)) return { passed: false, reason: 'DESTINATION_MISSING', distanceM: null };
  if (!evidence) return { passed: false, reason: 'LOCATION_REQUIRED', distanceM: null };

  if (!isCoordinates(evidence) || !Number.isFinite(evidence.accuracyM) || evidence.accuracyM < 0) {
    return { passed: false, reason: 'INVALID_COORDINATES', distanceM: null };
  }

  if (evidence.accuracyM > policy.maxAccuracyM) {
    return { passed: false, reason: 'ACCURACY_INSUFFICIENT', distanceM: null };
  }

  // Absolute, so a fix stamped in the FUTURE relative to the send time — a
  // clock that moved between the two — is treated as unusable too.
  const ageMs = Math.abs(reportedAt.getTime() - evidence.capturedAt.getTime());
  if (!Number.isFinite(ageMs) || ageMs > policy.maxAgeMs) {
    return { passed: false, reason: 'LOCATION_STALE', distanceM: null };
  }

  const distanceM = distanceMeters(destination, evidence);
  if (distanceM > policy.geofenceRadiusM) {
    return { passed: false, reason: 'OUTSIDE_GEOFENCE', distanceM };
  }

  return { passed: true, distanceM };
};
