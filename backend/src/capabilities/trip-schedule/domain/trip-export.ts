import { DomainError } from '../../../common/errors/domain.error';
import type { TripBoardRow, TripCostSummary } from './trip-board';
import type { TripStatus } from './trip-schedule';

/**
 * The Excel export's own shape and its limits — `GET /trip-schedules/export-snapshot`.
 *
 * ★ ONE ROW HOLDS WHAT THE WORKBOOK READS, AND NOTHING ELSE. The board's row
 * also carries coordinates, catalogue ids, timestamps and per-turn detail the
 * file never prints; measured on 10,980 trips that was 44% of the answer
 * (16.3 MB → 9.1 MB). The board's own contract is untouched — this projection
 * exists only on the export route.
 *
 * ⚠ ADD A FIELD HERE WHEN THE WORKBOOK STARTS READING ONE. `toTripSheetRows`
 * and `exportDetails` (frontend `utils/export/`) are the readers; a column
 * built from a field this drops would export as blank.
 */
export interface TripExportRow {
  id: string;
  scheduledOn: string;
  status: TripStatus;
  customer: { name: string } | null;
  cargoInfo: string | null;
  pickupAddress: string | null;
  pickupContact: string | null;
  pickupAt: Date | null;
  deliveryAddress: string | null;
  deliveryContact: string | null;
  deliveryAt: Date | null;
  sellPrice: string | null;
  purchasePrice: string | null;
  note: string | null;
  createdByUser: { displayName: string };
  assignments: { vehicle: { plate: string } | null; driver: { displayName: string } }[];
  /** `null` exactly when the caller holds no `cost.export` — never computed for them. */
  costSummary: Pick<TripCostSummary, 'total' | 'hires' | 'byCategory'> | null;
}

export const toExportRow = (row: TripBoardRow): TripExportRow => ({
  id: row.id,
  scheduledOn: row.scheduledOn,
  status: row.status,
  customer: row.customer ? { name: row.customer.name } : null,
  cargoInfo: row.cargoInfo,
  pickupAddress: row.pickupAddress,
  pickupContact: row.pickupContact,
  pickupAt: row.pickupAt,
  deliveryAddress: row.deliveryAddress,
  deliveryContact: row.deliveryContact,
  deliveryAt: row.deliveryAt,
  sellPrice: row.sellPrice,
  purchasePrice: row.purchasePrice,
  note: row.note,
  createdByUser: { displayName: row.createdByUser.displayName },
  assignments: row.assignments.map((turn) => ({
    vehicle: turn.vehicle ? { plate: turn.vehicle.plate } : null,
    driver: { displayName: turn.driver.displayName },
  })),
  costSummary: row.costSummary
    ? { total: row.costSummary.total, hires: row.costSummary.hires, byCategory: row.costSummary.byCategory }
    : null,
});

/**
 * ★ HOW MANY EXPORTS ONE PROCESS RUNS AT ONCE: 2.
 *
 * Production is one backend process on ONE vCPU (Broadwell) with ~2 GB shared
 * with PostgreSQL. Measured with backend and PostgreSQL pinned to one shared
 * core and the backend capped at 900 MiB: four concurrent one-year exports
 * (21,900 trips) took ~8 s each and stalled ordinary board reads up to 2.5 s;
 * two stay inside the budget below with a third refused, never queued.
 *
 * ⚠ PER PROCESS, NOT PER DEPLOYMENT. Today the deployment IS one process (one
 * backend container); a second replica would double the real ceiling, and a
 * shared counter is the step to take then — not before.
 */
export const EXPORT_MAX_CONCURRENT = 2;

/**
 * ★ HOW MANY TRIPS ONE FILE MAY HOLD: 20,000 — counted inside the snapshot,
 * before a single row or cost is read.
 *
 * Derived, not picked: the edge proxy aborts any response not fully delivered
 * within 15 s (`frontend/api/[...path].ts`). On the measured core a 21,900-trip
 * read takes ~2 s; budgeting two at the cap sharing the core, a CPU up to 3×
 * slower than the measuring one (production's per-core speed is not measured)
 * and the compressed transfer leaves ~20,000. A month at 60 trips a day is
 * ~1,900 — a tenth of it; a whole year fits up to ~54 trips a day.
 */
export const EXPORT_MAX_TRIPS = 20_000;

/** A third export while two run. 429 with a retry hint — refused, never queued. */
export class ExportBusyError extends DomainError {
  readonly code = 'EXPORT_BUSY';
  readonly retryAfterSeconds = 30;

  constructor() {
    super('Two Excel exports are already running. Try again in a moment.');
  }
}

/** More trips than one file holds. Refused whole — never a file cut short. */
export class ExportTooLargeError extends DomainError {
  readonly code = 'EXPORT_TOO_LARGE';
  readonly details: Readonly<Record<string, string>>;

  constructor(trips: number, limit: number) {
    super(`This range holds ${trips} trips; one export holds at most ${limit}. Choose a shorter range.`);
    this.details = { trips: String(trips), limit: String(limit) };
  }
}
