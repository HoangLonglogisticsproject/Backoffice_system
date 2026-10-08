import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '../../../common/types/database.port';
import type {
  FuelLedger,
  FuelTransactionFlag,
  FuelTransactionView,
} from '../domain/fuel-transaction-view';

/**
 * ★ ONE SHAPE, ONE STATEMENT PER LEDGER. Each query reads the money row, its
 * live fuel transaction if any, and everything a reader needs about both —
 * the amount from the backing, the readings from whichever row owns them, the
 * unit price divided by PostgreSQL (never a float in JavaScript).
 *
 * A fill that has not been wrapped is the cost as it stands: its driver is
 * the one its own provenance names (the driver who recorded a portal fill, or
 * the turn that declared a trip line) and nothing is invented beyond that.
 */

export type ViewRow = {
  cost_id: string;
  source: string;
  voided: boolean;
  category: string;
  vehicle_id: string | null;
  plate: string | null;
  business_date: string | null;
  occurred_at: Date | null;
  recorded_at: Date;
  amount: string;
  liters: string | null;
  odometer_km: number | null;
  unit_price: string | null;
  driver_id: string | null;
  driver_name: string | null;
  vendor_name: string | null;
  vendor_tax_code: string | null;
  document_series: string | null;
  document_number: string | null;
  trip_id: string | null;
  trip_scheduled_on: string | null;
  trip_customer_name: string | null;
  recorded_by: string;
  recorded_by_name: string;
  fuel_transaction_id: string | null;
  no_longer_fuel: boolean;
  edited_after_evidence: boolean;
  vehicle_only_by_evidence: boolean;
};

const FACTS = `ft.id AS fuel_transaction_id, ft.occurred_at, ft.vendor_name, ft.vendor_tax_code,
               ft.document_series, ft.document_number`;

/** The lorry-ledger projection, unfiltered: callers add their WHERE (`c` is the cost, `ft` its live fill). */
export const VEHICLE_SELECT = `
  SELECT c.id AS cost_id, c.source, c.voided_at IS NOT NULL AS voided, c.category,
         v.id AS vehicle_id, v.plate, c.business_date::text AS business_date,
         c.created_at AS recorded_at, c.amount::text AS amount, c.liters::text AS liters, c.odometer_km,
         round(c.amount / NULLIF(c.liters, 0), 2)::text AS unit_price,
         du.id AS driver_id, du.display_name AS driver_name, ${FACTS},
         st.id AS trip_id, st.scheduled_on::text AS trip_scheduled_on, sc.name AS trip_customer_name,
         c.created_by AS recorded_by, cu.display_name AS recorded_by_name,
         false AS no_longer_fuel, false AS edited_after_evidence, false AS vehicle_only_by_evidence
    FROM vehicle_costs c
    JOIN trip_vehicles v ON v.id = c.vehicle_id
    JOIN users cu ON cu.id = c.created_by
    LEFT JOIN fuel_transactions ft ON ft.vehicle_cost_id = c.id AND ft.voided_at IS NULL
    LEFT JOIN users du ON du.id = COALESCE(ft.driver_user_id,
                                           CASE WHEN c.source = 'driver_portal' THEN c.created_by END)
    LEFT JOIN trip_schedules st ON st.id = c.source_trip_id
    LEFT JOIN trip_customers sc ON sc.id = st.customer_id`;

