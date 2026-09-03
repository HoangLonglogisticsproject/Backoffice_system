import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type {
  OutsourceHire,
  TripCost,
  TripCostCategory,
  TripCostTotals,
} from '../domain/trip-cost';
import type {
  TripCostEdit,
  TripCostSource,
  TripCostState,
  VehicleOwnership,
} from '../domain/trip-execution';

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

/**
 * ★ EVERY READ JOINS `users`, BECAUSE `created_by` IS A UUID.
 *
 * `common/types/user-summary` states the rule this follows: a UUID cannot be
 * shown to anyone. A financial record whose author is an id is a record nobody
 * can actually audit — "who entered this" is the second question asked of any
 * figure, after "how much". The trip read already solves it this way, and this
 * borrows that shape rather than inventing a second one.
 *
 * INNER JOIN, not LEFT: `created_by` is NOT NULL with a foreign key to a table
 * whose rows are never deleted, so the author always exists and the join cannot
 * drop a row.
 *
 * ⚠ THE NAME CARRIES NO AUTHORIZATION OF ITS OWN. It rides inside a resource
 * `cost.read` already gated, so it is visible exactly when the amount beside it
 * is — the same argument `user-summary` makes for every other projection.
 */
const AUDIT = ['note', 'created_by', 'created_at', 'voided_at', 'voided_by', 'void_reason'] as const;

/**
 * ★ `::text` ON EVERY MONEY COLUMN.
 *
 * `pg` already returns `NUMERIC` as a string, so this cast changes nothing
 * today. It is written anyway because that behaviour is a driver default a
 * `pg.types.setTypeParser` call anywhere in the process could flip to
 * `parseFloat` — at which point every amount silently loses precision and
 * nothing fails. Casting in SQL makes the value text before the driver ever
 * decides, so no configuration can reach it.
 *
 * `alias` is `'c.'` / `'h.'` inside a joined read, `''` in a RETURNING clause.
 */
/**
 * The lifecycle columns 0016 added.
 *
 * Listed apart from the original four so it stays visible that everything here
 * arrived with the driver portal, and that a backoffice line carries the
 * defaults 0016 chose precisely so its behaviour did not change.
 */
const LIFECYCLE = [
  'state',
  'source',
  'driver_assignment_id',
  'vehicle_id',
  'vehicle_ownership',
  'locked_at',
  'locked_by',
] as const;

const costColumns = (alias = ''): string =>
  [
    `${alias}id`,
    `${alias}trip_id`,
    `${alias}category`,
    `${alias}amount::text AS amount`,
    ...AUDIT.map((column) => `${alias}${column}`),
    ...LIFECYCLE.map((column) => `${alias}${column}`),
  ].join(', ');

const hireColumns = (alias = ''): string =>
  [
    `${alias}id`,
    `${alias}trip_id`,
    `${alias}carrier_name`,
    `${alias}agreed_amount::text AS agreed_amount`,
    `${alias}amount_includes_vat`,
    `${alias}document_ref`,
    ...AUDIT.map((column) => `${alias}${column}`),
  ].join(', ');

/**
 * A read of one table with the author's name attached.
 *
 * `SELECT *` is impossible across this join: `users.id` would clobber the
 * record's own `id` and every row would come back identified as its author.
 */
const costsWithAuthor = `
  SELECT ${costColumns('c.')}, u.display_name AS created_by_display_name
    FROM trip_costs c
    JOIN users u ON u.id = c.created_by`;

const hiresWithAuthor = `
  SELECT ${hireColumns('h.')}, u.display_name AS created_by_display_name
    FROM trip_outsource_hires h
    JOIN users u ON u.id = h.created_by`;

/**
 * A write, then the same projection over exactly what it wrote.
 *
 * ★ A DATA-MODIFYING CTE RATHER THAN TWO ROUND TRIPS. `INSERT … RETURNING`
 * cannot join, and a follow-up `SELECT` would read a row another transaction
 * could have voided in between — so the record handed back would not be the
 * record that was written. One statement removes the gap.
 *
 * `written.*` is safe here where `SELECT *` is not: the CTE holds only the
 * columns listed, and `users` contributes one aliased name.
 */
const writeReturningAuthor = (write: string, columns: string): string => `
  WITH written AS (${write} RETURNING ${columns})
  SELECT written.*, u.display_name AS created_by_display_name
    FROM written
    JOIN users u ON u.id = written.created_by`;

interface AuditRow {
  note: string | null;
  created_by: string;
  created_at: Date;
  created_by_display_name: string;
  voided_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
}

