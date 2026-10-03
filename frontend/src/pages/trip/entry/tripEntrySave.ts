import { assignDriver } from '@/api/tripAssignment';
import { createTripSchedule, updateTripSchedule, type UpdateTripInput } from '@/api/tripSchedule';
import type { TranslationKey } from '@/types/translate';
import { isApiError } from '@/utils/errors';
import type { TripSchedule, TripScheduleWithRefs } from '@/types/trip';
import type { CrewRow } from './useEntryCrew';

/**
 * What the form sends and how it reads the answer: the one create (with its
 * intent), the retry-safe patch, the crew one pair at a time, and the
 * server's refusals mapped back to the fields they concern.
 */

/**
 * The server's own sentence when it refused — it knows about retired
 * vehicles, archived customers and the date rules; this form does not — or
 * the generic one when the failure was not the server's.
 */
export const failureMessage = (error: unknown, fallback: string): string =>
  isApiError(error) ? error.message : fallback;

/** A refusal of a booking's date or hour, and the field it is drawn under. */
export type BookingRefusal = { field: 'scheduledOn' | 'pickupAt'; key: TranslationKey };

/**
 * ★ THE SERVER'S REFUSAL OF A BOOKING'S DATE OR HOUR, IN THE FORM'S OWN WORDS.
 * The form checks the same rule as it is typed, but a dialog left open past
 * the hour it names — or past midnight, so "tomorrow" became today — is caught
 * only by the server, on its own clock. That 422 is drawn under its field as
 * the sentence the field would have shown, not the server's.
 */
const BOOKING_REFUSALS: Record<string, TranslationKey> = {
  PAST_DAY: 'pickupOnPastDay',
  PAST_INSTANT: 'pickupInPast',
  TIME_REQUIRED: 'pickupTimeRequiredToday',
};

const bookingRefusal = (error: unknown): BookingRefusal | null => {
  if (!isApiError(error)) return null;
  for (const field of ['pickupAt', 'scheduledOn'] as const) {
    const key = BOOKING_REFUSALS[error.details?.[field] ?? ''];
    if (key) return { field, key };
  }
  return null;
};

/** A refusal met on save, kept with the date and hour it was about. */
export type SaveRefusal = BookingRefusal & { scheduledOn: string; pickupTime: string };

/** A failed save, split: a booking refusal goes under its field, anything else above the form. */
export const saveFailure = (
  error: unknown,
  form: { scheduledOn: string; pickupTime: string },
  fallback: string,
): { refusal: SaveRefusal | null; message: string | null } => {
  const refused = bookingRefusal(error);
  return refused
    ? { refusal: { ...refused, scheduledOn: form.scheduledOn, pickupTime: form.pickupTime }, message: null }
    : { refusal: null, message: failureMessage(error, fallback) };
};

/** An existing row is patched; a new one is booked — the create intent said out loud. */
const saveTrip = (trip: TripScheduleWithRefs | null, payload: UpdateTripInput): Promise<TripSchedule> =>
  trip ? updateTripSchedule(trip.id, payload) : createTripSchedule({ ...payload, entryMode: 'operational' });

/**
 * "Nhập chuyến cũ": the SAME create, with the intent `historical` — the server
 * records the trip finished. So no status travels (the server refuses one
 * beside this intent), and the crew rides in the same request: a finished trip
 * takes no dispatch afterwards, and there is no half-saved state to retry.
 */
export const recordHistorical = (payload: UpdateTripInput, crew: readonly CrewRow[]): Promise<TripSchedule> => {
  const { status: _setByTheServer, ...booking } = payload;
  return createTripSchedule({
    ...booking,
    entryMode: 'historical',
    crew: crew.map(({ vehicleId, driverUserId }) => ({ vehicleId, driverUserId })),
  });
};

/**
 * Sends each pair to the dispatch endpoint and returns the rows that did NOT
 * land, each carrying the server's own words.
 *
 * ★ ONE AT A TIME, NOT `Promise.all`. `TripExecutionService.assign` locks the
 * trip row, so parallel calls would queue on the server anyway — and
 * sequentially each refusal can be attributed to the row that caused it
 * instead of arriving as one rejected batch.
 *
 * ★ AND THE SERVER IS THE AUTHORITY ON THE RULES. The duplicate-lorry check in
 * the form is a courtesy that saves a round trip; `requireVehicleFree` and the
 * partial unique index from 0027 are what actually enforce it, including
 * against a second dispatcher working at the same moment.
 */
export const dispatchCrew = async (
  tripId: string,
  rows: CrewRow[],
  refusal: (error: unknown) => string,
): Promise<CrewRow[]> => {
  const failed: CrewRow[] = [];
  for (const row of rows) {
    try {
      await assignDriver(tripId, { vehicleId: row.vehicleId, driverUserId: row.driverUserId });
    } catch (error_) {
      failed.push({ ...row, error: refusal(error_) });
    }
  }
  return failed;
};

/**
 * Books the trip, or corrects the one this form booked moments ago.
 *
 * A retry after a partial crew failure PATCHes the remembered id rather than
 * recreating: PATCH is `trip.write`, the same permission the crew section
 * already required to be drawn, so this cannot 403 for anyone who could reach
 * a partial failure in the first place. Answers the id the crew is dispatched
 * against either way.
 */
export const persistTrip = async (
  trip: TripScheduleWithRefs | null,
  createdTripId: string | null,
  payload: UpdateTripInput,
): Promise<string> => {
  if (createdTripId !== null) {
    await updateTripSchedule(createdTripId, payload);
    return createdTripId;
  }
  return (await saveTrip(trip, payload)).id;
};
