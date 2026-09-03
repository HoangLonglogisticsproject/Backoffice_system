import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  TEST_URL,
  assertLooksLikeATestDatabase,
  describeIntegration,
  fakeHasher,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';
import { ConflictError, NotFoundError, ValidationError } from '@common/errors/domain.error';
import { UserRepository } from '@core/users/persistence/user.repository';
import { TripScheduleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../../src/capabilities/trip-schedule/persistence/trip-status-history.repository';
import { DriverAssignmentRepository } from '../../src/capabilities/trip-schedule/persistence/trip-execution.repository';
import {
  OutsourceHireRepository,
  TripCostRepository,
  TripCostTotalsRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-cost.repository';
import { TripCostService } from '../../src/capabilities/trip-schedule/application/trip-cost.service';
import { TripScheduleService } from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import {
  TripCustomerRepository,
  TripVehicleRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-catalogue.repository';
import { buildDateRangePageQuerySchema } from '@common/pagination/date-range-page-query.dto';

/**
 * The cost application layer against a REAL PostgreSQL.
 *
 * `0012`'s own spec proves the SCHEMA refuses bad rows. This one proves the
 * SERVICE — which is a different set of claims:
 *
 *   MONEY NEVER BECOMES A NUMBER   an amount survives the whole round trip as
 *                                  text, and a hundred lines total exactly
 *   IMMUTABLE MEANS IMMUTABLE      there is no path from this layer that
 *                                  changes an amount, a category or a trip
 *   A VOID IS FINAL AND ATTRIBUTED it names who and when, cannot be repeated,
 *                                  and removes the record from every total
 *   COST OUTLIVES THE TRIP'S STATE a finished or archived trip still takes
 *                                  money, because cost is a later workflow
 */
const SCHEMA = 'trip_cost_service_itest';


describeIntegration('Trip cost service against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let money: TripCostService;
  let board: TripScheduleService;
  let trips: TripScheduleRepository;
  let author: string;
  let trip: string;

  const newTrip = async (status = 'awaiting_production'): Promise<string> => {
    const rows = await pool.query<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, status, created_by)
       VALUES ('2026-08-04', $1, $2) RETURNING id`,
      [status, author],
    );
    return rows.rows[0]?.id as string;
  };

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);

    const setup = new Pool({ connectionString: TEST_URL, max: 1 });
    try {
      await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    } finally {
      await setup.end();
    }

    pool = new Pool({ connectionString: TEST_URL, max: 4, options: `-c search_path=${SCHEMA}` });

    const migrations = join(__dirname, '..', '..', 'migrations');
    for (const file of [
      '0001_identity.sql',
      '0002_users_updated_at.sql',
      '0011_trip_schedule.sql',
      '0012_trip_cost.sql',
      // The operational lifecycle. Listed in full because 0016 and 0017 carry
      // foreign keys back into 0013 and 0014 — a subset simply fails to apply.
      '0013_trip_carrier_and_vehicle_ownership.sql',
      '0014_trip_driver_assignment.sql',
      '0015_trip_execution_event.sql',
      '0016_trip_cost_lifecycle.sql',
      '0017_trip_completion_and_history.sql',
      // 0018 adds `users.account_type`, which provisioning now writes on every
      // insert — so every spec that creates a user needs it.
      '0018_driver_account.sql',
      '0019_trip_location.sql',
      // 0021 relaxes 0012's void constraint so a withdrawal needs no reason.
      // Without it this list tests a schema the running code no longer targets.
      '0021_void_reason_optional.sql',
    ]) {
      await pool.query(await readFile(join(migrations, file), 'utf8'));
    }

    const database = poolAsDatabase(pool);

    trips = new TripScheduleRepository(database);
    const vehicles = new TripVehicleRepository(database);

    board = new TripScheduleService(
      database,
      trips,
      vehicles,
      new TripCustomerRepository(database),
      new TripStatusHistoryRepository(database),
    );
    money = new TripCostService(
      database,
      trips,
      new TripCostRepository(database),
      new OutsourceHireRepository(database),
      new TripCostTotalsRepository(database),
      new DriverAssignmentRepository(database),
      vehicles,
    );

    author = (await new UserRepository(database).insertUser({ displayName: 'Kế Toán' })).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // ★ TRUNCATE, NOT DELETE, AND 0017 IS THE REASON. Its `deny_delete` trigger
    // refuses a row-level DELETE on every historical table — which is the point
    // of it. TRUNCATE is a different statement that fires no row triggers, so a
    // disposable test database can still be emptied between cases while the
    // guarantee holds for every path the application could ever take.
    //
    // CASCADE because `trip_status_history` and the execution tables now carry
    // foreign keys back to `trip_schedules`.
    await pool.query(
      `TRUNCATE trip_status_history, trip_completion_requests, trip_execution_events,
                trip_cost_edits, trip_costs, trip_outsource_hires,
                trip_driver_assignments, trip_schedules, trip_vehicles, trip_customers
       RESTART IDENTITY CASCADE`,
    );
    trip = await newTrip();
  });

  // ------------------------------------------------------------- recording ----

  describe('recording money', () => {
    it('records a cost line against a trip', async () => {
      const line = await money.createCost({
        tripId: trip,
        category: 'fuel',
        amount: '1500000.00',
        createdBy: author,
      });

      expect(line.category).toBe('fuel');
      expect(line.amount).toBe('1500000.00');
      expect(line.createdBy).toBe(author);
      expect(line.voidedAt).toBeNull();
    });

    it('records an outsourced hire, with the carrier as typed', async () => {
      const hire = await money.createHire({
        tripId: trip,
        carrierName: 'Hai Thành',
        agreedAmount: '4500000',
        documentRef: 'HD-2026-08-04',
        createdBy: author,
      });

      expect(hire.carrierName).toBe('Hai Thành');
      // PostgreSQL renders NUMERIC(14,2) with both places, whatever was sent.
      expect(hire.agreedAmount).toBe('4500000.00');
      expect(hire.amountIncludesVat).toBe(false);
      expect(hire.documentRef).toBe('HD-2026-08-04');
    });

    it('★ allows several lines of the same category on one trip', async () => {
      await money.createCost({ tripId: trip, category: 'fuel', amount: '500000', createdBy: author });
      await money.createCost({ tripId: trip, category: 'fuel', amount: '300000', createdBy: author });

      const { items, total } = await money.listCosts(trip);
      expect(items).toHaveLength(2);
      expect(total).toBe('800000.00');
    });

    it('★ allows several hires on one trip', async () => {
      await money.createHire({ tripId: trip, carrierName: 'xe Út', agreedAmount: '2000000', createdBy: author });
      await money.createHire({ tripId: trip, carrierName: 'Mr Đạt', agreedAmount: '1500000', createdBy: author });

      const { items, total } = await money.listHires(trip);
      expect(items).toHaveLength(2);
      expect(total).toBe('3500000.00');
    });

    it('stores a whitespace-only note as null', async () => {
      const line = await money.createCost({
        tripId: trip,
        category: 'toll',
        amount: '50000',
        note: '   ',
        createdBy: author,
      });
      expect(line.note).toBeNull();
    });
  });

  describe('★ provenance: who wrote the figure, spelled out', () => {
    it('names the author of a cost line, not just their id', async () => {
      const line = await money.createCost({
        tripId: trip,
        category: 'fuel',
        amount: '1500000',
        createdBy: author,
      });

      // A UUID cannot be shown to anyone — `user-summary` states the rule, and
      // an unauditable financial record is the case it exists for.
      expect(line.createdBy).toBe(author);
      expect(line.createdByUser).toEqual({ id: author, displayName: 'Kế Toán' });
      expect(line.createdAt).toBeInstanceOf(Date);
    });

    it('names the author of an outsourced hire too', async () => {
      const hire = await money.createHire({
        tripId: trip,
        carrierName: 'Hai Thành',
        agreedAmount: '4500000',
        createdBy: author,
      });

      expect(hire.createdByUser).toEqual({ id: author, displayName: 'Kế Toán' });
      expect(hire.createdAt).toBeInstanceOf(Date);
    });

    it('carries the author through the LIST reads', async () => {
      await money.createCost({ tripId: trip, category: 'toll', amount: '50000', createdBy: author });
      await money.createHire({ tripId: trip, carrierName: 'xe Út', agreedAmount: '90000', createdBy: author });

      expect((await money.listCosts(trip)).items[0]?.createdByUser.displayName).toBe('Kế Toán');
      expect((await money.listHires(trip)).items[0]?.createdByUser.displayName).toBe('Kế Toán');
    });

    it('★ keeps the author on a VOIDED record', async () => {
      // Provenance is exactly what a withdrawn record is kept FOR: the figure
      // stops counting, and who entered it stays answerable.
      const line = await money.createCost({
        tripId: trip,
        category: 'fuel',
        amount: '500000',
        createdBy: author,
      });
      const voided = await money.voidCost(trip, line.id, { by: author, reason: 'sai' });

      expect(voided.createdByUser).toEqual({ id: author, displayName: 'Kế Toán' });

      const [listed] = (await money.listCosts(trip, true)).items;
      expect(listed?.createdByUser.displayName).toBe('Kế Toán');
      expect(listed?.voidReason).toBe('sai');
    });
  });

  // ------------------------------------------------------------ refusals ----

  describe('what the service refuses', () => {
    it.each(['0', '0.00', '-1', '-0.01', '', 'abc', '1e6', '1.234', '1234567890123'])(
      'refuses the amount %p',
      async (amount) => {
        await expect(
          money.createCost({ tripId: trip, category: 'fuel', amount, createdBy: author }),
        ).rejects.toBeInstanceOf(ValidationError);
      },
    );

    it('★ refuses a fraction NUMERIC(14,2) would silently round', async () => {
      // 1.234 would be STORED as 1.23. Refusing beats telling a caller their
      // figure was saved when a different figure was saved.
      await expect(
        money.createCost({ tripId: trip, category: 'fuel', amount: '1.234', createdBy: author }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('\u2605 refuses a category outside the five, even bypassing the HTTP layer', async () => {
      // The controller's enum catches an HTTP caller; a script calling the
      // service directly would otherwise reach the database CHECK, which
      // surfaces as a 500 rather than as "that heading does not exist".
      await expect(
        money.createCost({
          tripId: trip,
          category: 'allowance' as never,
          amount: '100',
          createdBy: author,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses a hire with a blank carrier', async () => {
      await expect(
        money.createHire({ tripId: trip, carrierName: '   ', agreedAmount: '100', createdBy: author }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses a cost line for a trip that does not exist', async () => {
      await expect(
        money.createCost({
          tripId: '00000000-0000-4000-8000-000000000000',
          category: 'fuel',
          amount: '100',
          createdBy: author,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('refuses a hire for a trip that does not exist', async () => {
      await expect(
        money.createHire({
          tripId: '00000000-0000-4000-8000-000000000000',
          carrierName: 'Hải Râu',
          agreedAmount: '100',
          createdBy: author,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ---------------------------------------------------------------- money ----

  describe('★ money never becomes a JavaScript number', () => {
    it('returns amounts as strings, not numbers', async () => {
      const line = await money.createCost({
        tripId: trip,
        category: 'warehouse',
        amount: '999999999.99',
        createdBy: author,
      });
      expect(typeof line.amount).toBe('string');
      expect(line.amount).toBe('999999999.99');
    });

    it('★ totals a hundred small lines exactly', async () => {
      // 100 × 0.01 is 1.00 in NUMERIC and 1.0000000000000007 in float64. If any
      // layer parsed these into numbers, this is where it shows.
      for (let index = 0; index < 100; index += 1) {
        await money.createCost({ tripId: trip, category: 'toll', amount: '0.01', createdBy: author });
      }
      expect((await money.listCosts(trip)).total).toBe('1.00');
    });

    it('★ combines both kinds in SQL, so a caller never adds two strings', async () => {
      await money.createCost({ tripId: trip, category: 'fuel', amount: '0.10', createdBy: author });
      await money.createCost({ tripId: trip, category: 'toll', amount: '0.20', createdBy: author });
      await money.createHire({ tripId: trip, carrierName: 'xe Út', agreedAmount: '0.30', createdBy: author });

      const totals = await money.summary(trip);
      // 0.1 + 0.2 is 0.30000000000000004 in float64.
      expect(totals.costs).toBe('0.30');
      expect(totals.hires).toBe('0.30');
      expect(totals.combined).toBe('0.60');
    });

    it('answers zero rather than null for a trip with no money on it', async () => {
      expect(await money.summary(trip)).toEqual({
        costs: '0.00',
        hires: '0.00',
        combined: '0.00',
      });
    });
  });

  // ----------------------------------------------------------------- void ----

  describe('★ voiding is final, explained, and removes the money from the total', () => {
    it('voids a cost line, recording who and why', async () => {
      const line = await money.createCost({ tripId: trip, category: 'fuel', amount: '500000', createdBy: author });

      const voided = await money.voidCost(trip, line.id, { by: author, reason: 'nhập nhầm số tiền' });

      expect(voided.voidedBy).toBe(author);
      expect(voided.voidReason).toBe('nhập nhầm số tiền');
      expect(voided.voidedAt).toBeInstanceOf(Date);
    });

    it('★ excludes the voided line from the total but keeps the record', async () => {
      const line = await money.createCost({ tripId: trip, category: 'fuel', amount: '500000', createdBy: author });
      await money.voidCost(trip, line.id, { by: author, reason: 'sai' });

      expect((await money.listCosts(trip)).total).toBe('0.00');
      // Gone from the default list…
      expect((await money.listCosts(trip)).items).toHaveLength(0);
      // …but still there when asked for, which is what makes an audit possible.
      expect((await money.listCosts(trip, true)).items).toHaveLength(1);
    });

    it('★ withdraws with no reason at all, and stores null rather than a placeholder', async () => {
      const line = await money.createCost({ tripId: trip, category: 'fuel', amount: '100', createdBy: author });

      const voided = await money.voidCost(trip, line.id, { by: author });

      expect(voided.voidedBy).toBe(author);
      expect(voided.voidReason).toBeNull();
      // The row survives the withdrawal, as it always did.
      expect((await money.listCosts(trip, true)).items).toHaveLength(1);
      expect((await money.listCosts(trip)).items).toHaveLength(0);
    });

    it('★ keeps a reason a caller does send', async () => {
      const line = await money.createCost({ tripId: trip, category: 'fuel', amount: '100', createdBy: author });

      const voided = await money.voidCost(trip, line.id, { by: author, reason: 'nhập nhầm' });

      expect(voided.voidReason).toBe('nhập nhầm');
    });

    it('★ refuses to void the same line twice', async () => {
      const line = await money.createCost({ tripId: trip, category: 'fuel', amount: '100', createdBy: author });
      await money.voidCost(trip, line.id, { by: author, reason: 'lần một' });

      await expect(
        money.voidCost(trip, line.id, { by: author, reason: 'lần hai' }),
      ).rejects.toBeInstanceOf(ConflictError);

      // The first withdrawal's reason survives — a second void must not rewrite it.
      const [record] = (await money.listCosts(trip, true)).items;
      expect(record?.voidReason).toBe('lần một');
    });

    it('★ refuses to void a line belonging to a DIFFERENT trip', async () => {
      // Otherwise one trip's id plus a foreign line id would withdraw money
      // from a trip the caller never named.
      const other = await newTrip();
      const line = await money.createCost({ tripId: other, category: 'fuel', amount: '100', createdBy: author });

      await expect(
        money.voidCost(trip, line.id, { by: author, reason: 'nhầm chuyến' }),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect((await money.listCosts(other)).items).toHaveLength(1);
    });

    it('voids a hire the same way', async () => {
      const hire = await money.createHire({ tripId: trip, carrierName: 'Hai Thành', agreedAmount: '2000000', createdBy: author });
      await money.voidHire(trip, hire.id, { by: author, reason: 'đổi nhà xe' });

      expect((await money.listHires(trip)).total).toBe('0.00');
      await expect(
        money.voidHire(trip, hire.id, { by: author, reason: 'lại nữa' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('answers 404 for a record that never existed', async () => {
      await expect(
        money.voidCost(trip, '00000000-0000-4000-8000-000000000000', { by: author, reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ----------------------------------------------------------- correction ----

  describe('★ a correction is a void plus a new record', () => {
    it('leaves both readable, with only the replacement counted', async () => {
      const wrong = await money.createCost({ tripId: trip, category: 'overtime', amount: '5000000', createdBy: author });
      await money.voidCost(trip, wrong.id, { by: author, reason: 'sai số tiền' });
      const right = await money.createCost({ tripId: trip, category: 'overtime', amount: '500000', createdBy: author });

      expect((await money.listCosts(trip)).total).toBe('500000.00');

      const all = await money.listCosts(trip, true);
      expect(all.items).toHaveLength(2);
      expect(all.items.find((row) => row.id === wrong.id)?.amount).toBe('5000000.00');
      expect(all.items.find((row) => row.id === right.id)?.voidedAt).toBeNull();
    });

    it('★ offers exactly ONE edit path, and it reaches only a driver’s unlocked line', () => {
      // ★ THIS ASSERTION DID ITS JOB, AND THIS IS SOMEBODY SAYING SO OUT LOUD.
      //
      // It used to read `…filter(/^(update|edit|…)/).toEqual([])` — no edit path
      // may exist at all, 0012's rule. `editCost` now exists, deliberately: the
      // business contract (§9.1) gives a DRIVER-DECLARED figure a life before it
      // is final, because a mistyped digit at a fuel station should not produce
      // two rows and a void reason reading "typo".
      //
      // The old rule is NARROWED, not dropped, and the narrowing is what this
      // case now pins:
      //
      //   · a BACKOFFICE line is still unreachable — `editCost` refuses it
      //   · a LOCKED or IMMUTABLE line is still unreachable
      //   · no OTHER edit-shaped method exists, so a second path would fail here
      //
      // The list is exhaustive rather than `arrayContaining`, so adding a method
      // to this service breaks this test on purpose.
      const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(money))
        .filter((name) => name !== 'constructor')
        .sort();

      // `ownershipOf` and `requireTrip` are `private` in TypeScript, which is a
      // COMPILE-TIME idea — the prototype carries them at runtime like any other
      // method. Listed rather than filtered out, so the list stays a literal
      // description of what is actually there.
      expect(surface).toEqual([
        'createCost',
        'createHire',
        'declareCost',
        'editCost',
        'listCostEdits',
        'listCosts',
        'listHires',
        'ownershipOf',
        'requireTrip',
        'summary',
        'voidCost',
        'voidHire',
      ]);

      // Exactly one, and it is the driver's.
      expect(surface.filter((name) => /^(update|edit|patch|set|delete|remove)/i.test(name))).toEqual(
        ['editCost'],
      );
    });

    it('★ refuses to edit a BACKOFFICE line, which is still corrected by voiding', async () => {
      // The half of 0012's rule that did NOT change. A clerk's invoice line is
      // born `immutable`, so the only correction is a void plus a new row.
      const line = await money.createCost({
        tripId: trip,
        category: 'overtime',
        amount: '500000',
        createdBy: author,
      });

      await expect(
        money.editCost(trip, line.id, { amount: '400000' }, author),
      ).rejects.toThrow(ConflictError);

      // And the figure really did not move.
      expect((await money.listCosts(trip)).items.find((row) => row.id === line.id)?.amount).toBe(
        '500000.00',
      );
    });
  });

  /**
   * ★ THE BOARD MUST NOT LEAK THE MONEY.
   *
   * `trip.read` is `'any'` — every finished account reads the dispatch board.
   * The whole reason cost lives in its own tables behind its own permission is
   * that the amounts must never ride along on a trip response. This asserts it
   * against REAL rows rather than against the type: a join added to
   * `tripsWithRefs` for a plausible reason would break here, loudly, on the day
   * it is written.
   */
  describe('★ the general trip API exposes no money', () => {
    const MONEY_WORDS = /amount|cost|price|total|hire|carrier|vat/i;

    const asQuery = (raw: Record<string, unknown>) =>
      buildDateRangePageQuerySchema(() => new Date('2026-08-15T03:00:00Z')).parse(raw);

    it('returns no money-shaped field from the list, on a trip that HAS money', async () => {
      await money.createCost({ tripId: trip, category: 'fuel', amount: '1500000', createdBy: author });
      await money.createHire({ tripId: trip, carrierName: 'Hai Thành', agreedAmount: '4500000', createdBy: author });

      const page = await board.list(asQuery({}));
      const row = page.items.find((item) => item.id === trip);
      expect(row).toBeDefined();

      const leaked = Object.keys(row as object).filter((key) => MONEY_WORDS.test(key));
      expect(leaked).toEqual([]);
      // And nothing anywhere in the serialised row says the figures either.
      expect(JSON.stringify(row)).not.toContain('1500000');
      expect(JSON.stringify(row)).not.toContain('4500000');
    });

    it('returns no money-shaped field from the detail read either', async () => {
      await money.createCost({ tripId: trip, category: 'fuel', amount: '1500000', createdBy: author });

      const row = await board.findById(trip);
      expect(Object.keys(row).filter((key) => MONEY_WORDS.test(key))).toEqual([]);
      expect(JSON.stringify(row)).not.toContain('1500000');
    });
  });

  // -------------------------------------------------- independence of trip ----

  describe('★ cost does not care where the trip is', () => {
    it.each([
      'awaiting_production',
      'awaiting_vehicle',
      'needs_confirmation',
      'external_booking',
      'done',
    ])('records money on a trip that is %s', async (status) => {
      const target = await newTrip(status);
      await expect(
        money.createCost({ tripId: target, category: 'fuel', amount: '100', createdBy: author }),
      ).resolves.toBeDefined();
    });

    it('★ records money on a FINISHED trip — the case the feature exists for', async () => {
      const done = await newTrip('done');
      await money.createCost({ tripId: done, category: 'overtime', amount: '250000', createdBy: author });
      await money.createHire({ tripId: done, carrierName: 'Hải Râu', agreedAmount: '3000000', createdBy: author });

      expect((await money.summary(done)).combined).toBe('3250000.00');
    });

    it('★ still records and reads money on an ARCHIVED trip', async () => {
      // Cost is a later workflow with a different approver: the figures arrive
      // after dispatch has closed the row. Refusing them would lose a real
      // expense to a lifecycle it has nothing to do with.
      await money.createCost({ tripId: trip, category: 'fuel', amount: '800000', createdBy: author });
      await trips.archive(trip, author, new Date());

      await expect(
        money.createCost({ tripId: trip, category: 'toll', amount: '200000', createdBy: author }),
      ).resolves.toBeDefined();

      expect((await money.summary(trip)).costs).toBe('1000000.00');
      expect((await money.listCosts(trip)).items).toHaveLength(2);
    });
  });
});
