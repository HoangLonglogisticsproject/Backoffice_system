import type { UserSummary } from './organization';
import type { OffsetPage } from './pagination';
import type { TripCostSource } from './tripCost';

/**
 * A lorry's own money (0034), read by the office with `cost.read`.
 *
 * ★ NOT A TRIP COST. It lives in its own ledger (0..N rows a lorry a day) and
 * is in no trip's total; `sourceTrip` is optional provenance, never ownership.
 */
export type VehicleCostCategory = 'fuel';

export interface VehicleCost {
  id: string;
  vehicleId: string;
  /** The Asia/Ho_Chi_Minh day, `YYYY-MM-DD` — a calendar day, never an instant. */
  businessDate: string;
  category: VehicleCostCategory;
  amount: string;
  liters: string | null;
  odometerKm: number | null;
  note: string | null;
  source: TripCostSource;
  sourceTripId: string | null;
  /** Context, never ownership. `null` exactly when `sourceTripId` is. */
  sourceTrip: { id: string; scheduledOn: string; customerName: string | null } | null;
  sourceAssignmentId: string | null;
  createdBy: string;
  createdByUser: UserSummary;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/** `total` counts rows; `totalAmount` sums the WHOLE filter, live rows only. */
export type VehicleCostPage = OffsetPage<VehicleCost> & { totalAmount: string };
