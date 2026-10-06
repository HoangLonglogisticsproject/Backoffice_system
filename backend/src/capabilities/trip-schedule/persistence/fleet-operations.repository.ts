import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import {
  dataIssuesOf,
  focusOf,
  fuelObligationOf,
  progressOf,
  turnStateOf,
  type FleetTurn,
  type FleetVehicleDay,
} from '../domain/fleet-operations';
import type { ExecutionEventType, VehicleOwnership } from '../domain/trip-execution';
import type { DailyFuelOutcome } from '../domain/vehicle-fuel';
import { liveVehicleCost } from './vehicle-cost.repository';

/**
 * ★ "THIS TURN IS WORK ON THAT DAY", SAID ONCE — for the fleet board, the
 * driver's own day, and the authority to record a fill on the lorry.
 *
 * A turn of a lorry (`a`, joined to its trip `t`) that is still the driver's
 * (`active` — approval never ends a turn, so a finished trip's turns stay
 * active), on a trip still on the board, counts on business day `day` when:
 *
 *   1. its trip is scheduled that day — whatever became of it since; or
 *   2. `day` is today and its trip is scheduled earlier but still open — the
 *      run past midnight, or the overdue one: still somebody's work today; or
 *   3. it has a live milestone whose moment falls on that day in
 *      Asia/Ho_Chi_Minh — it RAN that day (the run that finished after
 *      midnight, the trip started a day early).
 *
 * An ended turn is never work: a turn ends only before its first milestone
 * (`requireNotStarted`) or as a run recorded after the fact, whose fuel is a
 * trip expense ("Nhập chuyến cũ"). `day` and `today` are placeholders ('$2').
 */
export const turnWorksOn = (day: string, today: string): string => `
  a.state = 'active'
  AND a.vehicle_id IS NOT NULL
  AND t.archived_at IS NULL
  AND (
    t.scheduled_on = ${day}::date
    OR (${day}::date = ${today}::date AND t.scheduled_on < ${day}::date AND t.status <> 'finished')
    OR EXISTS (
      SELECT 1 FROM trip_execution_events e
       WHERE e.driver_assignment_id = a.id
         AND e.voided_at IS NULL
         AND (e.actual_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ${day}::date
    )
  )`;

/**
 * The live milestones of turn `a`, one row per turn. ★ `DISTINCT` names the
 * milestones REACHED — a milestone may be reported more than once by design
 * (`missingPrerequisite`) — it does not paper over a join: this is its own
 * aggregate over one turn's events, joined back one-to-one.
 */
export const REACHED_MILESTONES = `
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT e.event_type) AS reached
      FROM trip_execution_events e
     WHERE e.driver_assignment_id = a.id AND e.voided_at IS NULL
  ) r ON true`;

interface TurnJson {
  assignment_id: string;
  trip_id: string;
  scheduled_on: string;
  pickup_at: string | null;
  delivery_at: string | null;
  pickup_name: string | null;
  delivery_name: string | null;
  customer_name: string | null;
  driver_id: string;
  driver_name: string;
  closed: boolean;
  reached: ExecutionEventType[];
}

interface VehicleDayRow {
  id: string;
  plate: string;
  ownership: VehicleOwnership | null;
  status: 'active' | 'archived';
  daily_fuel_check_required: boolean;
  turns: TurnJson[];
  check_outcome: DailyFuelOutcome | null;
  check_by: string | null;
  check_by_name: string | null;
  check_at: Date | null;
  check_cost_id: string | null;
  check_amount: string | null;
  fills: number;
  fills_without_liters: number;
  fills_without_odometer: number;
  fuel_total: string | null;
}

const toTurn = (row: TurnJson): FleetTurn => {
  const progress = progressOf(row.reached);
  const closed = row.closed;
  return {
    assignmentId: row.assignment_id,
    tripId: row.trip_id,
    scheduledOn: row.scheduled_on,
    // JSON carries no `Date`; `pg` hands timestamps inside it back as text.
    scheduledPickupAt: row.pickup_at ? new Date(row.pickup_at) : null,
    scheduledDeliveryAt: row.delivery_at ? new Date(row.delivery_at) : null,
    pickupName: row.pickup_name,
    deliveryName: row.delivery_name,
    customerName: row.customer_name,
    driver: { id: row.driver_id, displayName: row.driver_name },
    closed,
    progress,
    state: turnStateOf({ closed, progress }),
  };
};

const toVehicleDay = (row: VehicleDayRow): FleetVehicleDay => {
  const turns = row.turns.map(toTurn);
  const { current, next } = focusOf(turns);
  const drivers = [...new Map(turns.map((turn) => [turn.driver.id, turn.driver])).values()];
  const obligation = fuelObligationOf({
    dailyFuelCheckRequired: row.daily_fuel_check_required,
    checkOutcome: row.check_outcome,
    hasWork: turns.length > 0,
  });
  return {
    vehicle: {
      id: row.id,
      plate: row.plate,
      ownership: row.ownership,
      dailyFuelCheckRequired: row.daily_fuel_check_required,
      archived: row.status === 'archived',
    },
    state: current?.state ?? 'unassigned',
    drivers,
    turns,
    currentAssignmentId: current?.assignmentId ?? null,
    nextAssignmentId: next?.assignmentId ?? null,
    fuel: {
      obligation,
      check:
        row.check_outcome && row.check_by && row.check_at
          ? {
              outcome: row.check_outcome,
              declaredBy: { id: row.check_by, displayName: row.check_by_name ?? '' },
              declaredAt: row.check_at,
              vehicleCostId: row.check_cost_id,
              amount: row.check_amount,
            }
          : null,
      fills: row.fills,
      totalAmount: row.fuel_total,
      issues: dataIssuesOf({
        obligation,
        fillsWithoutLiters: row.fills_without_liters,
        fillsWithoutOdometer: row.fills_without_odometer,
      }),
    },
  };
};

