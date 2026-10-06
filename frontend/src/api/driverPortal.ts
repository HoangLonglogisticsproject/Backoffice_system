import { httpClient } from './client';
import type {
  CompletionRequest,
  DailyFuelCheck,
  DailyFuelDeclarationInput,
  DriverFuelTransaction,
  DriverWorkday,
  FuelFillInput,
  DriverHistoryCursor,
  DriverHistoryPage,
  DriverTrip,
  DriverTripDetail,
  ExecutionEvent,
  ExecutionEventType,
  ExpenseDeclaration,
  LocationEvidence,
} from '@/types/driver';
import type { TripCost, TripCostCategory } from '@/types/tripCost';

/**
 * The Driver Portal's whole API surface, and nothing else.
 *
 * ★ EVERY ROUTE IS SCOPED BY AN ASSIGNMENT, NEVER BY A TRIP (ADR-0004). One
 * driver may hold several turns on one trip — one per lorry — so a trip id
 * cannot say which lorry's progress is being reported. The assignment id can,
 * and the server derives the trip from it; no route here takes a trip id.
 *
 * ★ THESE ROUTES ARE NOT THE BACKOFFICE'S. `/trip-schedules/...` serves the
 * dispatch board and returns the WHOLE trip row; `/driver/assignments/...`
 * returns a server-side whitelist with no money in it at all. Reading the
 * board from the portal would hand a driver every column the trip has, which
 * is exactly the boundary the separate endpoints exist to draw.
 *
 * ⚠ DO NOT ADD A COST OR HIRE READ HERE. A trip's total includes the price
 * agreed with a hired carrier — the one commercial figure a driver must never
 * see. The detail response already carries the driver's OWN declared lines on
 * THIS assignment, and carries no total by design.
 *
 * ★ WHAT IS DELIBERATELY ABSENT FROM EVERY BODY BELOW:
 *
 *   assignmentId  it is in the PATH. A body that named its own assignment
 *   tripId        would let a driver holding one turn act on another, and the
 *                 server's guard would have checked something irrelevant.
 *   recordedBy    the actor is the SESSION. A body that names its own author is
 *   declaredBy    a body that can name somebody else's.
 *   recordedAt    the server owns its own clock; no request may pre-date its
 *                 own arrival.
 */

const assignmentPath = (assignmentId: string) =>
  `/driver/assignments/${encodeURIComponent(assignmentId)}`;

/**
 * ★ A READ ON THE ROAD GIVES UP, SO THE SCREEN CAN SAY SO. The shared client
 * sets no timeout, and a phone that loses its signal mid-request would keep a
 * skeleton on screen until the browser's own limit — minutes. Each attempt
 * stops after this long and fails as "no connection"; with the query's two
 * retries (1 s and 2 s apart) a dead connection reaches the retry button in
 * about half a minute.
 * Reads only: a write that timed out may still have landed, and its answer is
 * the idempotency key, not a guess.
 */
const READ_TIMEOUT_MS = 10_000;

/** Every turn this driver holds — one per lorry, one card each on the schedule. */
export async function fetchMyAssignments(): Promise<DriverTrip[]> {
  const { data } = await httpClient.get<DriverTrip[]>('/driver/assignments', { timeout: READ_TIMEOUT_MS });
  return data;
}

/**
 * The trips this driver has already run to the end, newest first.
 *
 * ★ NO PARAMETER NAMES A DRIVER, HERE OR ANYWHERE IN THIS FILE. The scope is
 * the session; the cursor only says where to resume, so it can move this
 * driver's own window and nothing else.
 */
export async function fetchMyHistory(
  params: { limit?: number; before?: DriverHistoryCursor | null } = {},
): Promise<DriverHistoryPage> {
  const { data } = await httpClient.get<DriverHistoryPage>('/driver/history', {
    timeout: READ_TIMEOUT_MS,
    // Both halves of the cursor or neither — the server refuses half of one
    // rather than quietly serving the first page again.
    params: {
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.before ? { before: params.before.assignedAt, beforeId: params.before.id } : {}),
    },
  });
  return data;
}

