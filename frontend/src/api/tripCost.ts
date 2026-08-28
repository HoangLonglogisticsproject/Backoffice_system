import { httpClient } from './client';
import type {
  OutsourceHire,
  TripCost,
  TripCostCategory,
  TripCostList,
  TripCostTotals,
} from '@/types/tripCost';

/**
 * The money on a trip.
 *
 * ★ SEPARATE ENDPOINTS, SEPARATE PERMISSION, AND THAT IS THE WHOLE DESIGN. The
 * dispatch board is read by everybody (`trip.read` is unrestricted); the money
 * on it is not. That is only achievable because no amount ever rides on a trip
 * response — a caller without `cost.read` never RECEIVES the figures rather
 * than receiving them and being trusted to hide them.
 *
 * ⚠ DO NOT ADD A COST FIELD TO `tripSchedule.ts`, and do not fold these reads
 * into the board's list. Either would put amounts in front of every signed-in
 * account.
 *
 * ⚠ AND THERE IS NO UPDATE FUNCTION HERE, deliberately. A financial record is
 * immutable: a wrong figure is voided, with a reason, and replaced. The server
 * offers no PATCH, PUT or DELETE on these resources at all.
 */

const tripPath = (tripId: string) => `/trip-schedules/${encodeURIComponent(tripId)}`;

/**
 * `?includeVoided=true` — sent as the literal string the server accepts.
 *
 * Only `'true'` and `'false'` are valid, and the flag is omitted entirely when
 * false so the default path carries no parameter. Same spelling
 * `includeArchived` uses on the catalogue routes.
 */
const voidedParam = (includeVoided: boolean) =>
  includeVoided ? { includeVoided: 'true' } : {};

export interface CreateTripCostInput {
  category: TripCostCategory;
  /**
   * ★ A STRING, e.g. `"1500000.00"` or `"1500000"`.
   *
   * Never a JSON number: JSON numbers are float64, so `1500000.01` would arrive
   * as something a little else with nothing to show it had changed. The server
   * refuses a number outright, and it refuses a third decimal place too —
   * `NUMERIC(14,2)` would ROUND that rather than reject it.
   */
  amount: string;
  note?: string | null;
}

export interface CreateOutsourceHireInput {
  carrierName: string;
  agreedAmount: string;
  /** Whether the agreed figure already contains VAT. Recorded, never computed. */
  amountIncludesVat?: boolean;
  documentRef?: string | null;
  note?: string | null;
}

// ------------------------------------------------------------------- costs ----

export async function fetchTripCosts(
  tripId: string,
  includeVoided = false,
): Promise<TripCostList<TripCost>> {
  const { data } = await httpClient.get<TripCostList<TripCost>>(`${tripPath(tripId)}/costs`, {
    params: voidedParam(includeVoided),
  });
  return data;
}

export async function createTripCost(
  tripId: string,
  input: CreateTripCostInput,
): Promise<TripCost> {
  const { data } = await httpClient.post<TripCost>(`${tripPath(tripId)}/costs`, input);
  return data;
}

/**
 * Withdraws a cost line.
 *
 * POST and "void", not DELETE: the row survives with who withdrew it and why,
 * because a line counted in last month's total has to stay explicable. The
 * reason is required — the server refuses a blank one.
 */
export async function voidTripCost(
  tripId: string,
  costId: string,
  reason: string,
): Promise<TripCost> {
  const { data } = await httpClient.post<TripCost>(
    `${tripPath(tripId)}/costs/${encodeURIComponent(costId)}/void`,
    { reason },
  );
  return data;
}

// ---------------------------------------------------------- outsource hires ----

export async function fetchOutsourceHires(
  tripId: string,
  includeVoided = false,
): Promise<TripCostList<OutsourceHire>> {
  const { data } = await httpClient.get<TripCostList<OutsourceHire>>(
    `${tripPath(tripId)}/outsource-hires`,
    { params: voidedParam(includeVoided) },
  );
  return data;
}

export async function createOutsourceHire(
  tripId: string,
  input: CreateOutsourceHireInput,
): Promise<OutsourceHire> {
  const { data } = await httpClient.post<OutsourceHire>(
    `${tripPath(tripId)}/outsource-hires`,
    input,
  );
  return data;
}

export async function voidOutsourceHire(
  tripId: string,
  hireId: string,
  reason: string,
): Promise<OutsourceHire> {
  const { data } = await httpClient.post<OutsourceHire>(
    `${tripPath(tripId)}/outsource-hires/${encodeURIComponent(hireId)}/void`,
    { reason },
  );
  return data;
}

// ----------------------------------------------------------------- summary ----

/**
 * The three totals, from one snapshot on the server.
 *
 * ★ THE COMBINED FIGURE IS FETCHED, NOT COMPUTED. `costs` and `hires` are
 * decimal strings; adding them here would concatenate or go through a float.
 * PostgreSQL adds them in the same statement that produced the parts.
 */
export async function fetchTripCostSummary(tripId: string): Promise<TripCostTotals> {
  const { data } = await httpClient.get<TripCostTotals>(`${tripPath(tripId)}/cost-summary`);
  return data;
}