interface CostRow extends AuditRow {
  id: string;
  trip_id: string;
  category: TripCostCategory;
  amount: string;
  state: TripCostState;
  source: TripCostSource;
  driver_assignment_id: string | null;
  vehicle_id: string | null;
  vehicle_ownership: VehicleOwnership | null;
  locked_at: Date | null;
  locked_by: string | null;
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
  createdByUser: { id: row.created_by, displayName: row.created_by_display_name },
  voidedAt: row.voided_at,
  voidedBy: row.voided_by,
  voidReason: row.void_reason,
});

const toCost = (row: CostRow): TripCost => ({
  id: row.id,
  tripId: row.trip_id,
  category: row.category,
  amount: row.amount,
  state: row.state,
  source: row.source,
  driverAssignmentId: row.driver_assignment_id,
  vehicleId: row.vehicle_id,
  vehicleOwnership: row.vehicle_ownership,
  lockedAt: row.locked_at,
  lockedBy: row.locked_by,
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

/** Newest first, then by id so two records written in one second stay ordered. */
const ORDER = 'ORDER BY created_at DESC, id DESC';

@Injectable()
export class TripCostRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    input: {
      tripId: string;
      category: TripCostCategory;
      amount: string;
      note: string | null;
      createdBy: string;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<TripCost> {
    const rows = await executor.query<CostRow>(
      writeReturningAuthor(
        `INSERT INTO trip_costs (trip_id, category, amount, note, created_by)
         VALUES ($1, $2, $3::numeric, $4, $5)`,
        costColumns(),
      ),
      [input.tripId, input.category, input.amount, input.note, input.createdBy],
    );

    const row = rows[0];
    if (!row) throw new Error('INSERT INTO trip_costs returned no row');

    return toCost(row);
  }

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<TripCost | null> {
    const rows = await executor.query<CostRow>(`${costsWithAuthor} WHERE c.id = $1`, [id]);
    return rows[0] ? toCost(rows[0]) : null;
  }

  /**
   * Every line ever written against a trip, voided ones included.
   *
   * Deliberately NOT paginated, for the reason ADR-0002 §4 gives for
   * `GET /departments`: a day's spending on one lorry is bounded small.
   */
  async listByTrip(tripId: string, executor: DatabaseQuery = this.db): Promise<TripCost[]> {
    const rows = await executor.query<CostRow>(`${costsWithAuthor} WHERE c.trip_id = $1 ${ORDER}`, [
      tripId,
    ]);
    return rows.map(toCost);
  }

  /** Only the lines that still count. Served by `idx_trip_cost_trip`. */
  async listActiveByTrip(tripId: string, executor: DatabaseQuery = this.db): Promise<TripCost[]> {
    const rows = await executor.query<CostRow>(
      `${costsWithAuthor} WHERE c.trip_id = $1 AND c.voided_at IS NULL ${ORDER}`,
      [tripId],
    );
    return rows.map(toCost);
  }

  /**
   * Withdraws a line without destroying it.
   *
   * `WHERE voided_at IS NULL` is what makes a second void a no-op the service
   * turns into a refusal, rather than a silent rewrite of who withdrew it and
   * why. Both stamp columns are set in the one statement, so the database's
   * `trip_costs_void_state` constraint can never see a half-set row. The reason
   * rides along and may be null: 0021 made it optional.
   */
  async void(
    id: string,
    by: string,
    reason: string | null,
    now: Date,
    executor: DatabaseQuery = this.db,
  ): Promise<TripCost | null> {
    const rows = await executor.query<CostRow>(
      writeReturningAuthor(
        `UPDATE trip_costs
            SET voided_at = $4, voided_by = $2, void_reason = $3
          WHERE id = $1 AND voided_at IS NULL`,
        costColumns(),
      ),
      [id, by, reason, now],
    );
    return rows[0] ? toCost(rows[0]) : null;
  }

  // ------------------------------------------------- the driver's lifecycle ----

  /**
   * Records a figure a DRIVER typed.
   *
   * ★ SEPARATE FROM `create`, AND NOT AN OPTIONAL ARGUMENT ON IT. The two write
   * genuinely different rows: `create` writes a backoffice line that is final on
   * arrival, this one writes an editable line carrying the assignment and the
   * snapshots that make it auditable later. Folding them together would mean
   * seven parameters that are meaningless for one of the two callers, and a
   * `state` a caller could pass by mistake.
   *
   * ★ EVERY SNAPSHOT IS A PARAMETER. Reading the trip's vehicle inside this
   * INSERT would store whatever the trip says at the instant of the write, which
   * is not the value the service checked under its lock a moment earlier.
   */
  async declare(
    input: {
      tripId: string;
      driverAssignmentId: string;
      category: TripCostCategory;
      amount: string;
      note: string | null;
      vehicleId: string | null;
      vehicleOwnership: VehicleOwnership | null;
      clientRequestId: string | null;
      createdBy: string;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<TripCost> {
    const rows = await executor.query<CostRow>(
      writeReturningAuthor(
        `INSERT INTO trip_costs
           (trip_id, category, amount, note, created_by, state, source,
            driver_assignment_id, vehicle_id, vehicle_ownership, client_request_id)
         VALUES ($1, $2, $3::numeric, $4, $5, 'editable', 'driver_portal', $6, $7, $8, $9)`,
        costColumns(),
      ),
      [
        input.tripId,
        input.category,
        input.amount,
        input.note,
        input.createdBy,
        input.driverAssignmentId,
        input.vehicleId,
        input.vehicleOwnership,
        input.clientRequestId,
      ],
    );

    const row = rows[0];
    if (!row) throw new Error('INSERT INTO trip_costs returned no row');

    return toCost(row);
  }

  /**
   * The line a retried request already wrote, if there is one.
   *
   * Lets the service answer a duplicate with the ORIGINAL record: a driver on a
   * bad connection did nothing wrong, and refusing the retry would leave them
   * unsure whether the figure was stored at all.
   */
  async findByClientRequestId(
    tripId: string,
    clientRequestId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<TripCost | null> {
    const rows = await executor.query<CostRow>(
      `${costsWithAuthor} WHERE c.trip_id = $1 AND c.client_request_id = $2`,
      [tripId, clientRequestId],
    );
    return rows[0] ? toCost(rows[0]) : null;
  }

  /**
   * The lines THIS DRIVER declared on this trip.
   *
   * ★ TWO FILTERS, AND BOTH ARE THE POINT. `source = 'driver_portal'` keeps
   * backoffice cost lines out — those are internal accounting the contract
   * keeps from the driver — and `created_by` keeps a previous driver's
   * declarations out after a handover. Either one alone would leak.
   *
   * ⚠ THERE IS NO TOTAL METHOD BESIDE THIS ONE, ON PURPOSE. A trip's total
   * includes the price agreed with a hired carrier, which is precisely the
   * commercial figure a driver must never see. The driver's screen adds up
   * nothing; it lists what they typed.
   */
  async listDeclaredByDriver(
    tripId: string,
    driverUserId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<TripCost[]> {
    const rows = await executor.query<CostRow>(
      `${costsWithAuthor}
        WHERE c.trip_id = $1
          AND c.created_by = $2
          AND c.source = 'driver_portal'
          AND c.voided_at IS NULL
        ${ORDER}`,
      [tripId, driverUserId],
    );
    return rows.map(toCost);
  }

  /** One line, locked for the rest of the transaction. */
  async lockById(id: string, executor: DatabaseQuery): Promise<TripCost | null> {
    const rows = await executor.query<CostRow>(
      `${costsWithAuthor} WHERE c.id = $1 FOR UPDATE OF c`,
      [id],
    );
    return rows[0] ? toCost(rows[0]) : null;
  }

  /**
   * Corrects a figure that is still editable.
   *
   * ★ `WHERE state = 'editable'` IS NOT BELT AND BRACES. 0016's trigger refuses
   * the same thing, but a trigger raises an exception that reaches a client as a
   * 500; losing the race here simply returns no row, and the service turns that
   * into a conflict that says what happened. The trigger stays because it also
   * covers callers that never come through this method.
   */
  async editEditable(
    id: string,
    values: { category: TripCostCategory; amount: string; note: string | null },
    executor: DatabaseQuery,
  ): Promise<TripCost | null> {
    const rows = await executor.query<CostRow>(
      writeReturningAuthor(
        `UPDATE trip_costs
            SET category = $2, amount = $3::numeric, note = $4
          WHERE id = $1 AND state = 'editable' AND voided_at IS NULL`,
        costColumns(),
      ),
      [id, values.category, values.amount, values.note],
    );
    return rows[0] ? toCost(rows[0]) : null;
  }

  /**
   * Writes the edit log.
   *
   * One row per FIELD, because "something changed at 14:02" is not an answer.
   * Called in the same transaction as the edit itself — a log written separately
   * is a log that can be missing for the change somebody is asking about.
   */
  async recordEdits(
    costId: string,
    edits: readonly {
      field: 'category' | 'amount' | 'note';
      from: string | null;
      to: string | null;
    }[],
    editedBy: string,
    executor: DatabaseQuery,
  ): Promise<void> {
    for (const edit of edits) {
      await executor.query(
        `INSERT INTO trip_cost_edits (cost_id, field, old_value, new_value, edited_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [costId, edit.field, edit.from, edit.to, editedBy],
      );
    }
  }

  /** What was changed on one line, newest first. */
  async listEdits(costId: string, executor: DatabaseQuery = this.db): Promise<TripCostEdit[]> {
    const rows = await executor.query<{
      id: string;
      cost_id: string;
      field: 'category' | 'amount' | 'note';
      old_value: string | null;
      new_value: string | null;
      edited_by: string;
      edited_by_display_name: string;
      edited_at: Date;
    }>(
      `SELECT e.id, e.cost_id, e.field, e.old_value, e.new_value, e.edited_by, e.edited_at,
              u.display_name AS edited_by_display_name
         FROM trip_cost_edits e
         JOIN users u ON u.id = e.edited_by
        WHERE e.cost_id = $1
        ORDER BY e.edited_at DESC, e.id DESC`,
      [costId],
    );

    return rows.map((row) => ({
      id: row.id,
      costId: row.cost_id,
      field: row.field,
      oldValue: row.old_value,
      newValue: row.new_value,
      editedBy: row.edited_by,
      editedByUser: { id: row.edited_by, displayName: row.edited_by_display_name },
      editedAt: row.edited_at,
    }));
  }

  /**
   * Freezes a trip's declared lines while a completion request is outstanding.
   *
   * ★ THREE SEPARATE METHODS RATHER THAN ONE PARAMETERISED `setState`. They
   * differ in what happens to the lock columns — set, cleared, left alone — and
   * one method taking a flag for that is a method whose correctness depends on
   * every caller having read its documentation.
   *
   * Voided lines are skipped throughout: a withdrawn figure has no state worth
   * moving, and it is excluded from every total anyway.
   */
  async lockForTrip(tripId: string, by: string, at: Date, executor: DatabaseQuery): Promise<number> {
    const rows = await executor.query<{ id: string }>(
      `UPDATE trip_costs
          SET state = 'locked', locked_at = $3, locked_by = $2
        WHERE trip_id = $1 AND state = 'editable' AND voided_at IS NULL
        RETURNING id`,
      [tripId, by, at],
    );
    return rows.length;
  }

  /** Reopens a trip's lines after a rejection. Locking was always temporary. */
  async unlockForTrip(tripId: string, executor: DatabaseQuery): Promise<number> {
    const rows = await executor.query<{ id: string }>(
      `UPDATE trip_costs
          SET state = 'editable', locked_at = NULL, locked_by = NULL
        WHERE trip_id = $1 AND state = 'locked' AND voided_at IS NULL
        RETURNING id`,
      [tripId],
    );
    return rows.length;
  }

  /**
   * Makes a trip's figures permanent. This is what approval MEANS.
   *
   * `editable` is included alongside `locked` deliberately: a line declared
   * while the request was already pending was never locked, and leaving it
   * editable after the trip closed would be a figure that can still move after
   * the money stopped moving.
   *
   * The lock columns are left as they are — they record when the freeze
   * happened, and a line that went straight to immutable never had one.
   */
  async finalizeForTrip(tripId: string, executor: DatabaseQuery): Promise<number> {
    const rows = await executor.query<{ id: string }>(
      `UPDATE trip_costs
          SET state = 'immutable'
        WHERE trip_id = $1 AND state IN ('editable', 'locked') AND voided_at IS NULL
        RETURNING id`,
      [tripId],
    );
    return rows.length;
  }
}

@Injectable()
export class OutsourceHireRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    input: {
      tripId: string;
      carrierName: string;
      agreedAmount: string;
      amountIncludesVat: boolean;
      documentRef: string | null;
      note: string | null;
      createdBy: string;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<OutsourceHire> {
    const rows = await executor.query<HireRow>(
      writeReturningAuthor(
        `INSERT INTO trip_outsource_hires
           (trip_id, carrier_name, agreed_amount, amount_includes_vat, document_ref, note, created_by)
         VALUES ($1, $2, $3::numeric, $4, $5, $6, $7)`,
        hireColumns(),
      ),
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
    const rows = await executor.query<HireRow>(`${hiresWithAuthor} WHERE h.id = $1`, [id]);
    return rows[0] ? toHire(rows[0]) : null;
  }

  async listByTrip(tripId: string, executor: DatabaseQuery = this.db): Promise<OutsourceHire[]> {
    const rows = await executor.query<HireRow>(`${hiresWithAuthor} WHERE h.trip_id = $1 ${ORDER}`, [
      tripId,
    ]);
    return rows.map(toHire);
  }

  async listActiveByTrip(
    tripId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<OutsourceHire[]> {
    const rows = await executor.query<HireRow>(
      `${hiresWithAuthor} WHERE h.trip_id = $1 AND h.voided_at IS NULL ${ORDER}`,
      [tripId],
    );
    return rows.map(toHire);
  }

  async void(
    id: string,
    by: string,
    reason: string | null,
    now: Date,
    executor: DatabaseQuery = this.db,
  ): Promise<OutsourceHire | null> {
    const rows = await executor.query<HireRow>(
      writeReturningAuthor(
        `UPDATE trip_outsource_hires
            SET voided_at = $4, voided_by = $2, void_reason = $3
          WHERE id = $1 AND voided_at IS NULL`,
        hireColumns(),
      ),
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
