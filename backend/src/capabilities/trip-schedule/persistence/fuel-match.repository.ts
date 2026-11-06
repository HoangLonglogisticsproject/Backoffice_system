import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { MatchBasis, MatchLevel } from '../domain/fuel-match';
import { TRIP_SELECT, VEHICLE_SELECT, toView, type FuelViewRecord, type ViewRow } from './fuel-transaction-view.repository';

/** A tax code and document number — one receipt — with its series when known. */
export interface DocumentIdentity {
  taxCode: string;
  number: string;
  series: string | null;
}

/** Another live fill already holding part of a receipt, and which part. */
export interface FillHit {
  fuelTransactionId: string;
  basis: Extract<MatchBasis, 'evidence_hash' | 'document_identity'>;
  sha256: string | null;
}

export interface Acknowledgement {
  matchedFuelTransactionId: string;
  level: MatchLevel;
  basis: MatchBasis;
  evidenceId: string | null;
}

const WINDOW = `BETWEEN $2::date - 1 AND $2::date + 1`;

/**
 * A fill whose money row was withdrawn (a rejected driver fill, a voided trip
 * line) no longer holds its receipt: the corrected fill may carry the same
 * photo or invoice without being taken for a duplicate.
 */
const LIVE_BACKING = `NOT EXISTS (SELECT 1 FROM vehicle_costs vc WHERE vc.id = ft.vehicle_cost_id AND vc.voided_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM trip_costs tc WHERE tc.id = ft.trip_cost_id AND tc.voided_at IS NOT NULL)`;

/**
 * ★ THE LORRY'S FUEL COSTS AROUND ONE DAY, ON BOTH LEDGERS. A trip line counts
 * when it names the lorry, when the trip records the lorry, or when it is
 * wrapped for the lorry. A line on a trip that records NO lorry is everybody's
 * and nobody's: it is shown only when its amount is the receipt's — never as
 * noise around the day.
 */
const NEARBY_VEHICLE = `${VEHICLE_SELECT}
   WHERE c.vehicle_id = $1 AND c.business_date ${WINDOW} AND c.category = 'fuel' AND c.voided_at IS NULL`;

const NEARBY_TRIP = `${TRIP_SELECT}
   WHERE tc.category = 'fuel' AND tc.voided_at IS NULL
     AND ((ft.id IS NOT NULL AND ft.vehicle_id = $1 AND ft.business_date ${WINDOW})
       OR (ft.id IS NULL AND ts.scheduled_on ${WINDOW}
           AND (tc.vehicle_id = $1
             OR (tc.vehicle_id IS NULL AND (ts.vehicle_id = $1 OR EXISTS (
                   SELECT 1 FROM trip_driver_assignments x WHERE x.trip_id = tc.trip_id AND x.vehicle_id = $1)))
             OR (tc.vehicle_id IS NULL AND ts.vehicle_id IS NULL AND tc.amount = $3::numeric AND NOT EXISTS (
                   SELECT 1 FROM trip_driver_assignments x WHERE x.trip_id = tc.trip_id AND x.vehicle_id IS NOT NULL)))))`;

