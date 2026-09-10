import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import {
  TripAssignmentFilter,
  TripAssignmentRef,
  TripSchedule,
  TripScheduleWithRefs,
  TripStatus,
} from '../domain/trip-schedule';

/**
 * SQL for the dispatch board. Opens no transaction; decides nothing.
 */

/**
 * The columns a caller may set. Shared by create and by the full-row update.
 *
 * ★ NO `vehicleId`. The lorry is dispatched through `trip_driver_assignments`
 * (ADR-0004); `trip_schedules.vehicle_id` is legacy and has no writer left.
 */
export interface TripScheduleValues {
  scheduledOn: string;
  customerId: string | null;
  cargoInfo: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  pickupContact: string | null;
  deliveryContact: string | null;
  pickupAt: Date | null;
  deliveryAt: Date | null;
  /** What the customer is charged, as a decimal string. `null` while unpriced. */
  sellPrice: string | null;
  /** What the carrier is paid for the same run. `null` on our own lorries. */
  purchasePrice: string | null;
  note: string | null;
  status: TripStatus;
  /** Each pair both-or-neither; the service has already checked. */
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  /** Provenance of the two snapshots. `null` for a hand-typed end. */
  pickupLocationId: string | null;
  deliveryLocationId: string | null;
}

/** An inclusive range of board days, as `YYYY-MM-DD`. */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * What "is somebody on this" is, in SQL.
 *
 * ★ NOT BUILT FROM INPUT. Looked up from a TOTAL map keyed by a union the DTO
 * has already narrowed, so the only three strings that can ever reach a
 * statement here are the three written here. A predicate assembled from a
 * query parameter is the shape this file must never grow.
 *
 * ★ `EXISTS`, NEVER A JOIN. A trip may carry several active assignments
 * (ADR-0004); a join would multiply the trip's row by that number, and both
 * `COUNT(*) OVER()` and `LIMIT/OFFSET` would then count and page over
 * assignments while claiming to count trips. `EXISTS` is answered from
 * `idx_trip_driver_assignment_trip` and returns each trip once.
 */
const ACTIVE_ASSIGNMENT_EXISTS = `SELECT 1
              FROM trip_driver_assignments da
             WHERE da.trip_id = t.id AND da.state = 'active'`;

const ASSIGNMENT_PREDICATE: Record<TripAssignmentFilter, string> = {
  all: '',
  unassigned: `AND NOT EXISTS (${ACTIVE_ASSIGNMENT_EXISTS})`,
  assigned: `AND EXISTS (${ACTIVE_ASSIGNMENT_EXISTS})`,
};

/** One element of the `assignments` JSON array the read below aggregates. */
interface AssignmentJson {
  id: string;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  driver_user_id: string;
  driver_display_name: string;
  /** JSON carries no `Date`; `pg` hands the timestamp back as ISO text. */
  assigned_at: string;
  /** One live execution event exists — the turn can no longer be swapped or ended. */
  started: boolean;
}

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
  /**
   * ★ `NUMERIC`, WHICH `pg` HANDS BACK AS A STRING — unlike the four coordinate
   * columns below, which are `DOUBLE PRECISION` and do arrive as numbers. That
   * asymmetry is the point: reading either of these as a number would put the
   * figure through the float the column type exists to avoid.
   *
   * ⚠ SELECTED FOR EVERY CALLER, INCLUDING ONES WHO MAY NOT SEE THEM. Who is
   * allowed to read a price is not a decision this file takes — `redactPrices`
   * blanks them on the way out of the API. Do not add a permission-shaped
   * branch to the SQL below; a statement that varies by caller is a statement
   * nobody can read off the page.
   */
  sell_price: string | null;
  purchase_price: string | null;
  note: string | null;
  status: TripStatus;
  /** `DOUBLE PRECISION`, which `pg` hands back as a number — unlike NUMERIC. */
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  pickup_location_id: string | null;
  delivery_location_id: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