export async function fetchMyAssignment(assignmentId: string): Promise<DriverTripDetail> {
  const { data } = await httpClient.get<DriverTripDetail>(assignmentPath(assignmentId), {
    timeout: READ_TIMEOUT_MS,
  });
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
   * ★ A READING, NEVER A VERDICT. Where the handset says it is, how sure it
   * is, and when it took the fix. The server measures the distance to the
   * trip's own pickup point and decides; there is no `geofencePassed` and no
   * `distance` in this body, and the server's schema strips one if sent.
   * Required by the server for PICKUP_CONFIRMED.
   */
  location?: LocationEvidence;
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
  assignmentId: string,
  input: RecordEventInput,
): Promise<ExecutionEvent> {
  const { data } = await httpClient.post<ExecutionEvent>(
    `${assignmentPath(assignmentId)}/execution-events`,
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
  assignmentId: string,
  input: DeclareExpenseInput,
): Promise<TripCost> {
  const { data } = await httpClient.post<TripCost>(`${assignmentPath(assignmentId)}/expenses`, input);
  return data;
}

/**
 * "Ca làm việc hôm nay": the caller's lorries today and their turns. No
 * parameter — the session is the scope, as for the assignment list.
 */
export async function fetchMyWorkday(): Promise<DriverWorkday> {
  const { data } = await httpClient.get<DriverWorkday>('/driver/workday', { timeout: READ_TIMEOUT_MS });
  return data;
}

/**
 * Records a fill after the day's check, on the turn's lorry. The day's check is
 * not touched: "Không đổ nhiên liệu đầu ca" then a fill at noon are both true.
 */
export async function recordFuelFill(assignmentId: string, input: FuelFillInput): Promise<DriverFuelTransaction> {
  const { data } = await httpClient.post<DriverFuelTransaction>(
    `${assignmentPath(assignmentId)}/fuel-transactions`,
    input,
  );
  return data;
}

/**
 * Answers the lorry's daily fuel check, the step the first milestone of the
 * day is held for (`FUEL_DECLARATION_REQUIRED`). The answer is the check that
 * stands — another driver's, if they answered first; either way the milestone
 * may now be retried.
 */
export async function declareDailyFuel(
  assignmentId: string,
  input: DailyFuelDeclarationInput,
): Promise<DailyFuelCheck> {
  const { data } = await httpClient.post<DailyFuelCheck>(`${assignmentPath(assignmentId)}/fuel-checks`, input);
  return data;
}

/**
 * Corrects a figure that has not been locked yet.
 *
 * ★ PATCH, AND ONLY FOR A DRIVER-DECLARED LINE ON THIS ASSIGNMENT. A mistyped
 * digit at a fuel station should not leave two rows and a void reason reading
 * "typo". A backoffice line keeps the older rule, and a line on the driver's
 * OTHER lorry is not reachable through this one.
 */
export async function editExpense(
  assignmentId: string,
  costId: string,
  input: { category?: TripCostCategory; amount?: string; note?: string | null },
): Promise<TripCost> {
  const { data } = await httpClient.patch<TripCost>(
    `${assignmentPath(assignmentId)}/expenses/${encodeURIComponent(costId)}`,
    input,
  );
  return data;
}

/**
 * Asks for THIS assignment's turn to be closed.
 *
 * ★ THE DECLARATION IS REQUIRED AND HAS NO DEFAULT. Zero expense rows is not an
 * answer — it is either a turn that cost nothing or a driver who forgot, and
 * only the driver can say which. The server refuses a declaration that
 * contradicts the lines on the assignment.
 *
 * Resubmitting after a rejection is this same call: the server writes a NEW
 * request with the next attempt number, carrying a NEW declaration.
 */
export async function submitCompletion(
  assignmentId: string,
  expenseDeclaration: ExpenseDeclaration,
): Promise<CompletionRequest> {
  const { data } = await httpClient.post<CompletionRequest>(
    `${assignmentPath(assignmentId)}/completion-requests`,
    { expenseDeclaration },
  );
  return data;
}
