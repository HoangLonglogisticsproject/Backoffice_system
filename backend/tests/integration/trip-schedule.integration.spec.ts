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
import { ConflictError, NotFoundError } from '@common/errors/domain.error';
import { buildDateRangePageQuerySchema } from '@common/pagination/date-range-page-query.dto';
import { UserRepository } from '@core/users/persistence/user.repository';
import {
  TripCustomerRepository,
  TripLocationRepository,
  TripVehicleRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-catalogue.repository';
import { TripScheduleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../../src/capabilities/trip-schedule/persistence/trip-status-history.repository';
import { TripCatalogueService } from '../../src/capabilities/trip-schedule/application/trip-catalogue.service';
import { TripScheduleService } from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import type {
  TripAssignmentFilter,
  TripStatus,
} from '../../src/capabilities/trip-schedule/domain/trip-schedule';

/**
 * The dispatch board against a REAL PostgreSQL.
 *
 * The claims that need a real server rather than a mock:
 *
 *   THE DAY DOES NOT MOVE          `scheduled_on` survives a write and a read
 *                                  as the same calendar day, on a connection
 *                                  whose timezone is not the office's
 *   THE PAGE AND ITS TOTAL AGREE   `COUNT(*) OVER()` counts the same snapshot
 *                                  the rows came from, and paging a range
 *                                  loses and duplicates nothing
 *   THE RANGE ACTUALLY FILTERS     rows outside `from`/`to` are absent, and
 *                                  archived rows are absent from every page
 *   THE CATALOGUE HOLDS            the workbook's real duplicate spellings are
 *                                  refused by the index, not merely by a check
 *                                  the service could forget to run
 */
const SCHEMA = 'trip_itest';


describeIntegration('Trip schedule against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let trips: TripScheduleService;
  let catalogue: TripCatalogueService;
  let author: string;
  let driver: string;

  /**
   * Parses a query string exactly as the controller's pipe would.
   *
   * The controller intersects the shared range-and-page DTO with the crew
   * filter, which defaults to `all` — so a caller naming neither end of the
   * range nor an assignment reads the whole month, crewed or not.
   */
  const asQuery = (raw: Record<string, unknown>, nowIso = '2026-08-15T03:00:00Z') => ({
    ...buildDateRangePageQuerySchema(() => new Date(nowIso)).parse(raw),
    assignment: (raw['assignment'] as TripAssignmentFilter | undefined) ?? 'all',
  });

  /** Puts `driver` on a trip, the way the assignment service does. */
  const crew = async (tripId: string): Promise<void> => {
    await pool.query(
      `INSERT INTO trip_driver_assignments (trip_id, driver_user_id, assigned_by)
       VALUES ($1, $2, $3)`,
      [tripId, driver, author],
    );
  };

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);

    const setup = new Pool({ connectionString: TEST_URL, max: 1 });
    try {
      await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    } finally {
      await setup.end();
    }

    pool = new Pool({
      connectionString: TEST_URL,
      max: 8,
      // ★ A TIMEZONE THAT IS NEITHER UTC NOR THE OFFICE'S, on purpose. If any
      // part of the read path turned a `DATE` into an instant, this is where it
      // would show up as a day that shifted.
      options: `-c search_path=${SCHEMA} -c timezone=America/New_York`,
    });

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
      '0022_trip_locations.sql',
    ]) {
      await pool.query(await readFile(join(migrations, file), 'utf8'));
    }

    const database = poolAsDatabase(pool);

    const vehicles = new TripVehicleRepository(database);
    const customers = new TripCustomerRepository(database);

    trips = new TripScheduleService(
      database,
      new TripScheduleRepository(database),
      vehicles,
      customers,
      new TripStatusHistoryRepository(database),
      new TripLocationRepository(database),
    );
    catalogue = new TripCatalogueService(vehicles, customers, new TripLocationRepository(database));

    const users = new UserRepository(database);
    author = (await users.insertUser({ displayName: 'Điều Độ' })).id;
    driver = (await users.insertUser({ displayName: 'Tài Xế A', accountType: 'driver' })).id;
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
      `TRUNCATE trip_locations, trip_status_history, trip_completion_requests, trip_execution_events,
                trip_cost_edits, trip_costs, trip_outsource_hires,
                trip_driver_assignments, trip_schedules, trip_vehicles, trip_customers
       RESTART IDENTITY CASCADE`,
    );
  });

  // ------------------------------------------------------------ the day ----

  describe('★ the calendar day does not move', () => {
    it('reads back the day it was written, on a connection in another timezone', async () => {
      const created = await trips.create({ scheduledOn: '2026-08-04', createdBy: author });
      expect(created.scheduledOn).toBe('2026-08-04');

      const page = await trips.list(asQuery({}));
      expect(page.items[0]?.scheduledOn).toBe('2026-08-04');
    });

    it('holds at the month boundary, where a timezone slip is a different month', async () => {
      await trips.create({ scheduledOn: '2026-08-01', createdBy: author });
      await trips.create({ scheduledOn: '2026-08-31', createdBy: author });

      const days = (await trips.list(asQuery({}))).items.map((trip) => trip.scheduledOn);
      // A read through a `Date` in a UTC-5 connection would render both of these
      // one day earlier, moving the first out of August entirely.
      expect(days.sort()).toEqual(['2026-08-01', '2026-08-31']);
    });

    it('keeps a pickup and a delivery that fall on different days', async () => {
      // The workbook writes `08H30` for pickup and `09H00 SÁNG 04 AUG` for the
      // delivery of the same row. Both are stored; neither is flattened.
      const created = await trips.create({
        scheduledOn: '2026-08-03',
        pickupAt: new Date('2026-08-03T11:30:00Z'),
        deliveryAt: new Date('2026-08-04T02:00:00Z'),
        createdBy: author,
      });

      expect(created.pickupAt?.toISOString()).toBe('2026-08-03T11:30:00.000Z');
      expect(created.deliveryAt?.toISOString()).toBe('2026-08-04T02:00:00.000Z');
    });
  });

  // ------------------------------------------------------- the date range ----

  describe('the range filters, and the default is the current month', () => {
    beforeEach(async () => {
      for (const day of ['2026-07-31', '2026-08-01', '2026-08-15', '2026-08-31', '2026-09-01']) {
        await trips.create({ scheduledOn: day, createdBy: author });
      }
    });

    it('defaults to the month containing "now", and excludes its neighbours', async () => {
      const page = await trips.list(asQuery({}));

      expect(page.total).toBe(3);
      expect(page.items.map((trip) => trip.scheduledOn)).toEqual([
        '2026-08-31',
        '2026-08-15',
        '2026-08-01',
      ]);
    });

    it('includes both endpoints of an explicit range', async () => {
      const page = await trips.list(asQuery({ from: '2026-08-01', to: '2026-08-15' }));
      expect(page.items.map((trip) => trip.scheduledOn)).toEqual(['2026-08-15', '2026-08-01']);
    });

    it('orders newest first, which is how a board is read', async () => {
      const page = await trips.list(asQuery({ from: '2026-07-01', to: '2026-09-30' }));
      expect(page.items[0]?.scheduledOn).toBe('2026-09-01');
    });
  });

  // ---------------------------------------------------------- the crew filter ----

  /**
   * ★ THE QUEUE OF UNCREWED TRIPS, AND WHAT MAKES IT A QUEUE.
   *
   * A trip joins it when it is entered and leaves it the moment somebody is put
   * on the row — not when its status moves, which is a different axis entirely.
   * These cases are here rather than in a unit test because the claim is about
   * SQL: that the filter narrows the statement, so the page and its total
   * describe the same set, and that an ENDED assignment puts a trip back in the
   * queue rather than leaving it counted as crewed forever.
   */
  describe('★ filtering the board by whether anybody is driving', () => {
    let crewed: string;
    let bare: string;

    beforeEach(async () => {
      crewed = (await trips.create({ scheduledOn: '2026-08-10', createdBy: author })).id;
      bare = (await trips.create({ scheduledOn: '2026-08-11', createdBy: author })).id;
      await trips.create({ scheduledOn: '2026-08-12', createdBy: author });
      await crew(crewed);
    });

    it('returns every trip in the range when no filter is named', async () => {
      const page = await trips.list(asQuery({}));
      expect(page.total).toBe(3);
    });

    it('★ returns only the trips with nobody on them, and counts only those', async () => {
      const page = await trips.list(asQuery({ assignment: 'unassigned' }));

      expect(page.total).toBe(2);
      expect(page.items.map((trip) => trip.id)).not.toContain(crewed);
      expect(page.items.every((trip) => trip.driver === null)).toBe(true);
    });

    it('returns only the crewed trips, with the driver named', async () => {
      const page = await trips.list(asQuery({ assignment: 'assigned' }));

      expect(page.total).toBe(1);
      expect(page.items[0]?.id).toBe(crewed);
      expect(page.items[0]?.driver).toEqual({ id: driver, displayName: 'Tài Xế A' });
    });

    it('★ moves a trip out of the queue the moment a driver is put on it', async () => {
      await crew(bare);

      const queue = await trips.list(asQuery({ assignment: 'unassigned' }));
      expect(queue.total).toBe(1);
      expect(queue.items.map((trip) => trip.id)).not.toContain(bare);
    });

    it('★ puts it BACK in the queue when that assignment is ended', async () => {
      await pool.query(
        `UPDATE trip_driver_assignments
            SET state = 'ended', ended_at = now(), ended_by = $2, end_reason = 'nghỉ ốm'
          WHERE trip_id = $1`,
        [crewed, author],
      );

      const queue = await trips.list(asQuery({ assignment: 'unassigned' }));

      expect(queue.total).toBe(3);
      expect(queue.items.map((trip) => trip.id)).toContain(crewed);
    });

    it('★ counts the FILTERED set on a page past the end, not the whole range', async () => {
      // The recovery path: an empty page carries no `COUNT(*) OVER()`, so the
      // total is read separately — and it has to be the total of the same list,
      // or the client is sent to a page the filtered board does not have.
      const beyond = await trips.list(asQuery({ assignment: 'unassigned', page: '9', limit: '10' }));

      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(2);
      expect(beyond.totalPages).toBe(1);
    });

    it('leaves an archived trip out of the queue, like every other read', async () => {
      await trips.archive(bare, author);

      const queue = await trips.list(asQuery({ assignment: 'unassigned' }));

      expect(queue.total).toBe(1);
      expect(queue.items.map((trip) => trip.id)).not.toContain(bare);
    });
  });

  // -------------------------------------------------------- the page shape ----

  describe('paging a range', () => {
    beforeEach(async () => {
      // Every row on the SAME day, so the `id` tiebreaker is the only thing
      // making the order total. This is the case that loses or duplicates rows
      // when the ordering is not total.
      for (let index = 0; index < 25; index += 1) {
        await trips.create({ scheduledOn: '2026-08-04', cargoInfo: `row ${index}`, createdBy: author });
      }
    });

    it('★ walks every row exactly once, with no overlap and nothing missing', async () => {
      const seen: string[] = [];

      for (const page of [1, 2, 3]) {
        const result = await trips.list(asQuery({ page: String(page), limit: '10' }));
        seen.push(...result.items.map((trip) => trip.id));
        expect(result.total).toBe(25);
        expect(result.totalPages).toBe(3);
      }

      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
    });

    it('returns a short last page rather than padding it', async () => {
      const last = await trips.list(asQuery({ page: '3', limit: '10' }));
      expect(last.items).toHaveLength(5);
    });

    it('★ answers a page past the end with an empty page and the REAL total', async () => {
      // Not a 404: a client holding a stale page number recovers from
      // `totalPages`, which it can only do if the total survives.
      const beyond = await trips.list(asQuery({ page: '99', limit: '10' }));

      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(25);
      expect(beyond.totalPages).toBe(3);
    });

    it('reports no pages at all for an empty range, not "page 1 of 0"', async () => {
      const empty = await trips.list(asQuery({ from: '2020-01-01', to: '2020-01-31' }));
      expect(empty).toMatchObject({ items: [], total: 0, totalPages: 0 });
    });
  });

  // ------------------------------------------------------------ the joins ----

  describe('what a read carries', () => {
    it('spells out the vehicle, the customer and the author', async () => {
      const vehicle = await catalogue.createVehicle({ plate: '50H-49266', createdBy: author });
      const customer = await catalogue.createCustomer({ name: 'WWL', createdBy: author });

      await trips.create({
        scheduledOn: '2026-08-04',
        vehicleId: vehicle.id,
        customerId: customer.id,
        createdBy: author,
      });

      const [row] = (await trips.list(asQuery({}))).items;
      expect(row?.vehicle).toEqual({ id: vehicle.id, plate: '50H-49266' });
      expect(row?.customer).toEqual({ id: customer.id, name: 'WWL' });
      expect(row?.createdByUser).toEqual({ id: author, displayName: 'Điều Độ' });
    });

    it('★ still returns a trip with no vehicle assigned — the sheet’s `ĐIỀN SAU` row', async () => {
      // An INNER JOIN to the catalogue would make this row vanish from the
      // board, which is the opposite of what dispatch needs from it.
      await trips.create({ scheduledOn: '2026-08-04', createdBy: author });

      const [row] = (await trips.list(asQuery({}))).items;
      expect(row?.vehicle).toBeNull();
      expect(row?.customer).toBeNull();
      expect(row?.createdByUser.displayName).toBe('Điều Độ');
    });

    it('★ returns a trip with a truck but NO customer — an internal move', async () => {
      // 0011 makes `customer_id` nullable for its own reason, separate from
      // `ĐIỀN SAU`: a move between the company's own sites has no customer
      // behind it. The row above happens to have neither reference, so it
      // would still pass if the customer join were made INNER.
      const vehicle = await catalogue.createVehicle({ plate: '51C-123.45', createdBy: author });
      await trips.create({ scheduledOn: '2026-08-04', vehicleId: vehicle.id, createdBy: author });

      const [row] = (await trips.list(asQuery({}))).items;
      expect(row?.vehicle).toEqual({ id: vehicle.id, plate: '51C-123.45' });
      expect(row?.customer).toBeNull();
      expect(row?.customerId).toBeNull();
    });

    it('does not let the joined user clobber the trip’s own id', async () => {
      // What `SELECT *` across this join would do.
      const created = await trips.create({ scheduledOn: '2026-08-04', createdBy: author });
      const [row] = (await trips.list(asQuery({}))).items;

      expect(row?.id).toBe(created.id);
      expect(row?.id).not.toBe(author);
    });
  });

  // -------------------------------------------------------------- writing ----

  describe('correcting a row', () => {
    it('★ clears a field sent as null, and leaves an absent one alone', async () => {
      const created = await trips.create({
        scheduledOn: '2026-08-04',
        deliveryAddress: 'TCS',
        note: 'giữ nguyên',
        createdBy: author,
      });

      const updated = await trips.update(created.id, { deliveryAddress: null }, author);

      expect(updated.deliveryAddress).toBeNull();
      expect(updated.note).toBe('giữ nguyên');
    });

    it('stores a whitespace-only field as null rather than as an invisible value', async () => {
      const created = await trips.create({
        scheduledOn: '2026-08-04',
        cargoInfo: '   \n  ',
        createdBy: author,
      });
      expect(created.cargoInfo).toBeNull();
    });

    it('keeps the line breaks a workbook address actually has', async () => {
      const address = 'WENDELBO SEA JSC\nLô CN17, Đường D1\nKCN Sóng Thần 3';
      const created = await trips.create({
        scheduledOn: '2026-08-04',
        deliveryAddress: address,
        createdBy: author,
      });
      expect(created.deliveryAddress).toBe(address);
    });

    it('refuses a trip pointing at a retired vehicle', async () => {
      const vehicle = await catalogue.createVehicle({ plate: '51D-60088', createdBy: author });
      await catalogue.archiveVehicle(vehicle.id);

      await expect(
        trips.create({ scheduledOn: '2026-08-04', vehicleId: vehicle.id, createdBy: author }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('refuses a trip pointing at a retired customer', async () => {
      // The twin of the case above, and it is NOT covered by it: `resolve()`
      // checks the two catalogues in two separate branches, so a regression
      // that dropped the customer half would leave the vehicle test green.
      const customer = await catalogue.createCustomer({ name: 'VIỄN ĐẠT', createdBy: author });
      await catalogue.archiveCustomer(customer.id);

      await expect(
        trips.create({ scheduledOn: '2026-08-04', customerId: customer.id, createdBy: author }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('refuses a vehicle id that names nothing', async () => {
      await expect(
        trips.create({
          scheduledOn: '2026-08-04',
          vehicleId: '00000000-0000-4000-8000-000000000000',
          createdBy: author,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  /**
   * ★ RETIRING A TRUCK MUST NOT FREEZE THE TRIPS THAT USED IT.
   *
   * Archiving is chosen over deleting precisely so the record survives, and a
   * record that can no longer be corrected is only half a record. `update()`
   * merges the patch onto the stored row, so the merged row still names the
   * retired truck — and re-checking it against the catalogue turned every
   * historical trip into a 409 on any edit at all, including a typo in a note.
   *
   * The line these cases hold: an UNCHANGED reference is kept, a CHANGED one is
   * still checked (F-002).
   */
  describe('★ a reference already on the row survives its catalogue row being retired', () => {
    it('edits a trip whose vehicle has since been retired, and keeps the vehicle', async () => {
      const vehicle = await catalogue.createVehicle({ plate: '50H-49266', createdBy: author });
      const trip = await trips.create({
        scheduledOn: '2026-08-04',
        vehicleId: vehicle.id,
        note: 'trước',
        createdBy: author,
      });

      await catalogue.archiveVehicle(vehicle.id);

      const updated = await trips.update(trip.id, { note: 'sau' }, author);

      expect(updated.note).toBe('sau');
      // The historical assignment is intact — not cleared, not swapped.
      expect(updated.vehicleId).toBe(vehicle.id);
    });

    it('edits a trip whose customer has since been retired, and keeps the customer', async () => {
      const customer = await catalogue.createCustomer({ name: 'WWL', createdBy: author });
      const trip = await trips.create({
        scheduledOn: '2026-08-04',
        customerId: customer.id,
        createdBy: author,
      });

      await catalogue.archiveCustomer(customer.id);

      const updated = await trips.update(trip.id, { cargoInfo: '17CTN / 1.22CBM' }, author);

      expect(updated.cargoInfo).toBe('17CTN / 1.22CBM');
      expect(updated.customerId).toBe(customer.id);
    });

    it('keeps BOTH retired references through an edit that mentions neither', async () => {
      const vehicle = await catalogue.createVehicle({ plate: '51D.65233', createdBy: author });
      const customer = await catalogue.createCustomer({ name: 'VIỄN ĐẠT', createdBy: author });
      const trip = await trips.create({
        scheduledOn: '2026-08-04',
        vehicleId: vehicle.id,
        customerId: customer.id,
        createdBy: author,
      });

      await catalogue.archiveVehicle(vehicle.id);
      await catalogue.archiveCustomer(customer.id);

      // `external_booking` rather than `done`: this case is about RETIRED
      // REFERENCES surviving an edit, and any status change demonstrates that
      // equally well. `done` is no longer reachable from the edit path at all —
      // 0017 makes it permanent, so completing a trip belongs to the completion
      // approval and to nothing else.
      const updated = await trips.update(trip.id, { status: 'external_booking' }, author);

      expect(updated.status).toBe('external_booking');
      expect(updated.vehicleId).toBe(vehicle.id);
      expect(updated.customerId).toBe(customer.id);
    });

    it('re-sending the SAME retired id explicitly is still not a change', async () => {
      // The form sends every field on every save, so the retired id arrives in
      // the body rather than being absent. That has to read as "unchanged", not
      // as "assign this retired truck".
      const vehicle = await catalogue.createVehicle({ plate: '50H-27314', createdBy: author });
      const trip = await trips.create({
        scheduledOn: '2026-08-04',
        vehicleId: vehicle.id,
        createdBy: author,
      });
      await catalogue.archiveVehicle(vehicle.id);

      const updated = await trips.update(trip.id, { vehicleId: vehicle.id, note: 'sau' }, author);

      expect(updated.vehicleId).toBe(vehicle.id);
      expect(updated.note).toBe('sau');
    });

    it('★ still refuses assigning a DIFFERENT retired vehicle — F-002 is intact', async () => {
      const inUse = await catalogue.createVehicle({ plate: '50H-49266', createdBy: author });
      const retired = await catalogue.createVehicle({ plate: '51C-123.45', createdBy: author });
      await catalogue.archiveVehicle(retired.id);

      const trip = await trips.create({
        scheduledOn: '2026-08-04',
        vehicleId: inUse.id,
        note: 'trước',
        createdBy: author,
      });

      await expect(
        trips.update(trip.id, { vehicleId: retired.id }, author),
      ).rejects.toBeInstanceOf(ConflictError);

      // The refusal is a refusal: the transaction rolled back and nothing moved.
      const after = await trips.findById(trip.id);
      expect(after?.vehicleId).toBe(inUse.id);
      expect(after?.note).toBe('trước');
    });

    it('★ still refuses assigning a DIFFERENT retired customer — F-002 is intact', async () => {
      const inUse = await catalogue.createCustomer({ name: 'WWL', createdBy: author });
      const retired = await catalogue.createCustomer({ name: 'BLUE WATER', createdBy: author });
      await catalogue.archiveCustomer(retired.id);

      const trip = await trips.create({
        scheduledOn: '2026-08-04',
        customerId: inUse.id,
        createdBy: author,
      });

      await expect(
        trips.update(trip.id, { customerId: retired.id }, author),
      ).rejects.toBeInstanceOf(ConflictError);

      const after = await trips.findById(trip.id);
      expect(after?.customerId).toBe(inUse.id);
    });

    it('refuses a retired vehicle on a trip that had none — nothing to preserve', async () => {
      // The exemption is about a reference the row ALREADY held. Going from
      // null to a retired truck is a new assignment like any other.
      const retired = await catalogue.createVehicle({ plate: '51D-60088', createdBy: author });
      await catalogue.archiveVehicle(retired.id);

      const trip = await trips.create({ scheduledOn: '2026-08-04', createdBy: author });

      await expect(
        trips.update(trip.id, { vehicleId: retired.id }, author),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('lets a retired reference be CLEARED, which was always legal', async () => {
      // Null semantics are untouched by the fix: the catalogue is never
      // consulted for a reference that is being removed.
      const vehicle = await catalogue.createVehicle({ plate: '50H44266', createdBy: author });
      const trip = await trips.create({
        scheduledOn: '2026-08-04',
        vehicleId: vehicle.id,
        createdBy: author,
      });
      await catalogue.archiveVehicle(vehicle.id);

      const updated = await trips.update(trip.id, { vehicleId: null }, author);

      expect(updated.vehicleId).toBeNull();
    });

    it('lets the retired reference be replaced by an ACTIVE one', async () => {
      const retired = await catalogue.createVehicle({ plate: '50H44266', createdBy: author });
      const replacement = await catalogue.createVehicle({ plate: '50H49266', createdBy: author });
      const trip = await trips.create({
        scheduledOn: '2026-08-04',
        vehicleId: retired.id,
        createdBy: author,
      });
      await catalogue.archiveVehicle(retired.id);

      const updated = await trips.update(trip.id, { vehicleId: replacement.id }, author);

      expect(updated.vehicleId).toBe(replacement.id);
    });
  });

  /**
   * ★ BD-01 — `done` IS TERMINAL, AND NOTHING ELSE IS CONSTRAINED.
   *
   * The one transition rule the business has settled. The other four statuses
   * come from the workbook's colour legend and are NOT a pipeline: two of them
   * leave the line entirely (`external_booking` is a route, `needs_confirmation`
   * an exception reachable from anywhere), so moves between them stay free.
   * These cases pin both halves — the rule that exists, and the freedom that
   * deliberately still exists around it.
   */
  describe('★ BD-01 — `done` is terminal, and the board cannot reach it', () => {
    const OTHERS = [
      'awaiting_production',
      'awaiting_vehicle',
      'needs_confirmation',
      'external_booking',
    ] as const;

    const tripWith = async (status: TripStatus) =>
      trips.create({ scheduledOn: '2026-08-04', status, createdBy: author });

    /**
     * A finished trip, seeded directly.
     *
     * ★ WHY SQL AND NOT THE SERVICE. `done` is reached by APPROVING A
     * COMPLETION REQUEST and by nothing else — the service refuses to write it
     * from here, which is the rule three of the cases below exist to prove. The
     * state is real and reachable in production; this spec simply has no
     * completion service wired, so the row is put into it directly. The trigger
     * guards LEAVING `done`, not entering it, so this is exactly what an
     * approval leaves behind.
     */
    const doneTrip = async () => {
      const trip = await tripWith('awaiting_vehicle');
      await pool.query("UPDATE trip_schedules SET status = 'done' WHERE id = $1", [trip.id]);
      return trip;
    };

    describe('★ reaching done — refused, whichever door is used', () => {
      it('refuses it through the status endpoint', async () => {
        const trip = await tripWith('awaiting_vehicle');

        await expect(trips.updateStatus(trip.id, 'done', author)).rejects.toBeInstanceOf(
          ConflictError,
        );

        expect((await trips.findById(trip.id))?.status).toBe('awaiting_vehicle');
      });

      it('refuses it through the FULL PATCH too — the rule is not bypassable', async () => {
        const trip = await tripWith('awaiting_vehicle');

        await expect(trips.update(trip.id, { status: 'done' }, author)).rejects.toBeInstanceOf(
          ConflictError,
        );

        expect((await trips.findById(trip.id))?.status).toBe('awaiting_vehicle');
      });

      it('★ refuses a trip BORN done — a trip cannot be created closed', async () => {
        // No completion request, no approver, no frozen figures, and — because
        // the trigger makes `done` permanent — no way back.
        await expect(tripWith('done')).rejects.toBeInstanceOf(ConflictError);
      });
    });

    describe('★ leaving done — refused, whichever door is used', () => {
      it.each(OTHERS)('refuses done → %s through the status endpoint', async (to) => {
        const trip = await doneTrip();

        await expect(trips.updateStatus(trip.id, to, author)).rejects.toBeInstanceOf(ConflictError);

        // Refused means unchanged, not partially applied.
        expect((await trips.findById(trip.id))?.status).toBe('done');
      });

      it('refuses it through the FULL PATCH too', async () => {
        // Guarding only `updateStatus` would leave the edit form as an open
        // second door onto the same column.
        const trip = await doneTrip();

        await expect(trips.update(trip.id, { status: 'awaiting_vehicle' }, author)).rejects.toBeInstanceOf(
          ConflictError,
        );

        expect((await trips.findById(trip.id))?.status).toBe('done');
      });

      it('★ rolls the WHOLE edit back, not just the status', async () => {
        // The refusal happens inside the transaction, so a patch that also
        // carried legitimate field edits must leave none of them behind.
        const trip = await doneTrip();
        await trips.update(trip.id, { note: 'trước' }, author);

        await expect(
          trips.update(trip.id, { status: 'awaiting_vehicle', note: 'sau', cargoInfo: '17CTN' }, author),
        ).rejects.toBeInstanceOf(ConflictError);

        const after = await trips.findById(trip.id);
        expect(after?.status).toBe('done');
        expect(after?.note).toBe('trước');
        expect(after?.cargoInfo).toBeNull();
      });
    });

    describe('what the rule does NOT forbid', () => {
      it('★ still edits every OTHER field of a finished trip', async () => {
        // Only the STATUS is frozen. Whether a finished trip should be
        // otherwise read-only is a separate decision nobody has taken, so
        // correcting a delivery address on it stays legal.
        const trip = await doneTrip();

        const updated = await trips.update(
          trip.id,
          { note: 'giao lúc 18h', deliveryAddress: 'TCS' },
          author,
        );

        expect(updated.note).toBe('giao lúc 18h');
        expect(updated.deliveryAddress).toBe('TCS');
        expect(updated.status).toBe('done');
      });

      it('★ leaves the four non-terminal statuses freely interchangeable', async () => {
        // Deliberately NOT a pipeline. Walking them in an order the legend does
        // not describe must succeed, or somebody has invented a workflow.
        const trip = await tripWith('awaiting_production');

        for (const next of [
          'external_booking',
          'needs_confirmation',
          'awaiting_production',
          'awaiting_vehicle',
        ] as const) {
          const moved = await trips.updateStatus(trip.id, next, author);
          expect(moved.status).toBe(next);
        }
      });
    });

    describe('interaction with the rules that already existed', () => {
      it('answers 404 for an archived trip before it ever considers the status', async () => {
        const trip = await tripWith('awaiting_vehicle');
        await trips.archive(trip.id, author);

        await expect(
          trips.updateStatus(trip.id, 'needs_confirmation', author),
        ).rejects.toBeInstanceOf(NotFoundError);
      });

      it('answers 404 for a trip that never existed', async () => {
        await expect(
          trips.updateStatus('00000000-0000-4000-8000-000000000000', 'needs_confirmation', author),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    /**
     * ★ THE RACE THE LOCK EXISTS FOR.
     *
     * `updateStatus` used to be one unconditional UPDATE. A rule that depends
     * on where the row already IS turns it into read-then-write, and without
     * `FOR UPDATE` two callers could both read a stale status and both write.
     */
    it('★ serialises two concurrent moves away from a finished trip — both refused', async () => {
      const trip = await doneTrip();

      const results = await Promise.allSettled([
        trips.updateStatus(trip.id, 'awaiting_vehicle', author),
        trips.updateStatus(trip.id, 'external_booking', author),
      ]);

      // ★ NEITHER MAY WIN. Whichever order the lock granted, both read a row
      // that was already `done` and both are refused — there is no interleaving
      // in which one of them sees a non-terminal status.
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      expect((await trips.findById(trip.id))?.status).toBe('done');
    });

    it('★ serialises two concurrent LEGAL moves, losing neither', async () => {
      const trip = await tripWith('awaiting_production');

      const results = await Promise.allSettled([
        trips.updateStatus(trip.id, 'awaiting_vehicle', author),
        trips.updateStatus(trip.id, 'external_booking', author),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      // The row holds whichever landed second; both were legal in either order.
      expect(['awaiting_vehicle', 'external_booking']).toContain(
        (await trips.findById(trip.id))?.status,
      );
    });
  });

  describe('archiving', () => {
    it('takes the row off every page without destroying it', async () => {
      const created = await trips.create({ scheduledOn: '2026-08-04', createdBy: author });
      await trips.archive(created.id, author);

      expect((await trips.list(asQuery({}))).total).toBe(0);

      // Still there, with both archive columns set — the CHECK would have
      // refused a half-set pair.
      const rows = await pool.query(
        'SELECT archived_at, archived_by FROM trip_schedules WHERE id = $1',
        [created.id],
      );
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0].archived_at).not.toBeNull();
      expect(rows.rows[0].archived_by).toBe(author);
    });

    it('answers the second archive the same way as one that never existed', async () => {
      const created = await trips.create({ scheduledOn: '2026-08-04', createdBy: author });
      await trips.archive(created.id, author);

      await expect(trips.archive(created.id, author)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('refuses to correct an archived row', async () => {
      const created = await trips.create({ scheduledOn: '2026-08-04', createdBy: author });
      await trips.archive(created.id, author);

      await expect(trips.update(created.id, { note: 'x' }, author)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ------------------------------------------------------------ catalogue ----

  describe('★ the catalogue refuses the workbook’s real duplicates', () => {
    it.each([['51D 65233'], ['51d-65233'], ['51D65233'], ['  51D.65233  ']])(
      'refuses %s once 51D.65233 exists',
      async (variant) => {
        await catalogue.createVehicle({ plate: '51D.65233', createdBy: author });
        await expect(
          catalogue.createVehicle({ plate: variant, createdBy: author }),
        ).rejects.toBeInstanceOf(ConflictError);
      },
    );

    it('names the spelling already in the catalogue, which is the useful part', async () => {
      await catalogue.createVehicle({ plate: '51D.65233', createdBy: author });

      await expect(
        catalogue.createVehicle({ plate: '51D 65233', createdBy: author }),
      ).rejects.toThrow(/51D\.65233/);
    });

    it('still accepts a genuinely different plate', async () => {
      await catalogue.createVehicle({ plate: '50H44266', createdBy: author });
      const other = await catalogue.createVehicle({ plate: '50H49266', createdBy: author });
      expect(other.plate).toBe('50H49266');
    });

    it('collapses case and runs of whitespace in a customer name', async () => {
      await catalogue.createCustomer({ name: 'BLUE WATER', createdBy: author });
      await expect(
        catalogue.createCustomer({ name: 'blue   water', createdBy: author }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('⚠ does NOT merge two different diacritics — the documented limit', async () => {
      // `VIỄN ĐẠT` and `VIẼN ĐẠT` are different Unicode strings and could be two
      // real companies. What prevents that pair is the dropdown, not the index.
      await catalogue.createCustomer({ name: 'VIỄN ĐẠT', createdBy: author });
      const other = await catalogue.createCustomer({ name: 'VIẼN ĐẠT', createdBy: author });
      expect(other.name).toBe('VIẼN ĐẠT');
    });

    it('frees the plate again once the vehicle is retired', async () => {
      const first = await catalogue.createVehicle({ plate: '51D.65233', createdBy: author });
      await catalogue.archiveVehicle(first.id);

      const reissued = await catalogue.createVehicle({ plate: '51D-65233', createdBy: author });
      expect(reissued.id).not.toBe(first.id);
    });

    it('hides retired rows from the list unless they are asked for', async () => {
      const vehicle = await catalogue.createVehicle({ plate: '50H-27314', createdBy: author });
      await catalogue.archiveVehicle(vehicle.id);

      expect(await catalogue.listVehicles(false)).toEqual([]);
      expect(await catalogue.listVehicles(true)).toHaveLength(1);
    });

    it('retires a customer, and hides it from the list unless asked for', async () => {
      // The vehicle twin of this is tested above. Both are needed: the two
      // catalogues are two repository classes with two literal statements —
      // deliberately not one generic one — so neither covers the other.
      const customer = await catalogue.createCustomer({ name: 'BLUE WATER', createdBy: author });
      const archived = await catalogue.archiveCustomer(customer.id);

      expect(archived.status).toBe('archived');
      expect(await catalogue.listCustomers(false)).toEqual([]);
      expect(await catalogue.listCustomers(true)).toHaveLength(1);
    });

    it('frees the customer name again once the row is retired', async () => {
      // ★ THE TWO NAMES MUST NORMALISE TO THE SAME KEY, or this proves
      // nothing. `name_key` collapses runs of whitespace and upper-cases, so
      // `WWL` and `W W L` are two DIFFERENT keys — an earlier version of this
      // test used that pair and passed whether or not archived rows were
      // exempt from the uniqueness check. `WWL` and `  wwl  ` both normalise to
      // `WWL`, so the second insert is refused unless retiring the first one
      // really did free the name.
      const first = await catalogue.createCustomer({ name: 'WWL', createdBy: author });
      await catalogue.archiveCustomer(first.id);

      const reissued = await catalogue.createCustomer({ name: '  wwl  ', createdBy: author });

      // It genuinely resolved: a live row, not a rejection swallowed somewhere.
      expect(reissued.status).toBe('active');
      // Stored as typed, minus the surrounding whitespace — formatting is the
      // user's, only matching is ours.
      expect(reissued.name).toBe('wwl');
      expect(reissued.id).not.toBe(first.id);
      // And the retired row is still there, still archived: this is a reuse of
      // the name, not a resurrection of the row.
      const archived = (await catalogue.listCustomers(true)).find((row) => row.id === first.id);
      expect(archived?.status).toBe('archived');
    });

    it('refuses a rename that collides with another active row', async () => {
      await catalogue.createVehicle({ plate: '50H44266', createdBy: author });
      const second = await catalogue.createVehicle({ plate: '50H49266', createdBy: author });

      await expect(
        catalogue.updateVehicle(second.id, { plate: '50H-44266' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('allows a rename that only changes the row’s own punctuation', async () => {
      const vehicle = await catalogue.createVehicle({ plate: '50H44266', createdBy: author });
      const renamed = await catalogue.updateVehicle(vehicle.id, { plate: '50H-44266' });
      expect(renamed.plate).toBe('50H-44266');
    });
  });
});
