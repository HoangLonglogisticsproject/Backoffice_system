import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import {
  TEST_URL,
  assertLooksLikeATestDatabase,
  describeIntegration,
  openTestSchema,
} from '../helpers/integration-database';

/**
 * The multi-vehicle migrations, 0027 to 0029, against a REAL PostgreSQL — and
 * against the data they have to carry.
 *
 * ★ THE POINT OF THIS FILE IS WHAT HAPPENS TO ROWS WRITTEN BEFORE 0027. Every
 * case in `0029` is a claim about evidence: an active turn takes the trip's
 * lorry, an ended turn takes the lorry its own events or lines name, and a turn
 * with no certain evidence stays NULL rather than being guessed. Those claims
 * can only be tested by writing the rows under the OLD schema, applying the
 * three files, and reading what came out — which is what `applyThrough` is for.
 *
 * The second half proves what the new schema refuses and allows from here on:
 * a lorry twice on one trip, a driver twice on one trip, an active turn with no
 * lorry, and that the files can run again without changing anything.
 */
const SCHEMA = 'dispatch_assignment_itest';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

describeIntegration('Multi-vehicle migrations against real PostgreSQL', () => {
  jest.setTimeout(60_000);

  let pool: Pool;

  const failureOf = async (sql: string, params: unknown[] = []): Promise<string | null> => {
    try {
      await pool.query(sql, params);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  };

  const one = async <T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> =>
    (await pool.query<T>(sql, params)).rows[0]!;

  let appliedCount = 0;
  const applyThrough = async (last: string): Promise<void> => {
    const directory = join(__dirname, '..', '..', 'migrations');
    const wanted = (await readdir(directory))
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .filter((file) => file <= last);

    for (const file of wanted.slice(appliedCount)) {
      await pool.query(await readFile(join(directory, file), 'utf8'));
    }
    appliedCount = wanted.length;
  };

  /** Re-runs ONE file, as a second deploy of the same release would. */
  const rerun = async (file: string): Promise<void> => {
    await pool.query(await readFile(join(__dirname, '..', '..', 'migrations', file), 'utf8'));
  };

  // The legacy fixtures, written under the 1:1 schema.
  let operator: string;
  let driverA: string;
  let driverB: string;
  let lorry1: string;
  let lorry2: string;
  let lorry3: string;

  /** Case A: an active turn on a trip that names a lorry. */
  let caseA: { trip: string; assignment: string };
  /** Case B: an active turn on a trip that names none. */
  let caseB: { trip: string; assignment: string };
  /** Case C: an ended turn whose events all name lorry 2 — while the trip now says lorry 3. */
  let caseC: { trip: string; assignment: string };
  /** Case D: an ended turn with no events, whose one cost line names lorry 1. */
  let caseD: { trip: string; assignment: string };
  /** Case E: an ended turn whose events name TWO different lorries. */
  let caseE: { trip: string; assignment: string };
  /** Case F: a trip with a legacy lorry and no assignment at all. */
  let caseF: { trip: string };
  /** Completion rows under the old trip-scoped numbering, to be carried across. */
  let completed: { trip: string; assignment: string };

  const user = async (name: string, accountType = 'employee'): Promise<string> =>
    (await one<{ id: string }>(
      `INSERT INTO users (display_name, account_type) VALUES ($1, $2) RETURNING id`,
      [name, accountType],
    )).id;

  const lorry = async (plate: string): Promise<string> =>
    (await one<{ id: string }>(
      `INSERT INTO trip_vehicles (plate, created_by) VALUES ($1, $2) RETURNING id`,
      [plate, operator],
    )).id;

  const trip = async (vehicleId: string | null): Promise<string> =>
    (await one<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, status, vehicle_id, created_by)
       VALUES ('2026-08-04', 'pending', $1, $2) RETURNING id`,
      [vehicleId, operator],
    )).id;

  const turn = async (tripId: string, driver: string, ended = false): Promise<string> =>
    (await one<{ id: string }>(
      ended
        ? `INSERT INTO trip_driver_assignments
             (trip_id, driver_user_id, assigned_by, state, ended_by, ended_at, end_reason)
           VALUES ($1, $2, $3, 'ended', $3, now(), 'legacy') RETURNING id`
        : `INSERT INTO trip_driver_assignments (trip_id, driver_user_id, assigned_by)
           VALUES ($1, $2, $3) RETURNING id`,
      [tripId, driver, operator],
    )).id;

  const event = (tripId: string, assignment: string, vehicleId: string, key: string, voided = false) =>
    pool.query(
      `INSERT INTO trip_execution_events
         (trip_id, driver_assignment_id, event_type, vehicle_id, actual_at, client_event_id, recorded_by,
          voided_at, voided_by, void_reason)
       VALUES ($1, $2, 'ARRIVED_PICKUP', $3, now(), $4, $5,
               CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN $5::uuid END, CASE WHEN $6 THEN 'x' END)`,
      [tripId, assignment, vehicleId, key, driverA, voided],
    );

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);
    pool = await openTestSchema(TEST_URL as string, SCHEMA);

    // ★ THE WORLD AS IT STOOD AT 0026: one lorry on the trip row, one active
    // turn per trip, completion unique per trip.
    await applyThrough('0026_trip_sell_and_purchase_price.sql');

    operator = await user('Điều Độ');
    driverA = await user('Tài Xế A', 'driver');
    driverB = await user('Tài Xế B', 'driver');
    lorry1 = await lorry('51D-00001');
    lorry2 = await lorry('51D-00002');
    lorry3 = await lorry('51D-00003');

    // A — active, trip names lorry 1.
    {
      const t = await trip(lorry1);
      caseA = { trip: t, assignment: await turn(t, driverA) };
    }
    // B — active, trip names nothing.
    {
      const t = await trip(null);
      caseB = { trip: t, assignment: await turn(t, driverA) };
    }
    // C — ended; its events say lorry 2 (twice, plus a voided one saying
    // lorry 3); the trip row now says lorry 3. The snapshot wins.
    {
      const t = await trip(lorry3);
      const a = await turn(t, driverA, true);
      await event(t, a, lorry2, 'c1');
      await event(t, a, lorry2, 'c2');
      await event(t, a, lorry3, 'c3-voided', true);
      caseC = { trip: t, assignment: a };
    }
    // D — ended; no events; one live cost line naming lorry 1.
    {
      const t = await trip(lorry2);
      const a = await turn(t, driverA, true);
      await pool.query(
        `INSERT INTO trip_costs
           (trip_id, category, amount, created_by, state, source, driver_assignment_id, vehicle_id)
         VALUES ($1, 'fuel', 100, $2, 'immutable', 'driver_portal', $3, $4)`,
        [t, driverA, a, lorry1],
      );
      caseD = { trip: t, assignment: a };
    }
    // E — ended; events disagree.
    {
      const t = await trip(lorry1);
      const a = await turn(t, driverA, true);
      await event(t, a, lorry1, 'e1');
      await event(t, a, lorry2, 'e2');
      caseE = { trip: t, assignment: a };
    }
    // F — a legacy lorry, never crewed.
    caseF = { trip: await trip(lorry2) };

    // Completion history under the OLD numbering: attempt 1 rejected, attempt
    // 2 approved, on one active turn — trip-scoped then, assignment-scoped after.
    {
      const t = await trip(lorry3);
      const a = await turn(t, driverB);
      await pool.query(
        `INSERT INTO trip_completion_requests
           (trip_id, driver_assignment_id, attempt_no, submitted_by, expense_declaration,
            state, decided_by, decided_at, decision_reason)
         VALUES ($1, $2, 1, $3, 'none', 'rejected', $4, now(), 'thiếu'),
                ($1, $2, 2, $3, 'none', 'approved', $4, now(), NULL)`,
        [t, a, driverB, operator],
      );
      completed = { trip: t, assignment: a };
    }

    // ★ THE THREE FILES UNDER TEST, over the rows above.
    await applyThrough('0029_backfill_assignment_vehicle.sql');
  });

  afterAll(async () => {
    await pool?.end();
  });

  const vehicleOf = async (assignment: string): Promise<string | null> =>
    (await one<{ vehicle_id: string | null }>(
      `SELECT vehicle_id FROM trip_driver_assignments WHERE id = $1`,
      [assignment],
    )).vehicle_id;

  describe('★ the backfill, case by case', () => {
    it('A · an active turn takes the trip’s lorry', async () => {
      expect(await vehicleOf(caseA.assignment)).toBe(lorry1);
    });

    it('B · an active turn on a trip with no lorry stays NULL — nothing is invented', async () => {
      expect(await vehicleOf(caseB.assignment)).toBeNull();
    });

    it('★ C · an ended turn takes the lorry its OWN live events name, not the trip’s current one', async () => {
      // Two live events say lorry 2; a voided one says lorry 3, and so does the
      // trip row today. Neither of those is evidence for what was driven then.
      expect(await vehicleOf(caseC.assignment)).toBe(lorry2);
    });

    it('D · an ended turn with no events takes the lorry its one cost line names', async () => {
      expect(await vehicleOf(caseD.assignment)).toBe(lorry1);
    });

    it('★ E · conflicting evidence leaves NULL, and the snapshots are untouched', async () => {
      expect(await vehicleOf(caseE.assignment)).toBeNull();
      const { rows } = await pool.query<{ vehicle_id: string }>(
        `SELECT vehicle_id FROM trip_execution_events WHERE driver_assignment_id = $1 ORDER BY client_event_id`,
        [caseE.assignment],
      );
      expect(rows.map((r) => r.vehicle_id)).toEqual([lorry1, lorry2]);
    });

    it('F · a trip with a legacy lorry and no crew gets no assignment, and keeps its column', async () => {
      const { rows } = await pool.query(
        `SELECT 1 FROM trip_driver_assignments WHERE trip_id = $1`,
        [caseF.trip],
      );
      expect(rows).toHaveLength(0);
      expect(
        (await one<{ vehicle_id: string }>(`SELECT vehicle_id FROM trip_schedules WHERE id = $1`, [caseF.trip])).vehicle_id,
      ).toBe(lorry2);
    });

    it('★ leaves every legacy `trip_schedules.vehicle_id` exactly as it was', async () => {
      const { rows } = await pool.query<{ vehicle_id: string | null }>(
        `SELECT vehicle_id FROM trip_schedules ORDER BY created_at`,
      );
      expect(rows.map((r) => r.vehicle_id)).toEqual([lorry1, null, lorry3, lorry2, lorry1, lorry2, lorry3]);
    });

    it('carries the completion history across, with its attempt numbers intact', async () => {
      const { rows } = await pool.query<{ attempt_no: number; state: string }>(
        `SELECT attempt_no, state FROM trip_completion_requests WHERE driver_assignment_id = $1 ORDER BY attempt_no`,
        [completed.assignment],
      );
      expect(rows).toEqual([
        { attempt_no: 1, state: 'rejected' },
        { attempt_no: 2, state: 'approved' },
      ]);
    });
  });

  describe('★ rerunning the three files changes nothing', () => {
    it('applies each file a second time without error', async () => {
      await rerun('0027_dispatch_assignment_vehicle.sql');
      await rerun('0028_completion_per_assignment.sql');
      await rerun('0029_backfill_assignment_vehicle.sql');
    });

    it('and rewrites no lorry the first run set — or that a person set since', async () => {
      // Somebody re-crews case E by hand; the rerun must not touch it.
      await pool.query(`UPDATE trip_driver_assignments SET vehicle_id = $2 WHERE id = $1`, [
        caseE.assignment,
        lorry3,
      ]);

      await rerun('0029_backfill_assignment_vehicle.sql');

      expect(await vehicleOf(caseE.assignment)).toBe(lorry3);
      expect(await vehicleOf(caseC.assignment)).toBe(lorry2);
      expect(await vehicleOf(caseB.assignment)).toBeNull();
    });
  });

  describe('★ what the new schema refuses and allows', () => {
    const activeTurn = (tripId: string, vehicleId: string | null, driver: string) =>
      failureOf(
        `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by)
         VALUES ($1, $2, $3, $4)`,
        [tripId, vehicleId, driver, operator],
      );

    it('★ refuses a new ACTIVE turn with no lorry — the CHECK applies to every row written from now on', async () => {
      expect(await activeTurn(caseF.trip, null, driverA)).toBe(CHECK_VIOLATION);
    });

    it('★ refuses the same lorry twice on one trip', async () => {
      expect(await activeTurn(caseA.trip, lorry1, driverB)).toBe(UNIQUE_VIOLATION);
    });

    it('★ accepts the same driver on a second and a third lorry of one trip', async () => {
      expect(await activeTurn(caseA.trip, lorry2, driverA)).toBeNull();
      expect(await activeTurn(caseA.trip, lorry3, driverA)).toBeNull();

      const { rows } = await pool.query(
        `SELECT 1 FROM trip_driver_assignments WHERE trip_id = $1 AND state = 'active'`,
        [caseA.trip],
      );
      expect(rows).toHaveLength(3);
    });

    it('accepts a trip with no assignment at all', async () => {
      const t = await trip(null);
      const { rows } = await pool.query(`SELECT 1 FROM trip_driver_assignments WHERE trip_id = $1`, [t]);
      expect(rows).toHaveLength(0);
    });

    it('allows the same lorry again once its turn has ENDED — the index is partial', async () => {
      await pool.query(
        `UPDATE trip_driver_assignments
            SET state = 'ended', ended_by = $2, ended_at = now(), end_reason = 'đổi người'
          WHERE id = $1`,
        [caseA.assignment, operator],
      );
      expect(await activeTurn(caseA.trip, lorry1, driverB)).toBeNull();
    });

    it('★ scopes pending and approved completion to the ASSIGNMENT', async () => {
      // Two turns on one trip may each have a pending request; one turn may not
      // have two.
      const t = await trip(null);
      const a = (await one<{ id: string }>(
        `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by)
         VALUES ($1, $2, $3, $4) RETURNING id`, [t, lorry1, driverA, operator])).id;
      const b = (await one<{ id: string }>(
        `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by)
         VALUES ($1, $2, $3, $4) RETURNING id`, [t, lorry2, driverB, operator])).id;

      const pending = (assignment: string, attempt: number, by: string) =>
        failureOf(
          `INSERT INTO trip_completion_requests
             (trip_id, driver_assignment_id, attempt_no, submitted_by, expense_declaration)
           VALUES ($1, $2, $3, $4, 'none')`,
          [t, assignment, attempt, by],
        );

      expect(await pending(a, 1, driverA)).toBeNull();
      expect(await pending(b, 1, driverB)).toBeNull();
      // Same attempt number on another assignment of the same trip: fine now,
      // refused under 0017's (trip_id, attempt_no).
      expect(await pending(a, 2, driverA)).toBe(UNIQUE_VIOLATION); // a second PENDING on a
    });

    it('keeps the trip-side read indexed after the trip-scoped unique went', async () => {
      const { rows } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'trip_completion_requests' AND schemaname = $1`,
        [SCHEMA],
      );
      const names = rows.map((r) => r.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          'idx_trip_completion_trip_attempt',
          'uq_assignment_completion_pending',
          'uq_assignment_completion_approved',
          'uq_assignment_completion_attempt',
          'idx_trip_completion_assignment',
        ]),
      );
      expect(names).not.toContain('uq_trip_completion_pending');
      expect(names).not.toContain('uq_trip_completion_attempt');
    });
  });

  describe('★ the 0030 gate — VALIDATE CONSTRAINT', () => {
    const VALIDATE = `ALTER TABLE trip_driver_assignments VALIDATE CONSTRAINT trip_driver_assignments_active_has_vehicle`;

    it('fails while a case-B row still exists, and leaves the constraint NOT VALID', async () => {
      expect(await failureOf(VALIDATE)).toBe(CHECK_VIOLATION);
      const { convalidated } = await one<{ convalidated: boolean }>(
        `SELECT convalidated FROM pg_constraint WHERE conname = 'trip_driver_assignments_active_has_vehicle' AND conrelid = 'trip_driver_assignments'::regclass`,
      );
      expect(convalidated).toBe(false);
    });

    it('★ passes once Operations has re-crewed it — ending the lorry-less turn is enough', async () => {
      await pool.query(
        `UPDATE trip_driver_assignments
            SET state = 'ended', ended_by = $2, ended_at = now(), end_reason = 'điều độ lại sau 0027'
          WHERE id = $1`,
        [caseB.assignment, operator],
      );

      expect(await failureOf(VALIDATE)).toBeNull();
      const { convalidated } = await one<{ convalidated: boolean }>(
        `SELECT convalidated FROM pg_constraint WHERE conname = 'trip_driver_assignments_active_has_vehicle' AND conrelid = 'trip_driver_assignments'::regclass`,
      );
      expect(convalidated).toBe(true);
    });
  });
});
