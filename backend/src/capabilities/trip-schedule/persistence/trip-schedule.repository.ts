import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import {
  TripAssignmentFilter,
  TripSchedule,
  TripScheduleWithRefs,
  TripStatus,
} from '../domain/trip-schedule';

/**
 * SQL for the dispatch board. Opens no transaction; decides nothing.
 */

/** The columns a caller may set. Shared by create and by the full-row update. */
export interface TripScheduleValues {
  scheduledOn: string;
  vehicleId: string | null;
  customerId: string | null;
  cargoInfo: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  pickupContact: string | null;
  deliveryContact: string | null;
  pickupAt: Date | null;
  deliveryAt: Date | null;
  note: string | null;
  status: TripStatus;
  /** Each pair both-or-neither; the service has already checked. */
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
}

/** An inclusive range of board days, as `YYYY-MM-DD`. */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * What "is somebody driving this" is, in SQL — written twice, because the two
 * readers below stand in different places.
 *
 * ★ NEITHER IS BUILT FROM INPUT. Both are looked up from a TOTAL map keyed by a
 * union the DTO has already narrowed, so the only three strings that can ever
 * reach a statement here are the three written here. A predicate assembled from
 * a query parameter is the shape this file must never grow.
 *
 * The paged read already LEFT JOINs the active assignment — it has to, to name
 * the driver — so it tests the joined column and pays for nothing extra. The
 * count joins nothing, and adding the join there would make `COUNT(*)` depend on
 * the join's cardinality, so it asks `EXISTS` instead — which
 * `uq_trip_active_driver_assignment` answers from the index.
 */
const JOINED_ASSIGNMENT_PREDICATE: Record<TripAssignmentFilter, string> = {
  all: '',
  unassigned: 'AND da.driver_user_id IS NULL',
  assigned: 'AND da.driver_user_id IS NOT NULL',
};

const ACTIVE_ASSIGNMENT_EXISTS = `SELECT 1
              FROM trip_driver_assignments da
             WHERE da.trip_id = t.id AND da.state = 'active'`;

const COUNTED_ASSIGNMENT_PREDICATE: Record<TripAssignmentFilter, string> = {
  all: '',
  unassigned: `AND NOT EXISTS (${ACTIVE_ASSIGNMENT_EXISTS})`,
  assigned: `AND EXISTS (${ACTIVE_ASSIGNMENT_EXISTS})`,
};

