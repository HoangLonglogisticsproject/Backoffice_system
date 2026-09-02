import { httpClient } from './client';
import type {
  CompletionRequest,
  DriverTrip,
  DriverTripDetail,
  ExecutionEvent,
  ExecutionEventType,
  ExpenseDeclaration,
} from '@/types/driver';
import type { TripCost, TripCostCategory } from '@/types/tripCost';

/**
 * The Driver Portal's whole API surface, and nothing else.
 *
 * ★ THESE ROUTES ARE NOT THE BACKOFFICE'S. `/trip-schedules/...` serves the
 * dispatch board and returns the WHOLE trip row; `/driver/trips/...` returns a
 * server-side whitelist with no money in it at all. Reading the board from the
 * portal would hand a driver every column the trip has, which is exactly the
 * boundary the separate endpoints exist to draw.
 *
 * ⚠ DO NOT ADD A COST OR HIRE READ HERE. A trip's total includes the price
 * agreed with a hired carrier — the one commercial figure a driver must never
 * see. The detail response already carries the driver's OWN declared lines, and
 * carries no total by design.
 *
 * ★ WHAT IS DELIBERATELY ABSENT FROM EVERY BODY BELOW:
 *
 *   tripId        it is in the PATH. A body that named its own trip would let a
 *                 driver assigned to one act on another, and the server's guard
 *                 would have checked something irrelevant.
 *   recordedBy    the actor is the SESSION. A body that names its own author is
 *   declaredBy    a body that can name somebody else's.
 *   recordedAt    the server owns its own clock; no request may pre-date its
 *                 own arrival.
 */

const tripPath = (tripId: string) => `/driver/trips/${encodeURIComponent(tripId)}`;

export async function fetchMyTrips(): Promise<DriverTrip[]> {
  const { data } = await httpClient.get<DriverTrip[]>('/driver/trips');
  return data;
}

export async function fetchMyTrip(tripId: string): Promise<DriverTripDetail> {
  const { data } = await httpClient.get<DriverTripDetail>(tripPath(tripId));
  return data;
}

export interface RecordEventInput {
  type: ExecutionEventType;
  /**
   * ★ THERE IS NO `actualAt` HERE, AND THAT IS DELIBERATE.
   *
   * `actual_at` is what every delay in the system is measured from. A phone's
   * clock is set by the phone's owner, so a handset an hour out would write an
   * hour of lateness nobody caused — or erase an hour somebody did. The server
   * stamps it when the tap arrives, exactly as it stamps `recorded_at`. The
   * route's schema has no field for either.
   *
   * What the handset's own clock said, purely so a disagreement can be
   * investigated later. ★ DIAGNOSTIC ONLY — nothing computes a delay, an order
   * or a KPI from it.
   */
  deviceReportedAt?: string;
  /**
   * ★ IDEMPOTENCY, AND IT IS NOT OPTIONAL.
   *
   * A phone on a bad connection sends the same tap three times. Without this the
   * arrival is recorded three times and every duration computed from it is
   * wrong. The server answers the retries with the ORIGINAL event rather than
   * refusing them, so a caller must generate one id per INTENT — not per attempt.
   */
  clientEventId: string;
}

export async function recordExecutionEvent(
  tripId: string,
  input: RecordEventInput,
): Promise<ExecutionEvent> {
  const { data } = await httpClient.post<ExecutionEvent>(
    `${tripPath(tripId)}/execution-events`,
    input,
  );
  return data;
}

export interface DeclareExpenseInput {
  category: TripCostCategory;
  /**
   * ★ A STRING, e.g. `"1500000.00"`.
   *
   * Never a JSON number: JSON numbers are float64, so `1500000.01` would arrive
   * as something a little else with nothing to show it had changed. The server
   * refuses a number outright, and refuses a third decimal place too.
   */
  amount: string;
  note?: string | null;
  /** Same idempotency argument as an event. One id per intent. */
  clientRequestId?: string | null;
}

export async function declareExpense(
  tripId: string,
  input: DeclareExpenseInput,
): Promise<TripCost> {
  const { data } = await httpClient.post<TripCost>(`${tripPath(tripId)}/expenses`, input);
  return data;
}

/**
 * Corrects a figure that has not been locked yet.
 *
 * ★ PATCH, AND ONLY FOR A DRIVER-DECLARED LINE. A mistyped digit at a fuel
 * station should not leave two rows and a void reason reading "typo". A
 * backoffice line keeps the older rule and the server refuses this on one.
 */
export async function editExpense(
  tripId: string,
  costId: string,
  input: { category?: TripCostCategory; amount?: string; note?: string | null },
): Promise<TripCost> {
  const { data } = await httpClient.patch<TripCost>(
    `${tripPath(tripId)}/expenses/${encodeURIComponent(costId)}`,
    input,
  );
  return data;
}

/**
 * Asks for the trip to be closed.
 *
 * ★ THE DECLARATION IS REQUIRED AND HAS NO DEFAULT. Zero expense rows is not an
 * answer — it is either a trip that cost nothing or a driver who forgot, and
 * only the driver can say which. The server refuses a declaration that
 * contradicts the lines on the trip.
 *
 * Resubmitting after a rejection is this same call: the server writes a NEW
 * request with the next attempt number, carrying a NEW declaration.
 */
export async function submitCompletion(
  tripId: string,
  expenseDeclaration: ExpenseDeclaration,
): Promise<CompletionRequest> {
  const { data } = await httpClient.post<CompletionRequest>(
    `${tripPath(tripId)}/completion-requests`,
    { expenseDeclaration },
  );
  return data;
}