/**
 * The fleet's day, as SQL — and the one question the driver's fill route asks.
 *
 * ★ SET-BASED, AND EACH ONE-TO-MANY AGGREGATED ON ITS OWN. A lorry has many
 * turns, a turn many milestones, a lorry many fills. Joined flat, a lorry with
 * two turns would count every fill twice and a turn with three readings would
 * triple its trip — the multiplication a `DISTINCT` hides until two fills share
 * an amount. So the turns are folded per lorry (`tw`), the fills per lorry
 * (`f`), and each fold is joined back on the lorry's id — one row each. The
 * check and the fill it names are primary-key joins: at most one row.
 */
@Injectable()
export class FleetOperationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Is this turn the given driver's work on `today`? The authority behind a
   * fill recorded after the day's check. Asked under the caller's trip lock,
   * so no milestone can be withdrawn and no turn ended before it commits.
   */
  async worksToday(
    assignmentId: string,
    driverUserId: string,
    today: string,
    executor: DatabaseQuery,
  ): Promise<boolean> {
    const rows = await executor.query<{ one: number }>(
      `SELECT 1 AS one
         FROM trip_driver_assignments a
         JOIN trip_schedules t ON t.id = a.trip_id
        WHERE a.id = $1 AND a.driver_user_id = $2 AND ${turnWorksOn('$3', '$3')}`,
      [assignmentId, driverUserId, today],
    );
    return rows.length > 0;
  }

  /**
   * Every lorry's day — the lorries on the books, plus any taken off them that
   * still worked or were fuelled that day — in ONE statement.
   *
   * `withMoney` decides whether the amounts are SELECTED at all: without it the
   * statement returns `NULL` in their place, so no mapper can leak one.
   */
  async days(input: { day: string; today: string; withMoney: boolean }): Promise<FleetVehicleDay[]> {
    const rows = await this.db.query<VehicleDayRow>(
      `WITH turns AS (
         SELECT a.vehicle_id,
                json_build_object(
                  'assignment_id', a.id,
                  'trip_id', t.id,
                  'scheduled_on', t.scheduled_on::text,
                  'pickup_at', t.pickup_at,
                  'delivery_at', t.delivery_at,
                  'pickup_name', COALESCE(pl.name, t.pickup_address),
                  'delivery_name', COALESCE(dl.name, t.delivery_address),
                  'customer_name', c.name,
                  'driver_id', u.id,
                  'driver_name', u.display_name,
                  'closed', t.status = 'finished',
                  'reached', COALESCE(r.reached, '{}')
                ) AS turn,
                t.scheduled_on, t.pickup_at, a.assigned_at, a.id
           FROM trip_driver_assignments a
           JOIN trip_schedules t ON t.id = a.trip_id
           JOIN users u ON u.id = a.driver_user_id
           LEFT JOIN trip_customers c ON c.id = t.customer_id
           LEFT JOIN trip_locations pl ON pl.id = t.pickup_location_id
           LEFT JOIN trip_locations dl ON dl.id = t.delivery_location_id
           ${REACHED_MILESTONES}
          WHERE ${turnWorksOn('$1', '$2')}
       ), tw AS (
         SELECT vehicle_id,
                json_agg(turn ORDER BY scheduled_on, pickup_at NULLS LAST, assigned_at, id) AS turns
           FROM turns
          GROUP BY vehicle_id
       ), f AS (
         SELECT c.vehicle_id,
                COUNT(*)::int AS fills,
                (COUNT(*) FILTER (WHERE c.liters IS NULL))::int AS fills_without_liters,
                (COUNT(*) FILTER (WHERE c.odometer_km IS NULL))::int AS fills_without_odometer,
                SUM(c.amount) AS total
           FROM vehicle_costs c
          WHERE c.business_date = $1::date
            AND c.category = 'fuel'
            AND ${liveVehicleCost('c')}
          GROUP BY c.vehicle_id
       )
       SELECT v.id, v.plate, v.ownership, v.status, v.daily_fuel_check_required,
              COALESCE(tw.turns, '[]'::json) AS turns,
              chk.outcome AS check_outcome, chk.created_by AS check_by, cu.display_name AS check_by_name,
              chk.created_at AS check_at, chk.vehicle_cost_id AS check_cost_id,
              CASE WHEN $3::boolean THEN linked.amount::text END AS check_amount,
              COALESCE(f.fills, 0) AS fills,
              COALESCE(f.fills_without_liters, 0) AS fills_without_liters,
              COALESCE(f.fills_without_odometer, 0) AS fills_without_odometer,
              CASE WHEN $3::boolean THEN COALESCE(f.total, 0)::numeric(14,2)::text END AS fuel_total
         FROM trip_vehicles v
         LEFT JOIN tw ON tw.vehicle_id = v.id
         LEFT JOIN f ON f.vehicle_id = v.id
         LEFT JOIN vehicle_daily_fuel_checks chk ON chk.vehicle_id = v.id AND chk.business_date = $1::date
         LEFT JOIN users cu ON cu.id = chk.created_by
         LEFT JOIN vehicle_costs linked ON linked.id = chk.vehicle_cost_id AND ${liveVehicleCost('linked')}
        WHERE (v.status = 'active' OR tw.vehicle_id IS NOT NULL OR f.vehicle_id IS NOT NULL OR chk.vehicle_id IS NOT NULL)
        ORDER BY v.plate_key, v.id`,
      [input.day, input.today, input.withMoney],
    );
    return rows.map(toVehicleDay);
  }
}