interface TripRow {
  id: string;
  /**
   * ★ TEXT, NOT A `Date`, AND EVERY QUERY BELOW CASTS IT.
   *
   * `scheduled_on` is a `DATE`. `pg` parses that type into a JavaScript `Date`
   * at LOCAL midnight, so a server running in UTC turns `2026-08-04` into an
   * instant that renders as `2026-08-03` the moment anyone in Hồ Chí Minh looks
   * at it — every row, silently, one day early. Casting to text in SQL means
   * the value never becomes a `Date` and therefore never moves.
   */
  scheduled_on: string;
  vehicle_id: string | null;
  customer_id: string | null;
  cargo_info: string | null;
  pickup_address: string | null;
  delivery_address: string | null;
  pickup_contact: string | null;
  delivery_contact: string | null;
  pickup_at: Date | null;
  delivery_at: Date | null;
  note: string | null;
  status: TripStatus;
  /** `DOUBLE PRECISION`, which `pg` hands back as a number — unlike NUMERIC. */
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

type TripJoinedRow = TripRow & {
  vehicle_plate: string | null;
  customer_name: string | null;
  created_by_display_name: string;
  /** The ACTIVE assignment's driver, or nulls. At most one exists — 0014. */
  driver_user_id: string | null;
  driver_display_name: string | null;
  /**
   * `COUNT(*) OVER()`. PostgreSQL types this `bigint`, and `pg` hands `bigint`
   * back as a STRING to avoid losing precision past 2^53. `Number()` is applied
   * explicitly on the way out — relying on `+` or on implicit coercion here is
   * how `"137"` reaches a client as a string and `totalPages` becomes `NaN`.
   */
  total_count: string;
};

/**
 * Every column, named once.
 *
 * `SELECT *` is impossible on the joined query: `users.id` would clobber the
 * trip's own `id` and every row would come back identified as its author. The
 * list is written here once and rendered with or without the table alias,
 * because two hand-maintained copies of sixteen column names drift the first
 * time somebody adds a column to only one of them.
 */
const TRIP_COLUMN_NAMES = [
  'id',
  'vehicle_id',
  'customer_id',
  'cargo_info',
  'pickup_address',
  'delivery_address',
  'pickup_contact',
  'delivery_contact',
  'pickup_at',
  'delivery_at',
  'note',
  'status',
  'pickup_latitude',
  'pickup_longitude',
  'delivery_latitude',
  'delivery_longitude',
  'created_by',
  'created_at',
  'updated_at',
] as const;

/** `alias` is `'t.'` inside the joined read, `''` in a `RETURNING` clause. */
const tripColumns = (alias: 't.' | ''): string =>
  [
    // Cast, always. See `TripRow.scheduled_on` for what a `Date` does to it.
    `${alias}scheduled_on::text AS scheduled_on`,
    ...TRIP_COLUMN_NAMES.map((column) => `${alias}${column}`),
  ].join(', ');

const RETURNING_TRIP = `RETURNING ${tripColumns('')}`;

/**
 * The read projection: the row, the plate, the customer name, the author.
 *
 * Two LEFT JOINs and one INNER. The joins to the catalogues are LEFT because a
 * trip legitimately has no truck yet (the workbook's `ĐIỀN SAU` rows) — an
 * INNER JOIN there would make those rows vanish from the board, which is the
 * opposite of what dispatch needs from them. `created_by` is NOT NULL with a
 * foreign key, so its join is INNER and cannot drop a row.
 *
 * `extraSelect` exists for exactly one caller: the list, which adds
 * `COUNT(*) OVER()` so the count comes from the same snapshot as the rows.
 */
const tripsWithRefs = (extraSelect = ''): string => `
  SELECT ${extraSelect}${tripColumns('t.')},
         v.plate AS vehicle_plate,
         c.name  AS customer_name,
         au.display_name AS created_by_display_name,
         da.driver_user_id,
         du.display_name AS driver_display_name
    FROM trip_schedules t
    LEFT JOIN trip_vehicles  v  ON v.id  = t.vehicle_id
    LEFT JOIN trip_customers c  ON c.id  = t.customer_id
    JOIN      users          au ON au.id = t.created_by
    LEFT JOIN trip_driver_assignments da ON da.trip_id = t.id AND da.state = 'active'
    LEFT JOIN users          du ON du.id = da.driver_user_id`;

const toTrip = (row: TripRow): TripSchedule => ({
  id: row.id,
  scheduledOn: row.scheduled_on,
  vehicleId: row.vehicle_id,
  customerId: row.customer_id,
  cargoInfo: row.cargo_info,
  pickupAddress: row.pickup_address,
  deliveryAddress: row.delivery_address,
  pickupContact: row.pickup_contact,
  deliveryContact: row.delivery_contact,
  pickupAt: row.pickup_at,
  deliveryAt: row.delivery_at,
  note: row.note,
  status: row.status,
  pickupLatitude: row.pickup_latitude,
  pickupLongitude: row.pickup_longitude,
  deliveryLatitude: row.delivery_latitude,
  deliveryLongitude: row.delivery_longitude,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTripWithRefs = (row: TripJoinedRow): TripScheduleWithRefs => ({
  ...toTrip(row),
  // The plate is non-null exactly when the id is — that is what the LEFT JOIN
  // on a foreign key guarantees — but the pairing is written out rather than
  // asserted, so a future outer join cannot quietly produce `{ id: null }`.
  vehicle: row.vehicle_id && row.vehicle_plate ? { id: row.vehicle_id, plate: row.vehicle_plate } : null,
  customer:
    row.customer_id && row.customer_name ? { id: row.customer_id, name: row.customer_name } : null,
  createdByUser: { id: row.created_by, displayName: row.created_by_display_name },
  driver:
    row.driver_user_id && row.driver_display_name
      ? { id: row.driver_user_id, displayName: row.driver_display_name }
      : null,
});

/** The values of a full row write, in the order every statement below binds them. */
const valueParams = (values: TripScheduleValues): unknown[] => [
  values.scheduledOn,
  values.vehicleId,
  values.customerId,
  values.cargoInfo,
  values.pickupAddress,
  values.deliveryAddress,
  values.pickupContact,
  values.deliveryContact,
  values.pickupAt,
  values.deliveryAt,
  values.note,
  values.status,
  values.pickupLatitude,
  values.pickupLongitude,
  values.deliveryLatitude,
  values.deliveryLongitude,
];

@Injectable()
export class TripScheduleRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * One page of the board, newest day first, plus how many rows the range holds.
   *
   * ★ ONE STATEMENT FOR BOTH, via `COUNT(*) OVER()`. Counting in a second query
   * would count a different instant: a row inserted between the two would
   * produce a page that does not fit its own total, and the client would page
   * to a `totalPages` that no longer exists. The window function counts the
   * same snapshot the rows came from.
   *
   * Offset rather than keyset, which is the exception in this codebase — see
   * `common/pagination/offset-page` and ADR-0003. It is defensible ONLY because
   * the range is mandatory and capped, so the offset is never deep and the
   * count never scans the table. `idx_trip_schedule_page` supplies the ordering
   * in the direction written here, tiebreaker included.
   */
  async listPage(
    range: DateRange,
    assignment: TripAssignmentFilter,
    limit: number,
    offset: number,
    executor: DatabaseQuery = this.db,
  ): Promise<{ items: TripScheduleWithRefs[]; total: number }> {
    const rows = await executor.query<TripJoinedRow>(
      `${tripsWithRefs('COUNT(*) OVER() AS total_count, ')}
         WHERE t.archived_at IS NULL
           AND t.scheduled_on >= $1::date
           AND t.scheduled_on <= $2::date
           ${JOINED_ASSIGNMENT_PREDICATE[assignment]}
         ORDER BY t.scheduled_on DESC, t.id DESC
         LIMIT $3 OFFSET $4`,
      [range.from, range.to, limit, offset],
    );

    // An empty page carries no row and therefore no count. That is not the same
    // as "zero rows in the range" — it is also what page 99 of a 3-page list
    // looks like — so the caller re-reads the total separately in that case.
    const first = rows[0];

    return {
      items: rows.map(toTripWithRefs),
      total: first ? Number(first.total_count) : 0,
    };
  }

  /**
   * How many rows the range holds, for the pages that came back empty.
   *
   * ⚠ TAKES THE SAME FILTER AS `listPage`, AND MUST KEEP TAKING IT. This number
   * is what a client with a stale page number recovers from; counting the whole
   * range while the page counted only the uncrewed rows would send a dispatcher
   * to a "page 3 of 7" the filtered list does not have.
   */
  async countInRange(
    range: DateRange,
    assignment: TripAssignmentFilter,
    executor: DatabaseQuery = this.db,
  ): Promise<number> {
    const rows = await executor.query<{ total: string }>(
      `SELECT COUNT(*) AS total
         FROM trip_schedules t
        WHERE t.archived_at IS NULL
          AND t.scheduled_on >= $1::date
          AND t.scheduled_on <= $2::date
          ${COUNTED_ASSIGNMENT_PREDICATE[assignment]}`,
      [range.from, range.to],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Does this trip exist at all — archived or not?
   *
   * ★ DELIBERATELY DOES NOT FILTER `archived_at`, unlike every other read here.
   * Its one caller is the cost service, and money is independent of where the
   * trip sits on the board: a figure can arrive weeks after dispatch archived
   * the row, and refusing it would lose a real expense to a lifecycle it has
   * nothing to do with. `findById` stays archive-aware because a board reader
   * genuinely must not see archived rows.
   */
  async exists(id: string, executor: DatabaseQuery = this.db): Promise<boolean> {
    const rows = await executor.query<{ one: number }>(
      `SELECT 1 AS one FROM trip_schedules WHERE id = $1`,
      [id],
    );
    return rows.length > 0;
  }

  async findById(
    id: string,
    executor: DatabaseQuery = this.db,
  ): Promise<TripScheduleWithRefs | null> {
    const rows = await executor.query<TripJoinedRow>(
      `${tripsWithRefs()} WHERE t.id = $1 AND t.archived_at IS NULL`,
      [id],
    );
    return rows[0] ? toTripWithRefs(rows[0]) : null;
  }

  /**
   * Locks a live row and returns it.
   *
   * No join: `FOR UPDATE` against the nullable side of a LEFT JOIN is not
   * something PostgreSQL will lock, and this is only ever used to read the
   * current values before overwriting them.
   */
  async lockActive(id: string, executor: DatabaseQuery): Promise<TripSchedule | null> {
    const rows = await executor.query<TripRow>(
      `SELECT ${tripColumns('t.')}
         FROM trip_schedules t
        WHERE t.id = $1 AND t.archived_at IS NULL
          FOR UPDATE`,
      [id],
    );
    return rows[0] ? toTrip(rows[0]) : null;
  }

  async create(
    input: TripScheduleValues & { createdBy: string },
    executor: DatabaseQuery = this.db,
  ): Promise<TripSchedule> {
    const rows = await executor.query<TripRow>(
      `INSERT INTO trip_schedules
         (scheduled_on, vehicle_id, customer_id, cargo_info,
          pickup_address, delivery_address, pickup_contact, delivery_contact,
          pickup_at, delivery_at, note, status,
          pickup_latitude, pickup_longitude, delivery_latitude, delivery_longitude,
          created_by)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17)
       ${RETURNING_TRIP}`,
      [...valueParams(input), input.createdBy],
    );

    const row = rows[0];
    if (!row) throw new Error('INSERT INTO trip_schedules returned no row');

    return toTrip(row);
  }

  /**
   * Overwrites every settable column of a live row.
   *
   * A whole row rather than a computed `SET` list: building the assignment list
   * from whichever keys a caller sent means assembling SQL from input, and the
   * saving is one write of columns that are already in memory. The service
   * merges the patch onto the locked row and hands the result here, so "not
   * sent" and "sent as null" are decided in one place that can be read.
   */
  async replace(
    id: string,
    values: TripScheduleValues,
    executor: DatabaseQuery,
  ): Promise<TripSchedule | null> {
    const rows = await executor.query<TripRow>(
      `UPDATE trip_schedules
          SET scheduled_on = $2::date, vehicle_id = $3, customer_id = $4, cargo_info = $5,
              pickup_address = $6, delivery_address = $7,
              pickup_contact = $8, delivery_contact = $9,
              pickup_at = $10, delivery_at = $11, note = $12, status = $13,
              pickup_latitude = $14, pickup_longitude = $15,
              delivery_latitude = $16, delivery_longitude = $17
        WHERE id = $1 AND archived_at IS NULL
        ${RETURNING_TRIP}`,
      [id, ...valueParams(values)],
    );
    return rows[0] ? toTrip(rows[0]) : null;
  }

  /**
   * Moves a row along the board.
   *
   * Its own statement rather than a `replace` with one field changed: this is
   * the write dispatch performs many times a day, it touches no other column,
   * and keeping it separate means the permission guarding it can be relaxed
   * later without disturbing the general edit path.
   */
  async updateStatus(
    id: string,
    status: TripStatus,
    executor: DatabaseQuery = this.db,
  ): Promise<TripSchedule | null> {
    const rows = await executor.query<TripRow>(
      `UPDATE trip_schedules
          SET status = $2
        WHERE id = $1 AND archived_at IS NULL
        ${RETURNING_TRIP}`,
      [id, status],
    );
    return rows[0] ? toTrip(rows[0]) : null;
  }

  /**
   * Stamps who ended a trip, and when.
   *
   * ★ SEPARATE FROM `updateStatus`, AND ALWAYS IN THE SAME TRANSACTION AS IT.
   * `status = 'done'` is the board's word; these two columns are the audit of
   * the decision behind it. Folding them into one statement would mean a CASE
   * expression on every ordinary board move for the sake of the one move that
   * closes a trip.
   *
   * `WHERE closed_at IS NULL` makes a second call a no-op rather than a quiet
   * rewrite of who closed it — the same shape `archive` uses below.
   */
  async markClosed(
    id: string,
    closedBy: string,
    now: Date,
    executor: DatabaseQuery,
  ): Promise<void> {
    await executor.query(
      `UPDATE trip_schedules
          SET closed_at = $3, closed_by = $2
        WHERE id = $1 AND closed_at IS NULL`,
      [id, closedBy, now],
    );
  }

  /**
   * Takes a row off the board without destroying it.
   *
   * `WHERE archived_at IS NULL` makes the statement idempotent in the useful
   * direction: archiving twice affects no row and the service answers 404,
   * rather than quietly rewriting who archived it and when.
   */
  async archive(
    id: string,
    archivedBy: string,
    now: Date,
    executor: DatabaseQuery = this.db,
  ): Promise<TripSchedule | null> {
    const rows = await executor.query<TripRow>(
      `UPDATE trip_schedules
          SET archived_at = $3, archived_by = $2
        WHERE id = $1 AND archived_at IS NULL
        ${RETURNING_TRIP}`,
      [id, archivedBy, now],
    );
    return rows[0] ? toTrip(rows[0]) : null;
  }
}
