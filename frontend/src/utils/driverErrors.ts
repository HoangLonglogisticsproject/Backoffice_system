import type { TranslationKey } from '@/types/translate';
import { isLocationError, type LocationFailure } from './driverLocation';
import { isApiError } from './errors';

/**
 * Turns whatever went wrong into something a driver can act on.
 *
 * ★ A DRIVER STANDING BESIDE A LORRY CANNOT USE "CONFLICT" OR "409".
 *
 * The API's own messages are written for the office and sometimes for a
 * developer. Showing them raw on a phone in the rain produces a person who
 * stops using the app and rings the dispatcher instead — which is the workflow
 * this whole project exists to replace. So every failure is mapped to one
 * sentence that says what happened and what to do next.
 *
 * ★ AND IT RETURNS A KEY, NOT A STRING. The interface speaks two languages, and
 * a message assembled here in Vietnamese would be the one place that ignores
 * the user's choice.
 *
 * ⚠ NOTHING HERE IS SECURITY. The server has already refused; this only decides
 * the wording. In particular a 403 says "this trip is not yours" and nothing
 * else — never whether the trip exists, never whose it is.
 */

/** The distinct 409s the portal can produce, told apart by the server's code. */
const CONFLICT_MESSAGES: Record<string, TranslationKey> = {
  // The server's messages are stable enough to match on their subject, but the
  // code is what is switched on — matching message TEXT is how a copy edit in
  // the backend silently breaks a screen.
  CONFLICT: 'driverErrConflict',
};

/**
 * The phone could not say where it is. Each is a different thing to do next.
 */
const LOCATION_FAILURE_KEYS: Record<LocationFailure, TranslationKey> = {
  unsupported: 'driverErrLocationUnsupported',
  denied: 'driverErrLocationDenied',
  unavailable: 'driverErrLocationUnavailable',
  timeout: 'driverErrLocationTimeout',
};

/**
 * The server looked at the reading and refused. The CODE rides in
 * `details.location` on a 422; the server's sentence is for the office and is
 * never shown here. Nothing about the radius, the distance measured, or the
 * accuracy ceiling reaches this screen — a driver needs to know what to do,
 * not what the rule is.
 */
const LOCATION_REJECTION_KEYS: Record<string, TranslationKey> = {
  DESTINATION_MISSING: 'driverErrDestinationMissing',
  LOCATION_REQUIRED: 'driverErrLocationRequired',
  INVALID_COORDINATES: 'driverErrLocationInvalid',
  ACCURACY_INSUFFICIENT: 'driverErrLocationAccuracy',
  LOCATION_STALE: 'driverErrLocationStale',
  OUTSIDE_GEOFENCE: 'driverErrOutsideGeofence',
};

export function driverErrorKey(error: unknown): TranslationKey {
  // Never reached the server: the handset itself could not produce a reading.
  if (isLocationError(error)) return LOCATION_FAILURE_KEYS[error.kind];

  if (!isApiError(error)) return 'driverErrUnknown';

  // Status 0 is `client.ts` saying the request never reached the server at all:
  // no signal in a yard, a dropped connection on a bridge.
  if (error.status === 0) return 'driverErrNetwork';

  if (error.status === 401) return 'driverErrSession';

  // ★ ONE MESSAGE FOR EVERY REFUSAL. A trip that is not theirs, a trip with no
  // driver and a trip that does not exist all answer 403 from the server, and
  // the portal keeps them indistinguishable — telling them apart would leak
  // whether somebody else's work exists.
  if (error.status === 403) {
    return error.is('PASSWORD_CHANGE_REQUIRED') ? 'driverErrPasswordChange' : 'driverErrForbidden';
  }

  if (error.status === 404) return 'driverErrNotFound';

  if (error.status === 422) {
    const rejection = error.details?.['location'];
    return (rejection && LOCATION_REJECTION_KEYS[rejection]) || 'driverErrValidation';
  }

  if (error.status === 429) return 'driverErrTooMany';

  if (error.status === 409) {
    return CONFLICT_MESSAGES[error.code ?? ''] ?? 'driverErrConflict';
  }

  // 500s and anything unmapped. Deliberately vague: a driver can do nothing
  // about a server fault except try again or ring the office.
  return 'driverErrUnknown';
}

/**
 * The same failures, worded for the office rather than for a lorry cab.
 *
 * ★ A REVIEWER CAN ACT ON MORE DETAIL THAN A DRIVER CAN. "This request was just
 * decided elsewhere" is useful to somebody sitting at a desk with two tabs open
 * and meaningless to somebody standing in the rain — so the two audiences get
 * two vocabularies over the same statuses, rather than one compromise that
 * serves neither.
 */
export function reviewErrorKey(error: unknown): TranslationKey {
  if (!isApiError(error)) return 'reviewErrUnknown';
  if (error.status === 0) return 'reviewErrNetwork';
  if (error.status === 401) return 'driverErrSession';
  if (error.status === 403) {
    return error.is('PASSWORD_CHANGE_REQUIRED') ? 'driverErrPasswordChange' : 'reviewErrForbidden';
  }
  if (error.status === 404) return 'driverErrNotFound';
  if (error.status === 422) return 'reviewErrValidation';
  // ★ The two-reviewer race, and the only one that matters here: somebody else
  // decided this request first.
  if (error.status === 409) return 'reviewErrConflict';
  return 'reviewErrUnknown';
}

/**
 * Whether the screen should re-read the trip after this failure.
 *
 * ★ A 409 MEANS THE WORLD MOVED, and the screen is showing a state that no
 * longer exists — the completion was submitted from another device, the office
 * changed the driver, an approval landed while a form was open. Refetching turns
 * a dead-end error into a screen that explains itself.
 */
export const shouldReloadAfter = (error: unknown): boolean =>
  isApiError(error) && (error.status === 409 || error.status === 404);
