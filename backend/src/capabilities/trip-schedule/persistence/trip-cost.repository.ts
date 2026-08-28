import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type {
  MoneyAmount,
  OutsourceHire,
  TripCost,
  TripCostCategory,
  TripCostTotals,
} from '../domain/trip-cost';

/**
 * SQL for a trip's money. Opens no transaction; decides nothing.
 *
 * ★ TWO CLASSES WITH SIMILAR SHAPES, AND NOT ONE GENERIC ONE — the same choice
 * `trip-catalogue.repository.ts` makes, for the same reason: a repository that
 * interpolates a table name into its SQL is a repository whose safety depends
 * on every future caller passing a constant. The row mappers differ anyway,
 * because the two records genuinely hold different columns.
 *
 * ⚠ NO `UPDATE` OF ANY FINANCIAL FIELD EXISTS IN THIS FILE, and that absence is
 * the rule rather than an omission. The only UPDATE either class issues sets the
 * three void columns, and it is guarded so it can never touch a record that was
 * already void. There is deliberately no method a caller could use to change an
 * amount, a category or a trip — a correction is a void plus a new row.
 */

/** Columns every financial row shares, in the order both mappers read them. */
const AUDIT_COLUMNS = 'note, created_by, created_at, voided_at, voided_by, void_reason';

const COST_COLUMNS = `id, trip_id, category, amount::text AS amount, ${AUDIT_COLUMNS}`;
const HIRE_COLUMNS =
  `id, trip_id, carrier_name, agreed_amount::text AS agreed_amount, ` +
  `amount_includes_vat, document_ref, ${AUDIT_COLUMNS}`;

/**
 * ★ `::text` ON EVERY MONEY COLUMN, AND ON EVERY SUM.
 *
 * `pg` already returns `NUMERIC` as a string, so this cast changes nothing
 * today. It is written anyway because that behaviour is a driver default a
 * `pg.types.setTypeParser` call anywhere in the process could flip to
 * `parseFloat` — at which point every amount silently loses precision and
 * nothing fails. Casting in SQL makes the value text before the driver ever
 * decides, so no configuration can reach it.
 */

interface AuditRow {
  note: string | null;
  created_by: string;
  created_at: Date;
  voided_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
}

interface CostRow extends AuditRow {
  id: string;
  trip_id: string;
  category: TripCostCategory;
  amount: string;
}

interface HireRow extends AuditRow {
  id: string;
  trip_id: string;
  carrier_name: string;
  agreed_amount: string;
  amount_includes_vat: boolean;
  document_ref: string | null;
}

const toAudit = (row: AuditRow) => ({
  note: row.note,
  createdBy: row.created_by,
  createdAt: row.created_at,
  voidedAt: row.voided_at,
  voidedBy: row.voided_by,
  voidReason: row.void_reason,
});

const toCost = (row: CostRow): TripCost => ({
  id: row.id,
  tripId: row.trip_id,
  category: row.category,
  amount: row.amount,
  ...toAudit(row),
});

const toHire = (row: HireRow): OutsourceHire => ({
  id: row.id,
  tripId: row.trip_id,
  carrierName: row.carrier_name,
  agreedAmount: row.agreed_amount,
  amountIncludesVat: row.amount_includes_vat,
  documentRef: row.document_ref,
  ...toAudit(row),
});

/** Newest first, then by id so a page boundary inside one second is stable. */
const ORDER = 'ORDER BY created_at DESC, id DESC';

@Injectable()
export class TripCostRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    input: {
      tripId: string;
      category: TripCostCategory;
      amount: MoneyAmount;
      note: string | null;
      createdBy: string;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<TripCost> {
    const rows = await executor.query<CostRow>(
      `INSERT INTO trip_costs (trip_id, category, amount, note, created_by)
       VALUES ($1, $2, $3::numeric, $4, $5)
       RETURNING ${COST_COLUMNS}`,
      [input.tripId, input.category, input.amount, input.note, input.createdBy],
    );

    const row = rows[0];
    if (!row) throw new Error('INSERT INTO trip_costs returned no row');

    return toCost(row);
  }

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<TripCost | null> {
    const rows = await executor.query<CostRow>(
      `SELECT ${COST_COLUMNS} FROM trip_costs WHERE id = $1`,
      [id],
    );
    return rows[0] ? toCost(rows[0]) : null;
  }

  /**
   * Every line ever written against a trip, voided ones included.
   *
   * Deliberately NOT paginated, for the reason ADR-0002 §4 gives for
   * `GET /departments`: a day's spending on one lorry is bounded small.
   */
  async listByTrip(tripId: string, executor: DatabaseQuery = this.db): Promise<TripCost[]> {
    const rows = await executor.query<CostRow>(
      `SELECT ${COST_COLUMNS} FROM trip_costs WHERE trip_id = $1 ${ORDER}`,
      [tripId],
    );
    return rows.map(toCost);
  }

  /** Only the lines that still count. Served by `idx_trip_cost_trip`. */
  async listActiveByTrip(tripId: string, executor: DatabaseQuery = this.db): Promise<TripCost[]> {
    const rows = await executor.query<CostRow>(
      `SELECT ${COST_COLUMNS} FROM trip_costs
        WHERE trip_id = $1 AND voided_at IS NULL ${ORDER}`,
      [tripId],
    );
    return rows.map(toCost);
  }

