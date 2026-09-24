import { Pool } from 'pg';
import { ValidationError } from '@common/errors/domain.error';
import type { Database } from '@common/types/database.port';
import { AiReadModelService } from '../../src/capabilities/trip-schedule/application/ai-read-model.service';
import { AiReadModelRepository } from '../../src/capabilities/trip-schedule/persistence/ai-read-model.repository';
import {
  TEST_URL,
  applyAllMigrations,
  assertLooksLikeATestDatabase,
  describeIntegration,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';

/**
 * The AI read models against a REAL PostgreSQL.
 *
 * ★ WHAT ONLY A SERVER CAN SETTLE. These are read models over five tables and
 * four correlated sub-selects; what has to be true is that the facts they
 * report match what the operational tables actually say — an assignment that
 * ended, an event that was voided, the LATEST completion attempt rather than
 * the first — and that the keyset walks every row exactly once. A fake
 * repository would agree with whatever the code believed.
 *
 * ★ AND THAT NO POLICY LIVES HERE. Several cases below assert that a row the
 * AI might NOT want is still returned: a trip whose pickup is long past, an
 * assignment whose completion is approved. The backend reports facts; the AI
 * decides. A filter added here later would silently take a decision away from
 * the detector, and these cases are what would notice.
 */
const SCHEMA = 'ai_read_model_itest';

describeIntegration('AI read models against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let database: Database;
  let service: AiReadModelService;

  let operator: string;
  let driver: string;
  let vehicle: string;
  let customer: string;

  /** 2026-09-24T08:00:00Z — every instant below is relative to this. */
  const NOW = new Date('2026-09-24T08:00:00.000Z');
  const hours = (n: number): Date => new Date(NOW.getTime() + n * 3_600_000);

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);
    database = poolAsDatabase(pool);
    service = new AiReadModelService(new AiReadModelRepository(database));

    operator = await createUser('An Operator');
    driver = await createUser('A Driver');
    const vehicleRow = await pool.query<{ id: string }>(
      "INSERT INTO trip_vehicles (plate, created_by) VALUES ('51C-000.01', $1) RETURNING id",
      [operator],
    );
    vehicle = vehicleRow.rows[0]!.id;
    const customerRow = await pool.query<{ id: string }>(
      "INSERT INTO trip_customers (name, created_by) VALUES ('A Customer', $1) RETURNING id",
      [operator],
    );
    customer = customerRow.rows[0]!.id;
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE trip_completion_requests, trip_execution_events, trip_driver_assignments, trip_status_history, trip_schedules CASCADE',
    );
  });

  async function createUser(name: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO users (display_name) VALUES ($1) RETURNING id',
      [name],
    );
    return rows[0]!.id;
  }

  interface TripOptions {
    pickupAt?: Date | null;
    status?: 'pending' | 'confirmed' | 'executing' | 'finished';
    archived?: boolean;
    withCustomer?: boolean;
  }

  async function createTrip(options: TripOptions = {}): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, pickup_at, status, customer_id, created_by, archived_at, archived_by)
       VALUES ('2026-09-24', $1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        options.pickupAt === undefined ? hours(1) : options.pickupAt,
        options.status ?? 'confirmed',
        options.withCustomer === false ? null : customer,
        operator,
        options.archived ? NOW : null,
        options.archived ? operator : null,
      ],
    );
    return rows[0]!.id;
  }

  async function assign(tripId: string, state: 'active' | 'ended' = 'active'): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO trip_driver_assignments (trip_id, driver_user_id, vehicle_id, state, assigned_by, assigned_at,
                                            ended_by, ended_at, end_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        tripId,
        driver,
        vehicle,
        state,
        operator,
        hours(-2),
        state === 'ended' ? operator : null,
        state === 'ended' ? hours(-1) : null,
        state === 'ended' ? 'Replaced.' : null,
      ],
    );
    return rows[0]!.id;
  }

  async function reportEvent(tripId: string, assignmentId: string, voided = false): Promise<void> {
    await pool.query(
      `INSERT INTO trip_execution_events
         (trip_id, driver_assignment_id, event_type, actual_at, client_event_id, recorded_by, voided_at, voided_by, void_reason)
       VALUES ($1, $2, 'ARRIVED_PICKUP', $3, $4, $5, $6, $7, $8)`,
      [
        tripId,
        assignmentId,
        hours(-1),
        `client-${assignmentId}-${voided ? 'void' : 'live'}`,
        driver,
        voided ? NOW : null,
        voided ? operator : null,
        voided ? 'Reported by mistake.' : null,
      ],
    );
  }

  async function submitCompletion(
    tripId: string,
    assignmentId: string,
    state: 'pending' | 'approved' | 'rejected',
    submittedAt: Date = hours(-3),
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO trip_completion_requests
         (trip_id, driver_assignment_id, attempt_no, expense_declaration, state, submitted_by, submitted_at,
          decided_by, decided_at, decision_reason)
       SELECT $1, $2, COALESCE(MAX(attempt_no), 0) + 1, 'none', $3, $4, $5, $6, $7, $8
         FROM trip_completion_requests WHERE driver_assignment_id = $2
       RETURNING id`,
      [
        tripId,
        assignmentId,
        state,
        driver,
        submittedAt,
        state === 'pending' ? null : operator,
        state === 'pending' ? null : NOW,
        state === 'rejected' ? 'Missing paperwork.' : null,
      ],
    );
    return rows[0]!.id;
  }

  const page = { before: hours(24), limit: 50 };

  // ------------------------------------------------------- unassigned trips --

  describe('unassignedTrips', () => {
    it('reports a live trip with no active assignment, with its canonical facts', async () => {
      const tripId = await createTrip({ pickupAt: hours(1) });

      const result = await service.unassignedTrips(page);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        tripId,
        scheduledOn: '2026-09-24',
        status: 'confirmed',
        archived: false,
        activeAssignmentCount: 0,
        customer: { id: customer, name: 'A Customer' },
      });
      expect(result.items[0]!.pickupAt?.toISOString()).toBe(hours(1).toISOString());
      expect(result.hasMore).toBe(false);
    });

    it('omits a trip that has an active assignment, and reports it again once that assignment ends', async () => {
      const tripId = await createTrip();
      const assignmentId = await assign(tripId);
      expect((await service.unassignedTrips(page)).items).toHaveLength(0);

      await pool.query(
        "UPDATE trip_driver_assignments SET state = 'ended', ended_by = $2, ended_at = now(), end_reason = 'Off the job.' WHERE id = $1",
        [assignmentId, operator],
      );

      const after = await service.unassignedTrips(page);
      expect(after.items.map((t) => t.tripId)).toEqual([tripId]);
      expect(after.items[0]!.activeAssignmentCount).toBe(0);
    });

    it('omits archived trips, finished trips, and trips with no pickup instant', async () => {
      await createTrip({ archived: true });
      await createTrip({ status: 'finished' });
      await createTrip({ pickupAt: null });
      const live = await createTrip();

      expect((await service.unassignedTrips(page)).items.map((t) => t.tripId)).toEqual([live]);
    });

    it('reports a trip whose pickup is long past — "late" is the AI\'s verdict, not the backend\'s', async () => {
      const tripId = await createTrip({ pickupAt: hours(-72) });
      expect((await service.unassignedTrips(page)).items.map((t) => t.tripId)).toEqual([tripId]);
    });

    it('honours the window: nothing beyond `before` comes back', async () => {
      const inside = await createTrip({ pickupAt: hours(1) });
      await createTrip({ pickupAt: hours(5) });

      const narrow = await service.unassignedTrips({ before: hours(2), limit: 50 });
      expect(narrow.items.map((t) => t.tripId)).toEqual([inside]);
    });

    it('includes a trip whose pickup is EXACTLY the window bound — the bound is inclusive', async () => {
      const tripId = await createTrip({ pickupAt: hours(2) });
      expect((await service.unassignedTrips({ before: hours(2), limit: 50 })).items.map((t) => t.tripId)).toEqual([
        tripId,
      ]);
    });

    it('walks every row exactly once across keyset pages, soonest pickup first', async () => {
      const ids: string[] = [];
      for (let i = 1; i <= 5; i += 1) ids.push(await createTrip({ pickupAt: hours(i) }));

      const seen: string[] = [];
      let cursor: string | undefined;
      let guard = 0;
      do {
        const result = await service.unassignedTrips({ before: hours(24), limit: 2, cursor });
        seen.push(...result.items.map((t) => t.tripId));
        cursor = result.nextCursor ?? undefined;
        guard += 1;
      } while (cursor && guard < 10);

      expect(seen).toEqual(ids);
      expect(new Set(seen).size).toBe(5);
    });

    it('pages correctly when many trips share one pickup instant — the id is the tiebreaker', async () => {
      const sameInstant = hours(1);
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) ids.push(await createTrip({ pickupAt: sameInstant }));

      const seen: string[] = [];
      let cursor: string | undefined;
      let guard = 0;
      do {
        const result = await service.unassignedTrips({ before: hours(24), limit: 2, cursor });
        seen.push(...result.items.map((t) => t.tripId));
        cursor = result.nextCursor ?? undefined;
        guard += 1;
      } while (cursor && guard < 10);

      expect(new Set(seen).size).toBe(5);
      expect([...seen].sort()).toEqual([...ids].sort());
    });

    describe('★ the (after, before] band — half-open, so bands chain without a gap or a repeat', () => {
      it('excludes the lower bound and includes the upper one', async () => {
        const atLowerBound = await createTrip({ pickupAt: hours(1) });
        const inside = await createTrip({ pickupAt: hours(2) });
        const atUpperBound = await createTrip({ pickupAt: hours(3) });
        await createTrip({ pickupAt: hours(4) });

        const band = await service.unassignedTrips({ after: hours(1), before: hours(3), limit: 50 });

        expect(band.items.map((t) => t.tripId)).toEqual([inside, atUpperBound]);
        expect(band.items.map((t) => t.tripId)).not.toContain(atLowerBound);
      });

      it('★ two adjacent bands see every trip exactly once — none lost at the join, none repeated', async () => {
        // `now` is hours(0). The detector asks for (now, now+2h] and then
        // (-inf, now]; a trip at exactly `now` must appear in one of them.
        const overdue = await createTrip({ pickupAt: hours(-5) });
        const exactlyNow = await createTrip({ pickupAt: hours(0) });
        const soon = await createTrip({ pickupAt: hours(1) });
        const atLead = await createTrip({ pickupAt: hours(2) });
        const beyondLead = await createTrip({ pickupAt: hours(3) });

        const approaching = await service.unassignedTrips({ after: hours(0), before: hours(2), limit: 50 });
        const overdueBand = await service.unassignedTrips({ before: hours(0), limit: 50 });

        expect(approaching.items.map((t) => t.tripId)).toEqual([soon, atLead]);
        expect(overdueBand.items.map((t) => t.tripId)).toEqual([overdue, exactlyNow]);

        const seen = [...approaching.items, ...overdueBand.items].map((t) => t.tripId);
        expect(new Set(seen).size).toBe(seen.length); // no repeat
        expect(seen).toEqual(expect.arrayContaining([overdue, exactlyNow, soon, atLead]));
        expect(seen).not.toContain(beyondLead); // the rule would not alert on it anyway
      });

      it('keeps the keyset walk correct inside a band with tied pickup instants', async () => {
        const tied = hours(1);
        const ids: string[] = [];
        for (let i = 0; i < 5; i += 1) ids.push(await createTrip({ pickupAt: tied }));
        await createTrip({ pickupAt: hours(-1) }); // outside the band

        const seen: string[] = [];
        let cursor: string | undefined;
        let guard = 0;
        do {
          const result = await service.unassignedTrips({ after: hours(0), before: hours(2), limit: 2, cursor });
          seen.push(...result.items.map((t) => t.tripId));
          cursor = result.nextCursor ?? undefined;
          guard += 1;
        } while (cursor && guard < 10);

        expect(new Set(seen).size).toBe(5);
        expect([...seen].sort()).toEqual([...ids].sort());
      });

      it('applies to the other two read models as well', async () => {
        const tripId = await createTrip({ pickupAt: hours(-3) });
        const assignmentId = await assign(tripId);
        await submitCompletion(tripId, assignmentId, 'pending', hours(-3));

        expect(
          (await service.unstartedAssignments({ after: hours(-2), before: hours(24), limit: 50 })).items,
        ).toHaveLength(0);
        expect(
          (await service.unstartedAssignments({ after: hours(-4), before: hours(24), limit: 50 })).items,
        ).toHaveLength(1);
        expect((await service.pendingCompletions({ after: hours(-2), before: hours(24), limit: 50 })).items).toHaveLength(0);
        expect((await service.pendingCompletions({ after: hours(-4), before: hours(24), limit: 50 })).items).toHaveLength(1);
      });
    });

    it('★ refuses a malformed cursor rather than silently restarting at page one', async () => {
      await createTrip();
      // A client that quietly got page one again would loop forever and look
      // healthy while doing it.
      await expect(service.unassignedTrips({ before: hours(24), limit: 2, cursor: 'not-a-cursor' })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        service.unstartedAssignments({ before: hours(24), limit: 2, cursor: 'not-a-cursor' }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        service.pendingCompletions({ before: hours(24), limit: 2, cursor: 'not-a-cursor' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('reports a trip with no customer as `customer: null` rather than dropping it', async () => {
      await createTrip({ withCustomer: false });
      const result = await service.unassignedTrips(page);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.customer).toBeNull();
    });
  });

  // -------------------------------------------------- unstarted assignments --

  describe('unstartedAssignments', () => {
    it('reports an active assignment with no live event, carrying its trip facts', async () => {
      const tripId = await createTrip({ pickupAt: hours(-1) });
      const assignmentId = await assign(tripId);

      const result = await service.unstartedAssignments(page);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        assignmentId,
        tripId,
        driverUserId: driver,
        vehicleId: vehicle,
        vehiclePlate: '51C-000.01',
        state: 'active',
        hasLiveEvents: false,
        latestCompletionState: 'none',
      });
      expect(result.items[0]!.trip).toMatchObject({ tripId, activeAssignmentCount: 1, archived: false });
    });

    it('omits an assignment once a live event is reported, and reports it again if that event is voided', async () => {
      const tripId = await createTrip({ pickupAt: hours(-1) });
      const assignmentId = await assign(tripId);
      await reportEvent(tripId, assignmentId);

      expect((await service.unstartedAssignments(page)).items).toHaveLength(0);

      await pool.query(
        "UPDATE trip_execution_events SET voided_at = now(), voided_by = $2, void_reason = 'Wrong trip.' WHERE driver_assignment_id = $1",
        [assignmentId, operator],
      );

      const after = await service.unstartedAssignments(page);
      expect(after.items.map((a) => a.assignmentId)).toEqual([assignmentId]);
      expect(after.items[0]!.hasLiveEvents).toBe(false);
    });

    it('omits ended assignments, and assignments on archived or finished trips', async () => {
      const endedTrip = await createTrip({ pickupAt: hours(-1) });
      await assign(endedTrip, 'ended');

      const archivedTrip = await createTrip({ pickupAt: hours(-1), archived: true });
      await assign(archivedTrip);

      const finishedTrip = await createTrip({ pickupAt: hours(-1), status: 'finished' });
      await assign(finishedTrip);

      const liveTrip = await createTrip({ pickupAt: hours(-1) });
      const liveAssignment = await assign(liveTrip);

      expect((await service.unstartedAssignments(page)).items.map((a) => a.assignmentId)).toEqual([liveAssignment]);
    });

    it.each(['pending', 'approved', 'rejected'] as const)(
      'REPORTS an assignment whose latest completion is %s — the exclusion is the AI\'s rule',
      async (state) => {
        const tripId = await createTrip({ pickupAt: hours(-1) });
        const assignmentId = await assign(tripId);
        await submitCompletion(tripId, assignmentId, state);

        const result = await service.unstartedAssignments(page);
        expect(result.items.map((a) => a.assignmentId)).toEqual([assignmentId]);
        expect(result.items[0]!.latestCompletionState).toBe(state);
      },
    );

    it('reports the LATEST completion attempt, not the first', async () => {
      const tripId = await createTrip({ pickupAt: hours(-1) });
      const assignmentId = await assign(tripId);
      await submitCompletion(tripId, assignmentId, 'rejected');
      await submitCompletion(tripId, assignmentId, 'pending');

      const result = await service.unstartedAssignments(page);
      expect(result.items[0]!.latestCompletionState).toBe('pending');
      expect(result.items[0]!.assignmentId).toBe(assignmentId);
    });

    it('reports every active assignment of a multi-lorry trip separately (ADR-0004)', async () => {
      const tripId = await createTrip({ pickupAt: hours(-1) });
      const first = await assign(tripId);
      const secondVehicle = await pool.query<{ id: string }>(
        "INSERT INTO trip_vehicles (plate, created_by) VALUES ('51C-000.02', $1) RETURNING id",
        [operator],
      );
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO trip_driver_assignments (trip_id, driver_user_id, vehicle_id, state, assigned_by, assigned_at)
         VALUES ($1, $2, $3, 'active', $4, $5) RETURNING id`,
        [tripId, driver, secondVehicle.rows[0]!.id, operator, hours(-2)],
      );

      const result = await service.unstartedAssignments(page);
      expect(result.items.map((a) => a.assignmentId).sort()).toEqual([first, rows[0]!.id].sort());
      expect(result.items[0]!.trip.activeAssignmentCount).toBe(2);
    });

    it('walks every row exactly once across keyset pages', async () => {
      const expected: string[] = [];
      for (let i = 1; i <= 5; i += 1) {
        const tripId = await createTrip({ pickupAt: hours(-i) });
        expected.push(await assign(tripId));
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      let guard = 0;
      do {
        const result = await service.unstartedAssignments({ before: hours(24), limit: 2, cursor });
        seen.push(...result.items.map((a) => a.assignmentId));
        cursor = result.nextCursor ?? undefined;
        guard += 1;
      } while (cursor && guard < 10);

      expect(new Set(seen).size).toBe(5);
      expect([...seen].sort()).toEqual([...expected].sort());
    });
  });

  // -------------------------------------------------- pending completions --

  describe('pendingCompletions', () => {
    it('reports a pending request with its submission instant and attempt number', async () => {
      const tripId = await createTrip();
      const assignmentId = await assign(tripId);
      const requestId = await submitCompletion(tripId, assignmentId, 'pending', hours(-20));

      const result = await service.pendingCompletions(page);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ requestId, assignmentId, tripId, attemptNo: 1, state: 'pending' });
      expect(result.items[0]!.submittedAt.toISOString()).toBe(hours(-20).toISOString());
      expect(result.items[0]!.decidedAt).toBeNull();
      expect(result.items[0]!.trip.tripId).toBe(tripId);
    });

    it('omits decided requests, whichever way they were decided', async () => {
      const tripId = await createTrip();
      const approved = await assign(tripId);
      await submitCompletion(tripId, approved, 'approved');

      const secondTrip = await createTrip();
      const rejected = await assign(secondTrip);
      await submitCompletion(secondTrip, rejected, 'rejected');

      expect((await service.pendingCompletions(page)).items).toHaveLength(0);
    });

    it('reports the pending RESUBMISSION after a rejection, with its own attempt number', async () => {
      const tripId = await createTrip();
      const assignmentId = await assign(tripId);
      await submitCompletion(tripId, assignmentId, 'rejected', hours(-30));
      const resubmitted = await submitCompletion(tripId, assignmentId, 'pending', hours(-2));

      const result = await service.pendingCompletions(page);
      expect(result.items.map((r) => r.requestId)).toEqual([resubmitted]);
      expect(result.items[0]!.attemptNo).toBe(2);
    });

    it('honours the window and orders oldest submission first', async () => {
      const older = await createTrip();
      const olderAssignment = await assign(older);
      const first = await submitCompletion(older, olderAssignment, 'pending', hours(-30));

      const newer = await createTrip();
      const newerAssignment = await assign(newer);
      const second = await submitCompletion(newer, newerAssignment, 'pending', hours(-2));

      expect((await service.pendingCompletions(page)).items.map((r) => r.requestId)).toEqual([first, second]);
      expect(
        (await service.pendingCompletions({ before: hours(-10), limit: 50 })).items.map((r) => r.requestId),
      ).toEqual([first]);
    });
  });

  // ---------------------------------------------------------------- lookup --

  describe('lookup — the Resolution phase asks by id', () => {
    it('returns the CURRENT facts of each named subject, whatever their state', async () => {
      const tripId = await createTrip({ pickupAt: hours(-1) });
      const assignmentId = await assign(tripId);
      const requestId = await submitCompletion(tripId, assignmentId, 'pending');

      const result = await service.lookup({
        tripIds: [tripId],
        assignmentIds: [assignmentId],
        completionRequestIds: [requestId],
      });

      expect(result.trips.map((t) => t.tripId)).toEqual([tripId]);
      expect(result.assignments.map((a) => a.assignmentId)).toEqual([assignmentId]);
      expect(result.completionRequests.map((r) => r.requestId)).toEqual([requestId]);
    });

    it('★ RETURNS SUBJECTS THE LISTS WOULD FILTER OUT — archived, finished, ended, decided', async () => {
      const archivedTrip = await createTrip({ archived: true });
      const finishedTrip = await createTrip({ status: 'finished' });
      const endedAssignment = await assign(await createTrip(), 'ended');
      const decidedTripId = await createTrip();
      const decidedAssignment = await assign(decidedTripId);
      const approved = await submitCompletion(decidedTripId, decidedAssignment, 'approved');

      const result = await service.lookup({
        tripIds: [archivedTrip, finishedTrip],
        assignmentIds: [endedAssignment],
        completionRequestIds: [approved],
      });

      expect(result.trips.find((t) => t.tripId === archivedTrip)?.archived).toBe(true);
      expect(result.trips.find((t) => t.tripId === finishedTrip)?.status).toBe('finished');
      expect(result.assignments[0]).toMatchObject({ assignmentId: endedAssignment, state: 'ended' });
      expect(result.assignments[0]!.endedAt).not.toBeNull();
      expect(result.completionRequests[0]).toMatchObject({ requestId: approved, state: 'approved' });
      expect(result.completionRequests[0]!.decidedAt).not.toBeNull();
    });

    it('omits an id that does not exist, and returns the ones that do', async () => {
      const tripId = await createTrip();
      const absent = '11111111-1111-4111-8111-111111111111';

      const result = await service.lookup({ tripIds: [tripId, absent], assignmentIds: [], completionRequestIds: [] });

      expect(result.trips.map((t) => t.tripId)).toEqual([tripId]);
    });

    it('answers a lookup of only one kind without touching the others', async () => {
      const tripId = await createTrip();
      const result = await service.lookup({ tripIds: [tripId], assignmentIds: [], completionRequestIds: [] });
      expect(result.assignments).toEqual([]);
      expect(result.completionRequests).toEqual([]);
    });

    it('refuses an empty batch and an over-sized one, rather than answering partially', async () => {
      await expect(
        service.lookup({ tripIds: [], assignmentIds: [], completionRequestIds: [] }),
      ).rejects.toBeInstanceOf(ValidationError);

      const tooMany = Array.from({ length: 201 }, (_, i) => `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000000`);
      await expect(
        service.lookup({ tripIds: tooMany, assignmentIds: [], completionRequestIds: [] }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('reports `hasLiveEvents` and the latest completion state for a looked-up assignment', async () => {
      const tripId = await createTrip();
      const assignmentId = await assign(tripId);
      await reportEvent(tripId, assignmentId);
      await submitCompletion(tripId, assignmentId, 'pending');

      const result = await service.lookup({ tripIds: [], assignmentIds: [assignmentId], completionRequestIds: [] });

      expect(result.assignments[0]).toMatchObject({ hasLiveEvents: true, latestCompletionState: 'pending' });
    });

    it('counts only ACTIVE assignments in a looked-up trip\'s `activeAssignmentCount`', async () => {
      const tripId = await createTrip();
      await assign(tripId, 'ended');
      await assign(tripId, 'active');

      const result = await service.lookup({ tripIds: [tripId], assignmentIds: [], completionRequestIds: [] });
      expect(result.trips[0]!.activeAssignmentCount).toBe(1);
    });
  });
});
