import { businessToday } from '../../../common/pagination/date-range-page-query.dto';
import type { OffsetPage } from '../../../common/pagination/offset-page';
import type { UserSummary } from '../../../common/types/user-summary';
import type { TripCostSource, DriverExpenseScope } from './trip-execution';
import type { TripVehicle } from './trip-schedule';

/**
 * A lorry's own money, and the fuel check it owes each business day (0034).
 *
 * ★ OWNED BY THE LORRY. A trip or an assignment appears here only as where a
 * declaration was made (`sourceTripId`, `sourceAssignmentId`) — never as whose
 * money it is. None of it reaches a trip's totals: those sum `trip_costs`, and
 * a morning fill charged to the first run of the day would be counted against
 * one trip for fuel every run used.
 *
 * Amounts are strings for the reason `trip-cost.ts` gives: `NUMERIC` in, text
 * out, sums by PostgreSQL. Liters too.
 */

/** Only fuel today. Maintenance and repairs are later headings, added on purpose. */
export const VEHICLE_COST_CATEGORIES = ['fuel'] as const;
export type VehicleCostCategory = (typeof VEHICLE_COST_CATEGORIES)[number];

/** Answered once per lorry per business day. `no_fuel` writes no 0-đồng cost. */
export const DAILY_FUEL_OUTCOMES = ['fuel_added', 'no_fuel'] as const;
export type DailyFuelOutcome = (typeof DAILY_FUEL_OUTCOMES)[number];

/**
 * ★ THE ONE CLOCK THE OBLIGATION RUNS ON: the business day (Asia/Ho_Chi_Minh)
 * of the SERVER's now at the request. The declaration and the gate both ask
 * this, so they cannot disagree about which day a lorry owes — and no event
 * timestamp, pinned or reported, decides it.
 */
export const dailyFuelDate = (serverNow: Date): string => businessToday(serverNow);

/** The `details` code on the 422 that holds a turn's first milestone. */
export const FUEL_DECLARATION_REQUIRED = 'FUEL_DECLARATION_REQUIRED';

/** The `details` code on the 422 that refuses `fuel` as a trip expense. */
export const FUEL_DECLARED_ON_VEHICLE = 'FUEL_DECLARED_ON_VEHICLE';

/** Liters as `NUMERIC(10,2)` holds them exactly, and more than zero. */
const RECORDABLE_LITERS = /^\d{1,8}(\.\d{1,2})?$/;
export const isRecordableLiters = (value: string): boolean =>
  RECORDABLE_LITERS.test(value) && /[1-9]/.test(value);

export interface VehicleCost {
  id: string;
  vehicleId: string;
  /** The Asia/Ho_Chi_Minh day, as text — never a `Date` (see `DriverTrip.scheduledOn`). */
  businessDate: string;
  category: VehicleCostCategory;
  amount: string;
  liters: string | null;
  odometerKm: number | null;
  note: string | null;
  source: TripCostSource;
  sourceTripId: string | null;
  /**
   * The trip the cost arose on, when it arose on one — its day and customer,
   * so a reader can place it. ★ OPTIONAL PROVENANCE, NEVER OWNERSHIP: the cost
   * is the lorry's and is in no trip's total. `null` whenever `sourceTripId` is.
   */
  sourceTrip: { id: string; scheduledOn: string; customerName: string | null } | null;
  sourceAssignmentId: string | null;
  createdBy: string;
  createdByUser: UserSummary;
  createdAt: Date;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/** One lorry's answer for one day. A recorded fact: never changed, never removed. */
export interface DailyFuelCheck {
  vehicleId: string;
  businessDate: string;
  outcome: DailyFuelOutcome;
  /** The fill it recorded — set exactly when `outcome` is `fuel_added`. */
  vehicleCostId: string | null;
  sourceTripId: string;
  sourceAssignmentId: string;
  /** The key the declaration came with — how a retry is told from a collision. Never sent to a driver. */
  clientRequestId: string;
  createdBy: string;
  createdAt: Date;
}

/**
 * What a driver is told back: the day and the answer that stands. ★ Never whose
 * turn gave it — the check may be another driver's, on another trip of the
 * same lorry, and those ids are not this driver's to learn.
 */
export type DriverDailyFuelCheck = Pick<DailyFuelCheck, 'businessDate' | 'outcome'>;

export const forDriver = (check: DailyFuelCheck): DriverDailyFuelCheck => ({
  businessDate: check.businessDate,
  outcome: check.outcome,
});

/** What a driver declares. The lorry and the day are the server's, never the body's. */
export type DailyFuelDeclaration =
  | { outcome: 'fuel_added'; amount: string; liters: string | null; odometerKm: number | null; note: string | null }
  | { outcome: 'no_fuel' };

/**
 * ★ THE POLICY, SAID ONCE. Is this lorry's fuel declared daily on the lorry?
 * The flag, and nothing else: not `ownership` (unclassified everywhere, 0013),
 * never the note. A hired lorry cannot carry it — 0034's CHECK.
 */
export const needsDailyFuelCheck = (
  vehicle: Pick<TripVehicle, 'dailyFuelCheckRequired'> | null,
): boolean => vehicle?.dailyFuelCheckRequired === true;

/**
 * ★ MAY A DRIVER PUT `fuel` ON THIS TURN AS A TRIP EXPENSE? Not on live work
 * with a lorry whose fuel is declared on the lorry — the same fill would be
 * counted twice. A run recorded after the fact ("Nhập chuyến cũ") keeps its
 * fuel line: it has no daily check to answer, and phase 1 leaves it as it was.
 */
export const fuelDeclaredOnVehicle = (
  scope: DriverExpenseScope | null,
  vehicle: Pick<TripVehicle, 'dailyFuelCheckRequired'> | null,
): boolean => scope === 'operational' && needsDailyFuelCheck(vehicle);

/**
 * A page of a lorry's costs. `total` counts rows (the shared envelope);
 * `totalAmount` is `SUM(amount)` over the whole filter, live rows only.
 */
export type VehicleCostPage = OffsetPage<VehicleCost> & { totalAmount: string };
