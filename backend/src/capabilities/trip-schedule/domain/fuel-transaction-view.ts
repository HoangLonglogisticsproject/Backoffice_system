import type { UserSummary } from '../../../common/types/user-summary';
import type { FuelEvidence } from './fuel-evidence';

/** Which ledger holds the money of a fill. */
export type FuelLedger = 'vehicle' | 'trip';

/**
 * What a reader should know about a fill that the numbers alone do not say.
 * Flagged, never blocked: the trip line belongs to its own lifecycle.
 *
 *   backingVoided                   the money row was withdrawn
 *   noLongerFuel                    the trip line was re-headed away from fuel
 *   editedAfterEvidence             the trip line's figure changed after an image was attached
 *   vehicleConfirmedOnlyByEvidence  the trip records no lorry; only the office's choice names it
 */
export const FUEL_TRANSACTION_FLAGS = [
  'backingVoided',
  'noLongerFuel',
  'editedAfterEvidence',
  'vehicleConfirmedOnlyByEvidence',
] as const;
export type FuelTransactionFlag = (typeof FUEL_TRANSACTION_FLAGS)[number];

/**
 * ★ ONE SHAPE FOR EVERY FILL, whichever ledger backs it and whether or not it
 * has been wrapped yet. `fuelTransactionId` is `null` while the cost has no
 * fuel transaction: the view is then the cost as it stands.
 *
 * `amount` is ALWAYS the backing row's. `liters` and `odometerKm` are the
 * vehicle cost's, or the fuel transaction's when the backing is a trip line.
 * `unitPrice` is derived (amount ÷ liters, by PostgreSQL) and never stored.
 */
export interface FuelTransactionView {
  fuelTransactionId: string | null;
  backing: { ledger: FuelLedger; costId: string; source: string; voided: boolean };
  vehicle: { id: string; plate: string } | null;
  businessDate: string | null;
  occurredAt: Date | null;
  /** When the money row entered the platform. */
  recordedAt: Date;
  amount: string;
  liters: string | null;
  odometerKm: number | null;
  unitPrice: string | null;
  driver: UserSummary | null;
  vendor: { name: string | null; taxCode: string | null } | null;
  document: { series: string | null; number: string | null } | null;
  /** Provenance for a vehicle cost; the owning trip for a trip line. */
  trip: { id: string; scheduledOn: string; customerName: string | null } | null;
  flags: FuelTransactionFlag[];
  /** Who recorded the money row. */
  recordedBy: UserSummary;
  evidence: FuelEvidence[];
}