type TripJoinedRow = TripRow & {
  customer_name: string | null;
  created_by_display_name: string;
  /** Every ACTIVE assignment, oldest first, as one JSON array — see `tripsWithRefs`. */
  assignments: AssignmentJson[];
  /** The master places behind the snapshots, by name. */
  pickup_location_name: string | null;
  delivery_location_name: string | null;
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
  'sell_price',
  'purchase_price',
  'note',
  'status',
  'pickup_latitude',
  'pickup_longitude',
  'delivery_latitude',
  'delivery_longitude',
  'pickup_location_id',
  'delivery_location_id',
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
 * The read projection: the row, the customer name, the author, the crew.
 *
 * ★ THE CREW IS AGGREGATED, NOT JOINED. A trip carries 0..N active assignments
 * (ADR-0004). Joining them would return the trip once per assignment, and the
 * list's `COUNT(*) OVER()` and `LIMIT/OFFSET` would then count and page over
 * assignments while claiming to count trips. The LATERAL sub-select folds them
 * into one JSON array per trip, so every trip is exactly one row whatever its
 * crew size. `COALESCE(..., '[]')` because `json_agg` over no rows is NULL.
 *
 * The catalogue joins are LEFT because a trip legitimately has no customer
 * yet, and the lorry inside the crew is LEFT because a pre-0027 assignment
 * may still name none. `created_by` is NOT NULL with a foreign key, so its
 * join is INNER and cannot drop a row.
 *
 * `extraSelect` exists for exactly one caller: the list, which adds
 * `COUNT(*) OVER()` so the count comes from the same snapshot as the rows.
 */
const tripsWithRefs = (extraSelect = ''): string => `
  SELECT ${extraSelect}${tripColumns('t.')},
         c.name  AS customer_name,
         au.display_name AS created_by_display_name,
         COALESCE(crew.assignments, '[]'::json) AS assignments,
         pl.name AS pickup_location_name,
         dl.name AS delivery_location_name
    FROM trip_schedules t
    LEFT JOIN trip_customers c  ON c.id  = t.customer_id
    JOIN      users          au ON au.id = t.created_by
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'id',                  a.id,
               'vehicle_id',          a.vehicle_id,
               'vehicle_plate',       v.plate,
               'driver_user_id',      a.driver_user_id,
               'driver_display_name', du.display_name,
               'assigned_at',         a.assigned_at,
               'started',             EXISTS (SELECT 1 FROM trip_execution_events e
                                               WHERE e.driver_assignment_id = a.id
                                                 AND e.voided_at IS NULL)
             ) ORDER BY a.assigned_at ASC, a.id ASC) AS assignments
        FROM trip_driver_assignments a
        JOIN users du ON du.id = a.driver_user_id
        LEFT JOIN trip_vehicles v ON v.id = a.vehicle_id
       WHERE a.trip_id = t.id AND a.state = 'active'
    ) crew ON true
    LEFT JOIN trip_locations pl ON pl.id = t.pickup_location_id
    LEFT JOIN trip_locations dl ON dl.id = t.delivery_location_id`;

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
  sellPrice: row.sell_price,
  purchasePrice: row.purchase_price,
  note: row.note,
  status: row.status,
  pickupLatitude: row.pickup_latitude,
  pickupLongitude: row.pickup_longitude,
  deliveryLatitude: row.delivery_latitude,
  deliveryLongitude: row.delivery_longitude,
  pickupLocationId: row.pickup_location_id,
  deliveryLocationId: row.delivery_location_id,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAssignmentRef = (json: AssignmentJson): TripAssignmentRef => ({
  id: json.id,
  // The pairing is written out rather than asserted, so an outer join can
  // never quietly produce `{ id: null }`.
  vehicle:
    json.vehicle_id && json.vehicle_plate ? { id: json.vehicle_id, plate: json.vehicle_plate } : null,
  driver: { id: json.driver_user_id, displayName: json.driver_display_name },
  assignedAt: new Date(json.assigned_at),
  started: json.started,
});

const toTripWithRefs = (row: TripJoinedRow): TripScheduleWithRefs => ({
  ...toTrip(row),
  customer:
    row.customer_id && row.customer_name ? { id: row.customer_id, name: row.customer_name } : null,
  createdByUser: { id: row.created_by, displayName: row.created_by_display_name },
  assignments: row.assignments.map(toAssignmentRef),
  pickupLocation:
    row.pickup_location_id && row.pickup_location_name
      ? { id: row.pickup_location_id, name: row.pickup_location_name }
      : null,
  deliveryLocation:
    row.delivery_location_id && row.delivery_location_name
      ? { id: row.delivery_location_id, name: row.delivery_location_name }
      : null,
});

/**
 * The values of a full row write, in the order every statement below binds them.
 *
 * `vehicle_id` is absent on purpose: nothing writes it since 0027. The INSERT
 * leaves it at its NULL default and the UPDATE leaves it as it was.
 */
const valueParams = (values: TripScheduleValues): unknown[] => [
  values.scheduledOn,
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
  values.pickupLocationId,
  values.deliveryLocationId,
  // Appended rather than slotted in beside the other columns: every bind index
  // below is positional, so a value inserted in the middle silently renumbers
  // eighteen of them. New columns go on the end, in the order they were added.
  values.sellPrice,
  values.purchasePrice,
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
           ${ASSIGNMENT_PREDICATE[assignment]}
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
          ${ASSIGNMENT_PREDICATE[assignment]}`,
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
         (scheduled_on, customer_id, cargo_info,
          pickup_address, delivery_address, pickup_contact, delivery_contact,
          pickup_at, delivery_at, note, status,
          pickup_latitude, pickup_longitude, delivery_latitude, delivery_longitude,
          pickup_location_id, delivery_location_id, sell_price, purchase_price,
          created_by)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
          SET scheduled_on = $2::date, customer_id = $3, cargo_info = $4,
              pickup_address = $5, delivery_address = $6,
              pickup_contact = $7, delivery_contact = $8,
              pickup_at = $9, delivery_at = $10, note = $11, status = $12,
              pickup_latitude = $13, pickup_longitude = $14,
              delivery_latitude = $15, delivery_longitude = $16,
              pickup_location_id = $17, delivery_location_id = $18,
              sell_price = $19, purchase_price = $20
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
   * `status = 'finished'` is the board's word; these two columns are the audit of
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