/** Read side of the duplicate check, plus the write side's lock and acknowledgement. */
@Injectable()
export class FuelMatchRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async nearby(vehicleId: string, businessDate: string, amount: string): Promise<FuelViewRecord[]> {
    const [lorry, trip] = await Promise.all([
      this.db.query<ViewRow>(NEARBY_VEHICLE, [vehicleId, businessDate]),
      this.db.query<ViewRow>(NEARBY_TRIP, [vehicleId, businessDate, amount]),
    ]);
    return [...lorry.map((row) => toView('vehicle', row)), ...trip.map((row) => toView('trip', row))];
  }

  /** The costs behind these fills, wherever and whenever they are. */
  async ofFills(ids: readonly string[]): Promise<FuelViewRecord[]> {
    if (ids.length === 0) return [];
    const [lorry, trip] = await Promise.all([
      this.db.query<ViewRow>(`${VEHICLE_SELECT} WHERE ft.id = ANY($1::uuid[])`, [ids]),
      this.db.query<ViewRow>(`${TRIP_SELECT} WHERE ft.id = ANY($1::uuid[])`, [ids]),
    ]);
    return [...lorry.map((row) => toView('vehicle', row)), ...trip.map((row) => toView('trip', row))];
  }

  /** Live fills — other than `except` — holding one of these images or this document. */
  async fillsHolding(
    shas: readonly string[],
    document: DocumentIdentity | null,
    except: string | null,
    executor: DatabaseQuery = this.db,
  ): Promise<FillHit[]> {
    return executor.query<FillHit>(
      `SELECT DISTINCT e.fuel_transaction_id AS "fuelTransactionId", 'evidence_hash' AS basis, e.sha256
         FROM fuel_transaction_evidence e
         JOIN fuel_transactions ft ON ft.id = e.fuel_transaction_id AND ft.voided_at IS NULL
        WHERE e.sha256 = ANY($1::text[]) AND e.retired_at IS NULL AND ft.id IS DISTINCT FROM $5::uuid
          AND ${LIVE_BACKING}
       UNION ALL
       SELECT ft.id, 'document_identity', NULL
         FROM fuel_transactions ft
        WHERE ft.voided_at IS NULL AND ft.vendor_tax_code = $2 AND ft.document_number = $3
          AND (ft.document_series IS NULL OR $4::text IS NULL OR ft.document_series = $4)
          AND ft.id IS DISTINCT FROM $5::uuid AND ${LIVE_BACKING}`,
      [shas, document?.taxCode ?? null, document?.number ?? null, document?.series ?? null, except],
    );
  }

  /** How many live images each fill holds, and whether one of them is the receipt's. */
  async evidenceOn(fills: readonly string[], shas: readonly string[]): Promise<Map<string, { count: number; hit: boolean }>> {
    const rows = await this.db.query<{ id: string; count: number; hit: boolean }>(
      `SELECT fuel_transaction_id AS id, COUNT(*)::int AS count, bool_or(sha256 = ANY($2::text[])) AS hit
         FROM fuel_transaction_evidence
        WHERE fuel_transaction_id = ANY($1::uuid[]) AND retired_at IS NULL
        GROUP BY fuel_transaction_id`,
      [fills, shas],
    );
    return new Map(rows.map(({ id, ...rest }) => [id, rest]));
  }

  /** The images a caller uploaded, by id — what their receipt looks like, byte for byte. */
  async imagesOf(ids: readonly string[], uploader: string): Promise<Map<string, string>> {
    const rows = await this.db.query<{ id: string; sha256: string }>(
      `SELECT id, sha256 FROM fuel_transaction_evidence
        WHERE id = ANY($1::uuid[]) AND uploaded_by = $2 AND discarded_at IS NULL`,
      [ids, uploader],
    );
    return new Map(rows.map((row) => [row.id, row.sha256]));
  }

  /**
   * ★ ONE WRITER AT A TIME PER IMAGE AND PER DOCUMENT, until commit — so two
   * accountants putting one receipt on two fills cannot both miss each other.
   * Taken in sorted order, after the backing row: no two writers wait in a
   * circle. One statement: PostgreSQL evaluates the output list after ORDER BY.
   */
  async lockReceipt(keys: readonly string[], tx: DatabaseQuery): Promise<void> {
    const sorted = [...new Set(keys)].sort((a, b) => a.localeCompare(b)).map((key) => `fuel-receipt:${key}`);
    await tx.query(
      `SELECT pg_advisory_xact_lock(hashtextextended(k, 0))
         FROM unnest($1::text[]) WITH ORDINALITY AS t(k, n) ORDER BY n`,
      [sorted],
    );
  }

  async acknowledge(subject: string, acks: readonly Acknowledgement[], by: string, tx: DatabaseQuery): Promise<void> {
    if (acks.length === 0) return;
    await tx.query(
      `INSERT INTO fuel_match_acks (subject_fuel_transaction_id, matched_fuel_transaction_id, level, basis, evidence_id, acknowledged_by)
       SELECT $1, m, l, b, e, $6 FROM unnest($2::uuid[], $3::text[], $4::text[], $5::uuid[]) AS t(m, l, b, e)`,
      [subject, acks.map((a) => a.matchedFuelTransactionId), acks.map((a) => a.level), acks.map((a) => a.basis),
       acks.map((a) => a.evidenceId), by],
    );
  }
}
