import type { UserSummary } from '../../../common/types/user-summary';
import {
  EXECUTION_EVENT_TYPES,
  missingMilestones,
  type ExecutionEventType,
  type VehicleOwnership,
} from './trip-execution';
import type { DailyFuelOutcome } from './vehicle-fuel';

/**
 * "Điều hành xe" — each lorry's working day, and the driver's own (Ca làm việc
 * hôm nay).
 *
 * ★ DERIVED, NEVER STORED. Every state below is read off the turns, their live
 * milestones, the day's fuel check and the lorry's cost ledger at the moment
 * of the read. Nothing here has a column, so nothing here can go stale.
 *
 * ★ THE DAY IS A BUSINESS DATE IN Asia/Ho_Chi_Minh, and which turns are work
 * on it is said once, in SQL (`turnWorksOn`, fleet-operations.repository.ts).
 */

/**
 * A turn's progress: how many of the four milestones carry a live reading, and
 * the first one still owed. `missingMilestones` is the completeness rule the
 * completion review asks — so 4/4 here is exactly what that review accepts.
 */
export interface TurnProgress {
  reached: number;
  next: ExecutionEventType | null;
}

export const progressOf = (reached: readonly ExecutionEventType[]): TurnProgress => {
  const missing = missingMilestones(reached);
  return { reached: EXECUTION_EVENT_TYPES.length - missing.length, next: missing[0] ?? null };
};

/**
 * Where ONE turn stands on the day.
 *
 *   running   on the road: started, not all four milestones yet
 *   waiting   not started
 *   done      the trip is finished, or every milestone is in (waiting on the
 *             office's approval is paperwork — the lorry is free)
 */
export type TurnState = 'running' | 'waiting' | 'done';

export const turnStateOf = (turn: { closed: boolean; progress: TurnProgress }): TurnState => {
  if (turn.closed || turn.progress.next === null) return 'done';
  return turn.progress.reached === 0 ? 'waiting' : 'running';
};

/** Where a lorry stands on the day: its busiest turn, or no turn at all. */
export const FLEET_VEHICLE_STATES = ['running', 'waiting', 'done', 'unassigned'] as const;
export type FleetVehicleState = (typeof FLEET_VEHICLE_STATES)[number];

export const vehicleStateOf = (turns: ReadonlyArray<{ state: TurnState }>): FleetVehicleState => {
  if (turns.some((turn) => turn.state === 'running')) return 'running';
  if (turns.some((turn) => turn.state === 'waiting')) return 'waiting';
  return turns.length > 0 ? 'done' : 'unassigned';
};

/**
 * ★ THE OBLIGATION, NOT THE MONEY (concept A). Whether the lorry owed its
 * beginning-of-shift check on the day, and how it was answered:
 *
 *   NOT_REQUIRED       the lorry's fuel is not declared on it, or it has no work
 *   REQUIRED_MISSING   it owes the check and nobody has answered it
 *   FUEL_ADDED         answered "Có đổ nhiên liệu"
 *   NO_FUEL            answered "Không đổ nhiên liệu đầu ca" — a fill later the
 *                      same day is the ledger's business and leaves this alone
 *
 * A check that exists is shown whatever the flag says now: it is a recorded fact.
 */
export const FUEL_OBLIGATIONS = ['NOT_REQUIRED', 'REQUIRED_MISSING', 'FUEL_ADDED', 'NO_FUEL'] as const;
export type FuelObligation = (typeof FUEL_OBLIGATIONS)[number];

export const fuelObligationOf = (input: {
  dailyFuelCheckRequired: boolean;
  checkOutcome: DailyFuelOutcome | null;
  hasWork: boolean;
}): FuelObligation => {
  if (input.checkOutcome === 'fuel_added') return 'FUEL_ADDED';
  if (input.checkOutcome === 'no_fuel') return 'NO_FUEL';
  return input.dailyFuelCheckRequired && input.hasWork ? 'REQUIRED_MISSING' : 'NOT_REQUIRED';
};

