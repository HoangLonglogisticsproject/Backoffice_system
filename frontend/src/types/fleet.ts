import type { FuelObligation, TurnProgress, VehicleOwnership } from './driver';
import type { UserSummary } from './organization';

/**
 * "Điều hành xe" — every lorry's day, as the server derives it. Nothing here is
 * stored: states come from turns, milestones and the day's fuel check.
 */

export type FleetVehicleState = 'running' | 'waiting' | 'done' | 'unassigned';
export type FleetTurnState = 'running' | 'waiting' | 'done';
export type FleetDataIssue = 'FUEL_UNDECLARED' | 'LITERS_MISSING' | 'ODOMETER_MISSING';

export interface FleetTurn {
  assignmentId: string;
  tripId: string;
  scheduledOn: string;
  scheduledPickupAt: string | null;
  scheduledDeliveryAt: string | null;
  pickupName: string | null;
  deliveryName: string | null;
  customerName: string | null;
  driver: UserSummary;
  closed: boolean;
  progress: TurnProgress;
  state: FleetTurnState;
}

export interface FleetVehicleDay {
  vehicle: {
    id: string;
    plate: string;
    ownership: VehicleOwnership | null;
    dailyFuelCheckRequired: boolean;
    archived: boolean;
  };
  state: FleetVehicleState;
  /** Everybody who drives the lorry that day. */
  drivers: UserSummary[];
  turns: FleetTurn[];
  /**
   * The turn the row speaks for and the one after it — the server's one rule
   * (first running, else first waiting, else the last done). The lorry's state
   * is that turn's state; the driver shown is that turn's driver.
   */
  currentAssignmentId: string | null;
  nextAssignmentId: string | null;
  fuel: {
    obligation: FuelObligation;
    check: {
      outcome: 'fuel_added' | 'no_fuel';
      declaredBy: UserSummary;
      declaredAt: string;
      vehicleCostId: string | null;
      /** `null` without `cost.read` — the server never selected it. */
      amount: string | null;
    } | null;
    fills: number;
    /** `null` without `cost.read` — the server never selected it. */
    totalAmount: string | null;
    issues: FleetDataIssue[];
  };
}

export interface FleetBoard {
  businessDate: string;
  withMoney: boolean;
  summary: { total: number; running: number; waiting: number; unassigned: number; fuelMissing: number };
  vehicles: FleetVehicleDay[];
}