  /**
   * Withdraws a line without destroying it.
   *
   * `WHERE voided_at IS NULL` is what makes a second void a no-op the service
   * turns into a refusal, rather than a silent rewrite of who withdrew it and
   * why. All three columns are set in the one statement, so the database's
   * `trip_costs_void_state` constraint can never see a half-set row.
   */
  async void(
    id: string,
    by: string,
    reason: string,
    now: Date,
    executor: DatabaseQuery = this.db,
  ): Promise<TripCost | null> {
    const rows = await executor.query<CostRow>(
      `UPDATE trip_costs
          SET voided_at = $4, voided_by = $2, void_reason = $3
        WHERE id = $1 AND voided_at IS NULL
        RETURNING ${COST_COLUMNS}`,
      [id, by, reason, now],
    );
    return rows[0] ? toCost(rows[0]) : null;
  }
}

@Injectable()
export class OutsourceHireRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    input: {
      tripId: string;
      carrierName: string;
      agreedAmount: MoneyAmount;
      amountIncludesVat: boolean;
      documentRef: string | null;
      note: string | null;
      createdBy: string;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<OutsourceHire> {
    const rows = await executor.query<HireRow>(
      `INSERT INTO trip_outsource_hires
         (trip_id, carrier_name, agreed_amount, amount_includes_vat, document_ref, note, created_by)
       VALUES ($1, $2, $3::numeric, $4, $5, $6, $7)
       RETURNING ${HIRE_COLUMNS}`,
      [
        input.tripId,
        input.carrierName,
        input.agreedAmount,
        input.amountIncludesVat,
        input.documentRef,
        input.note,
        input.createdBy,
      ],
    );

    const row = rows[0];
    if (!row) throw new Error('INSERT INTO trip_outsource_hires returned no row');

    return toHire(row);
  }

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<OutsourceHire | null> {
    const rows = await executor.query<HireRow>(
      `SELECT ${HIRE_COLUMNS} FROM trip_outsource_hires WHERE id = $1`,
      [id],
    );
    return rows[0] ? toHire(rows[0]) : null;
  }

  async listByTrip(tripId: string, executor: DatabaseQuery = this.db): Promise<OutsourceHire[]> {
    const rows = await executor.query<HireRow>(
      `SELECT ${HIRE_COLUMNS} FROM trip_outsource_hires WHERE trip_id = $1 ${ORDER}`,
      [tripId],
    );
    return rows.map(toHire);
  }

  async listActiveByTrip(
    tripId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<OutsourceHire[]> {
    const rows = await executor.query<HireRow>(
      `SELECT ${HIRE_COLUMNS} FROM trip_outsource_hires
        WHERE trip_id = $1 AND voided_at IS NULL ${ORDER}`,
      [tripId],
    );
    return rows.map(toHire);
  }

  async void(
    id: string,
    by: string,
    reason: string,
    now: Date,
    executor: DatabaseQuery = this.db,
  ): Promise<OutsourceHire | null> {
    const rows = await executor.query<HireRow>(
      `UPDATE trip_outsource_hires
          SET voided_at = $4, voided_by = $2, void_reason = $3
        WHERE id = $1 AND voided_at IS NULL
        RETURNING ${HIRE_COLUMNS}`,
      [id, by, reason, now],
    );
    return rows[0] ? toHire(rows[0]) : null;
  }
}

/**
 * The three totals, added by PostgreSQL rather than by JavaScript.
 *
 * ★ ITS OWN CLASS BECAUSE IT SPANS BOTH TABLES, and neither repository above
 * should reach into the other's. One statement rather than three so all three
 * figures come from a single snapshot — two round trips could see a line
 * voided between them and return a `combined` that is not the sum of the parts.
 *
 * `COALESCE(..., 0)` because `SUM` over no rows is NULL, and "this trip has no
 * cost yet" must read as `"0.00"` rather than as a missing value every caller
 * has to remember to handle.
 */
@Injectable()
export class TripCostTotalsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async forTrip(tripId: string, executor: DatabaseQuery = this.db): Promise<TripCostTotals> {
    const rows = await executor.query<{ costs: string; hires: string; combined: string }>(
      `WITH cost_total AS (
         SELECT COALESCE(SUM(amount), 0)::numeric(14,2) AS value
           FROM trip_costs WHERE trip_id = $1 AND voided_at IS NULL
       ), hire_total AS (
         SELECT COALESCE(SUM(agreed_amount), 0)::numeric(14,2) AS value
           FROM trip_outsource_hires WHERE trip_id = $1 AND voided_at IS NULL
       )
       SELECT cost_total.value::text AS costs,
              hire_total.value::text AS hires,
              (cost_total.value + hire_total.value)::text AS combined
         FROM cost_total, hire_total`,
      [tripId],
    );

    const row = rows[0];
    if (!row) throw new Error('Totals query returned no row');

    return { costs: row.costs, hires: row.hires, combined: row.combined };
  }
}