/**
 * ★ DETERMINISTIC DATA-QUALITY FLAGS, AND ONLY THOSE. Each is a fact the rows
 * prove — no threshold, no estimate, no "suspicious" amount.
 *
 *   FUEL_UNDECLARED    the check is owed and missing (Chưa khai)
 *   LITERS_MISSING     a live fill of the day has no liters (Thiếu số lít)
 *   ODOMETER_MISSING   a live fill of the day has no odometer (Thiếu công-tơ-mét)
 */
export const FLEET_DATA_ISSUES = ['FUEL_UNDECLARED', 'LITERS_MISSING', 'ODOMETER_MISSING'] as const;
export type FleetDataIssue = (typeof FLEET_DATA_ISSUES)[number];

export const dataIssuesOf = (input: {
  obligation: FuelObligation;
  fillsWithoutLiters: number;
  fillsWithoutOdometer: number;
}): FleetDataIssue[] => [
  ...(input.obligation === 'REQUIRED_MISSING' ? (['FUEL_UNDECLARED'] as const) : []),
  ...(input.fillsWithoutLiters > 0 ? (['LITERS_MISSING'] as const) : []),
  ...(input.fillsWithoutOdometer > 0 ? (['ODOMETER_MISSING'] as const) : []),
];

/** One turn of the lorry's day, as Dispatch reads it. No price, no cost. */
export interface FleetTurn {
  assignmentId: string;
  tripId: string;
  scheduledOn: string;
  scheduledPickupAt: Date | null;
  scheduledDeliveryAt: Date | null;
  pickupName: string | null;
  deliveryName: string | null;
  customerName: string | null;
  driver: UserSummary;
  closed: boolean;
  progress: TurnProgress;
  state: TurnState;
}

/**
 * One lorry's day.
 *
 * ★ THE MONEY IS `null` UNLESS THE READER HOLDS `cost.read` — and not because a
 * mapper hides it: the statement selects it only when told the reader may see
 * it (`withMoney`). `fills` (how many fuel transactions) and the data flags are
 * operational facts, not figures, so every reader of the board gets them.
 */
export interface FleetVehicleDay {
  vehicle: {
    id: string;
    plate: string;
    ownership: VehicleOwnership | null;
    dailyFuelCheckRequired: boolean;
    archived: boolean;
  };
  state: FleetVehicleState;
  drivers: UserSummary[];
  turns: FleetTurn[];
  fuel: {
    obligation: FuelObligation;
    /** The beginning-of-shift check, when answered. `vehicleCostId` is the fill it names. */
    check: {
      outcome: DailyFuelOutcome;
      declaredBy: UserSummary;
      declaredAt: Date;
      vehicleCostId: string | null;
      /** Concept B — the declaration's own fill. `cost.read` only. */
      amount: string | null;
    } | null;
    /** Live fuel rows of the ledger on the day — the declaration's fill included. */
    fills: number;
    /**
     * Concept C — `SUM(amount)` of those rows. `cost.read` only. The same rows
     * and the same live-row predicate as the lorry's "Chi phí xe", so the two
     * agree to the đồng for that day.
     */
    totalAmount: string | null;
    issues: FleetDataIssue[];
  };
}

export interface FleetBoard {
  businessDate: string;
  /** Whether the money fields were selected for this reader. */
  withMoney: boolean;
  summary: {
    total: number;
    running: number;
    waiting: number;
    unassigned: number;
    fuelMissing: number;
  };
  vehicles: FleetVehicleDay[];
}

export const summaryOf = (vehicles: readonly FleetVehicleDay[]): FleetBoard['summary'] => ({
  total: vehicles.length,
  running: vehicles.filter((v) => v.state === 'running').length,
  waiting: vehicles.filter((v) => v.state === 'waiting').length,
  unassigned: vehicles.filter((v) => v.state === 'unassigned').length,
  fuelMissing: vehicles.filter((v) => v.fuel.obligation === 'REQUIRED_MISSING').length,
});