/** The trip-ledger projection, unfiltered: `tc` is the line, `ts` its trip, `ft` its live fill. */
export const TRIP_SELECT = `
  SELECT tc.id AS cost_id, tc.source, tc.voided_at IS NOT NULL AS voided, tc.category,
         v.id AS vehicle_id, v.plate, ft.business_date::text AS business_date,
         tc.created_at AS recorded_at, tc.amount::text AS amount, ft.liters::text AS liters, ft.odometer_km,
         round(tc.amount / NULLIF(ft.liters, 0), 2)::text AS unit_price,
         du.id AS driver_id, du.display_name AS driver_name, ${FACTS},
         ts.id AS trip_id, ts.scheduled_on::text AS trip_scheduled_on, cust.name AS trip_customer_name,
         tc.created_by AS recorded_by, cu.display_name AS recorded_by_name,
         (ft.id IS NOT NULL AND tc.category <> 'fuel') AS no_longer_fuel,
         (ft.id IS NOT NULL AND EXISTS (
            SELECT 1 FROM trip_cost_edits edit
             WHERE edit.cost_id = tc.id
               AND edit.edited_at > (SELECT min(x.attached_at) FROM fuel_transaction_evidence x
                                      WHERE x.fuel_transaction_id = ft.id AND x.retired_at IS NULL)
         )) AS edited_after_evidence,
         (ft.id IS NOT NULL AND tc.vehicle_id IS NULL AND ts.vehicle_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM trip_driver_assignments turn WHERE turn.trip_id = tc.trip_id AND turn.vehicle_id IS NOT NULL
         )) AS vehicle_only_by_evidence
    FROM trip_costs tc
    JOIN trip_schedules ts ON ts.id = tc.trip_id
    JOIN users cu ON cu.id = tc.created_by
    LEFT JOIN trip_driver_assignments a ON a.id = tc.driver_assignment_id
    LEFT JOIN fuel_transactions ft ON ft.trip_cost_id = tc.id AND ft.voided_at IS NULL
    LEFT JOIN trip_vehicles v ON v.id = COALESCE(ft.vehicle_id, tc.vehicle_id)
    LEFT JOIN users du ON du.id = COALESCE(ft.driver_user_id, a.driver_user_id)
    LEFT JOIN trip_customers cust ON cust.id = ts.customer_id`;

const flagsOf = (row: ViewRow): FuelTransactionFlag[] => {
  const flags: FuelTransactionFlag[] = [];
  if (row.voided) flags.push('backingVoided');
  if (row.no_longer_fuel) flags.push('noLongerFuel');
  if (row.edited_after_evidence) flags.push('editedAfterEvidence');
  if (row.vehicle_only_by_evidence) flags.push('vehicleConfirmedOnlyByEvidence');
  return flags;
};

/** The view without its evidence list, plus the category the service needs to judge it. */
export type FuelViewRecord = Omit<FuelTransactionView, 'evidence'> & { category: string };

export const toView = (ledger: FuelLedger, row: ViewRow): FuelViewRecord => ({
  fuelTransactionId: row.fuel_transaction_id,
  backing: { ledger, costId: row.cost_id, source: row.source, voided: row.voided },
  vehicle: row.vehicle_id && row.plate ? { id: row.vehicle_id, plate: row.plate } : null,
  businessDate: row.business_date,
  occurredAt: row.occurred_at,
  recordedAt: row.recorded_at,
  amount: row.amount,
  liters: row.liters,
  odometerKm: row.odometer_km,
  unitPrice: row.unit_price,
  driver: row.driver_id && row.driver_name ? { id: row.driver_id, displayName: row.driver_name } : null,
  vendor: row.vendor_name || row.vendor_tax_code ? { name: row.vendor_name, taxCode: row.vendor_tax_code } : null,
  document:
    row.document_series || row.document_number ? { series: row.document_series, number: row.document_number } : null,
  trip:
    row.trip_id && row.trip_scheduled_on
      ? { id: row.trip_id, scheduledOn: row.trip_scheduled_on, customerName: row.trip_customer_name }
      : null,
  flags: flagsOf(row),
  recordedBy: { id: row.recorded_by, displayName: row.recorded_by_name },
  category: row.category,
});

@Injectable()
export class FuelTransactionViewRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async ofVehicleCost(vehicleId: string, costId: string): Promise<FuelViewRecord | null> {
    const [row] = await this.db.query<ViewRow>(`${VEHICLE_SELECT} WHERE c.id = $1 AND c.vehicle_id = $2`, [costId, vehicleId]);
    return row ? toView('vehicle', row) : null;
  }

  async ofTripCost(tripId: string, costId: string): Promise<FuelViewRecord | null> {
    const [row] = await this.db.query<ViewRow>(`${TRIP_SELECT} WHERE tc.id = $1 AND tc.trip_id = $2`, [costId, tripId]);
    return row ? toView('trip', row) : null;
  }
}
