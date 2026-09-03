import { Pool } from 'pg';
import { TEST_URL, applyAllMigrations, openTestSchema, poolAsDatabase } from '../helpers/integration-database';
import type { Database } from '@common/types/database.port';
import { ConflictError, NotFoundError, ValidationError } from '@common/errors/domain.error';
import { UserRepository } from '@core/users/persistence/user.repository';
import { TripCatalogueService } from '../../src/capabilities/trip-schedule/application/trip-catalogue.service';
import { TripScheduleService } from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import {
  TripCustomerRepository,
  TripLocationRepository,
  TripVehicleRepository,
} from '../../src/capabilities/trip-schedule/persistence/trip-catalogue.repository';
import { TripScheduleRepository } from '../../src/capabilities/trip-schedule/persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from '../../src/capabilities/trip-schedule/persistence/trip-status-history.repository';
import { DriverTripReadModelRepository } from '../../src/capabilities/trip-schedule/persistence/driver-read-model.repository';

/**
 * A customer's places, against a real PostgreSQL.
 *
 * ★ TWO THINGS ONLY A SERVER CAN PROVE: that the trip's snapshot is a COPY —
 * changing the master row later leaves the trip where it was — and that the
 * ownership and coordinate rules hold at the constraint, not only in the
 * service. Everything about who may call which route is in the security
 * spec; this is about what lands in rows.
 */
const SCHEMA = 'trip_location_itest';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const RESTRICT_VIOLATION = '23001';
const FOREIGN_KEY_VIOLATION = '23503';

const describeIfDatabase = TEST_URL ? describe : describe.skip;

describeIfDatabase('Customer locations against real PostgreSQL', () => {
  let pool: Pool;
  let database: Database;
  let catalogue: TripCatalogueService;
  let board: TripScheduleService;
  let locations: TripLocationRepository;
  let driverView: DriverTripReadModelRepository;

  let operator: string;
  let customerA: string;
  let customerB: string;

  const codeOf = async (work: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      await work();
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };

  const sql = async (text: string, params: readonly unknown[] = []): Promise<unknown[]> =>
    (await pool.query(text, params as unknown[])).rows;

  beforeAll(async () => {
    pool = await openTestSchema(TEST_URL as string, SCHEMA);

    // Every migration, in order: this spec spans the customer catalogue, the
    // trip, the driver's view and the new places, so nothing can be left out.
    await applyAllMigrations(pool);

    database = poolAsDatabase(pool);

    const vehicles = new TripVehicleRepository(database);
    const customers = new TripCustomerRepository(database);
    locations = new TripLocationRepository(database);
    catalogue = new TripCatalogueService(vehicles, customers, locations);
    board = new TripScheduleService(
      database,
      new TripScheduleRepository(database),
      vehicles,
      customers,
      new TripStatusHistoryRepository(database),
      locations,
    );
    driverView = new DriverTripReadModelRepository(database);

    operator = (await new UserRepository(database).insertUser({ displayName: 'Điều Độ' })).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE trip_locations, trip_status_history, trip_driver_assignments, trip_schedules,
                trip_customers RESTART IDENTITY CASCADE`,
    );
    customerA = (await catalogue.createCustomer({ name: 'Customer A', createdBy: operator })).id;
    customerB = (await catalogue.createCustomer({ name: 'Customer B', createdBy: operator })).id;
  });

  const OSC = { latitude: 10.8188, longitude: 106.6564 };

  const place = (customerId: string, name: string, over: Record<string, unknown> = {}) =>
    catalogue.createLocation(customerId, {
      name,
      address: `${name}, Bình Dương`,
      contact: '0909 000 111',
      createdBy: operator,
      ...over,
    });

  // ================================================================ master ==

  describe('the master row', () => {
    it('is created under its customer, unlocated by default', async () => {
      const kho = await place(customerA, 'Kho OSC');

      expect(kho).toMatchObject({ customerId: customerA, name: 'Kho OSC', latitude: null, longitude: null, status: 'active' });
      expect(await catalogue.listLocations(customerA, false)).toHaveLength(1);
    });

    it('★ is never listed under another customer', async () => {
      await place(customerA, 'Kho OSC');

      expect(await catalogue.listLocations(customerB, false)).toHaveLength(0);
    });

    it('★ answers another customer’s id as not found — for edit and for archive alike', async () => {
      const kho = await place(customerA, 'Kho OSC');

      await expect(catalogue.updateLocation(customerB, kho.id, { name: 'x' })).rejects.toThrow(NotFoundError);
      await expect(catalogue.archiveLocation(customerB, kho.id)).rejects.toThrow(NotFoundError);
      expect((await catalogue.listLocations(customerA, false))[0]).toMatchObject({ name: 'Kho OSC', status: 'active' });
    });

    it('refuses a customer that does not exist', async () => {
      await expect(place('00000000-0000-4000-8000-000000000000', 'Kho')).rejects.toThrow(NotFoundError);
    });

    it('★ refuses a duplicate name under the same customer, by the same normalisation as the index', async () => {
      await place(customerA, 'Kho OSC');
      await expect(place(customerA, '  kho   osc ')).rejects.toThrow(ConflictError);
      // A different customer may well have a warehouse of the same name.
      await expect(place(customerB, 'Kho OSC')).resolves.toBeTruthy();
    });

    it('lets an archived name be reused, and keeps the archived row readable', async () => {
      const first = await place(customerA, 'Kho OSC');
      await catalogue.archiveLocation(customerA, first.id);

      await expect(place(customerA, 'Kho OSC')).resolves.toBeTruthy();
      expect(await catalogue.listLocations(customerA, false)).toHaveLength(1);
      expect(await catalogue.listLocations(customerA, true)).toHaveLength(2);
      await expect(catalogue.updateLocation(customerA, first.id, { note: 'x' })).rejects.toThrow(ConflictError);
    });

    it.each([
      ['half a point', { latitude: 10.8 }],
      ['the other half', { longitude: 106.6 }],
      ['a latitude off the planet', { latitude: 91, longitude: 106.6 }],
      ['a longitude off the planet', { latitude: 10.8, longitude: 180.5 }],
      ['NaN', { latitude: Number.NaN, longitude: 106.6 }],
      ['Infinity', { latitude: 10.8, longitude: Number.POSITIVE_INFINITY }],
    ])('refuses %s with a sentence, before the row is written', async (_label, coords) => {
      await expect(place(customerA, 'Kho', coords)).rejects.toThrow(ValidationError);
      expect(await catalogue.listLocations(customerA, false)).toHaveLength(0);
    });

    it('accepts the edges of both axes', async () => {
      const edge = await place(customerA, 'Edge', { latitude: -90, longitude: 180 });
      expect(edge).toMatchObject({ latitude: -90, longitude: 180 });
    });

    it('★ refuses half a point and NaN at the constraint too, for any writer', async () => {
      const kho = await place(customerA, 'Kho OSC');
      expect(await codeOf(() => sql(`UPDATE trip_locations SET latitude = 10 WHERE id = $1`, [kho.id]))).toBe(CHECK_VIOLATION);
      expect(
        await codeOf(() => sql(`UPDATE trip_locations SET latitude = 'NaN'::double precision, longitude = 106 WHERE id = $1`, [kho.id])),
      ).toBe(CHECK_VIOLATION);
      expect(
        await codeOf(() =>
          sql(`INSERT INTO trip_locations (customer_id, name, address, created_by) VALUES ($1, 'Kho OSC', 'x', $2)`, [customerA, operator]),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it('cannot be deleted, and a trip’s reference holds it', async () => {
      const kho = await place(customerA, 'Kho OSC', OSC);
      await board.create({ scheduledOn: '2026-09-01', customerId: customerA, pickupLocationId: kho.id, createdBy: operator });

      expect(await codeOf(() => sql(`DELETE FROM trip_locations WHERE id = $1`, [kho.id]))).toBe(RESTRICT_VIOLATION);
      expect(
        await codeOf(() =>
          sql(`UPDATE trip_schedules SET pickup_location_id = gen_random_uuid() WHERE pickup_location_id = $1`, [kho.id]),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  // ============================================================== snapshot ==

  describe('★ the trip snapshots the place', () => {
    it('copies address, contact and coordinates onto the trip, and records where from', async () => {
      const kho = await place(customerA, 'Kho OSC', OSC);
      const nhaMay = await place(customerA, 'Nhà máy Bình Dương', { contact: null });

      const trip = await board.create({
        scheduledOn: '2026-09-01',
        customerId: customerA,
        pickupLocationId: kho.id,
        deliveryLocationId: nhaMay.id,
        createdBy: operator,
      });

      expect(trip).toMatchObject({
        pickupLocationId: kho.id,
        pickupAddress: 'Kho OSC, Bình Dương',
        pickupContact: '0909 000 111',
        pickupLatitude: OSC.latitude,
        pickupLongitude: OSC.longitude,
        deliveryLocationId: nhaMay.id,
        deliveryAddress: 'Nhà máy Bình Dương, Bình Dương',
        deliveryContact: null,
        deliveryLatitude: null,
        deliveryLongitude: null,
      });
      // The board read carries the place by name.
      const read = await board.findById(trip.id);
      expect(read.pickupLocation).toEqual({ id: kho.id, name: 'Kho OSC' });
    });

    it('★ is a COPY: editing the place afterwards leaves the trip where it was, and a new trip takes the new value', async () => {
      const kho = await place(customerA, 'Kho OSC', OSC);
      const before = await board.create({ scheduledOn: '2026-09-01', customerId: customerA, pickupLocationId: kho.id, createdBy: operator });

      await catalogue.updateLocation(customerA, kho.id, { latitude: 10.9, longitude: 106.7, address: 'Kho OSC (mới)' });

      const unchanged = await board.findById(before.id);
      expect(unchanged).toMatchObject({ pickupLatitude: OSC.latitude, pickupLongitude: OSC.longitude, pickupAddress: 'Kho OSC, Bình Dương' });

      const after = await board.create({ scheduledOn: '2026-09-02', customerId: customerA, pickupLocationId: kho.id, createdBy: operator });
      expect(after).toMatchObject({ pickupLatitude: 10.9, pickupLongitude: 106.7, pickupAddress: 'Kho OSC (mới)' });
    });

    it('★ refuses a place that belongs to another customer, whatever the client sent', async () => {
      const khoB = await place(customerB, 'Kho B', OSC);

      await expect(
        board.create({ scheduledOn: '2026-09-01', customerId: customerA, pickupLocationId: khoB.id, createdBy: operator }),
      ).rejects.toThrow(ValidationError);
      // And with no customer at all there is nobody the place could belong to.
      await expect(
        board.create({ scheduledOn: '2026-09-01', pickupLocationId: khoB.id, createdBy: operator }),
      ).rejects.toThrow(ValidationError);
      expect(await sql(`SELECT 1 FROM trip_schedules`)).toHaveLength(0);
    });

    it('refuses an archived place for a new trip, but an existing trip keeps its snapshot', async () => {
      const kho = await place(customerA, 'Kho OSC', OSC);
      const trip = await board.create({ scheduledOn: '2026-09-01', customerId: customerA, pickupLocationId: kho.id, createdBy: operator });
      await catalogue.archiveLocation(customerA, kho.id);

      await expect(
        board.create({ scheduledOn: '2026-09-02', customerId: customerA, pickupLocationId: kho.id, createdBy: operator }),
      ).rejects.toThrow(ConflictError);
      const kept = await board.findById(trip.id);
      expect(kept).toMatchObject({ pickupLocationId: kho.id, pickupLatitude: OSC.latitude, pickupAddress: 'Kho OSC, Bình Dương' });
      expect(kept.pickupLocation).toEqual({ id: kho.id, name: 'Kho OSC' });
    });

    it('★ refuses a place beside coordinates for the same end — the place is the source', async () => {
      const kho = await place(customerA, 'Kho OSC', OSC);
      await expect(
        board.create({
          scheduledOn: '2026-09-01',
          customerId: customerA,
          pickupLocationId: kho.id,
          pickupLatitude: 1,
          pickupLongitude: 1,
          createdBy: operator,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('re-snapshots on update only when the place is named in the patch', async () => {
      const kho = await place(customerA, 'Kho OSC', OSC);
      const other = await place(customerA, 'Kho Thủ Dầu Một', { latitude: 11.0, longitude: 106.65 });
      const trip = await board.create({ scheduledOn: '2026-09-01', customerId: customerA, pickupLocationId: kho.id, createdBy: operator });
      await catalogue.updateLocation(customerA, kho.id, { latitude: 10.9, longitude: 106.7 });

      // A note edit: last week's snapshot stands, master change or not.
      const noted = await board.update(trip.id, { note: 'gọi trước' }, operator);
      expect(noted).toMatchObject({ pickupLatitude: OSC.latitude, pickupLocationId: kho.id });

      // Naming a different place: copied afresh.
      const moved = await board.update(trip.id, { pickupLocationId: other.id }, operator);
      expect(moved).toMatchObject({
        pickupLocationId: other.id,
        pickupAddress: 'Kho Thủ Dầu Một, Bình Dương',
        pickupLatitude: 11.0,
        pickupLongitude: 106.65,
      });

      // Clearing the place: the end becomes free text and its coordinates go.
      const cleared = await board.update(trip.id, { pickupLocationId: null, pickupAddress: 'Bãi tạm' }, operator);
      expect(cleared).toMatchObject({ pickupLocationId: null, pickupAddress: 'Bãi tạm', pickupLatitude: null, pickupLongitude: null });
    });

    it('★ reaches the driver as the snapshot, not the master — and unlocated stays DESTINATION_MISSING material', async () => {
      const located = await place(customerA, 'Kho OSC', OSC);
      const unlocated = await place(customerA, 'Nhà máy');
      const trip = await board.create({
        scheduledOn: '2026-09-01',
        customerId: customerA,
        pickupLocationId: located.id,
        deliveryLocationId: unlocated.id,
        createdBy: operator,
      });
      const driver = (await new UserRepository(database).insertUser({ displayName: 'Tài Xế', accountType: 'driver' })).id;
      await sql(`INSERT INTO trip_driver_assignments (trip_id, driver_user_id, assigned_by) VALUES ($1, $2, $3)`, [trip.id, driver, operator]);

      const seen = await driverView.findForDriver(trip.id, driver);
      expect(seen?.pickupLocation).toEqual(OSC);
      expect(seen?.deliveryLocation).toBeNull();
      expect(seen?.pickupAddress).toBe('Kho OSC, Bình Dương');
      // Nothing about the master row, its ids or its customer's other places.
      expect(seen).not.toHaveProperty('pickupLocationId');
    });

    it('leaves a trip typed without places exactly as before 0022', async () => {
      const trip = await board.create({
        scheduledOn: '2026-09-01',
        customerId: customerA,
        pickupAddress: 'Gõ tay',
        pickupLatitude: OSC.latitude,
        pickupLongitude: OSC.longitude,
        createdBy: operator,
      });
      expect(trip).toMatchObject({ pickupLocationId: null, pickupAddress: 'Gõ tay', pickupLatitude: OSC.latitude });
      expect((await board.findById(trip.id)).pickupLocation).toBeNull();
    });
  });

  // ======================================================= customer change ==

  /**
   * ★ A TRIP MOVED TO ANOTHER CUSTOMER CANNOT KEEP THE FIRST CUSTOMER'S
   * PLACES. Every end that still names a place is re-examined against the new
   * customer; the caller clears or replaces them in the same patch. Nothing
   * is dropped silently, and nothing of customer A's is ever left on a trip
   * that now says customer B.
   */
  describe('★ changing the customer of a trip that names places', () => {
    const arranged = async () => {
      const khoA = await place(customerA, 'Kho A', OSC);
      const nhaMayA = await place(customerA, 'Nhà máy A', { latitude: 10.9, longitude: 106.7 });
      const khoB = await place(customerB, 'Kho B', { latitude: 11.0, longitude: 106.65 });
      const trip = await board.create({
        scheduledOn: '2026-09-01',
        customerId: customerA,
        pickupLocationId: khoA.id,
        deliveryLocationId: nhaMayA.id,
        createdBy: operator,
      });
      return { khoA, nhaMayA, khoB, trip };
    };

    it('★ refuses A → B while the pickup still names A’s place', async () => {
      const { trip } = await arranged();
      await expect(board.update(trip.id, { customerId: customerB, deliveryLocationId: null }, operator)).rejects.toThrow(ValidationError);
      // Nothing moved: still A, still A's places.
      expect(await board.findById(trip.id)).toMatchObject({ customerId: customerA });
    });

    it('★ refuses A → B while the delivery still names A’s place', async () => {
      const { trip } = await arranged();
      await expect(board.update(trip.id, { customerId: customerB, pickupLocationId: null }, operator)).rejects.toThrow(ValidationError);
      expect(await board.findById(trip.id)).toMatchObject({ customerId: customerA });
    });

    it('refuses A → B with no place named at all in the patch — both are re-examined', async () => {
      const { trip } = await arranged();
      await expect(board.update(trip.id, { customerId: customerB }, operator)).rejects.toThrow(ValidationError);
      expect(
        (await sql(`SELECT customer_id::text AS c, pickup_location_id::text AS p FROM trip_schedules WHERE id = $1`, [trip.id]))[0],
      ).toMatchObject({ c: customerA });
    });

    it('moves A → B when both places are cleared, dropping their coordinates with them', async () => {
      const { trip } = await arranged();
      const moved = await board.update(
        trip.id,
        { customerId: customerB, pickupLocationId: null, deliveryLocationId: null, pickupAddress: 'Bãi tạm' },
        operator,
      );
      expect(moved).toMatchObject({
        customerId: customerB,
        pickupLocationId: null,
        deliveryLocationId: null,
        pickupLatitude: null,
        deliveryLatitude: null,
        pickupAddress: 'Bãi tạm',
      });
    });

    it('moves A → B when both places are replaced with B’s', async () => {
      const { khoB, trip } = await arranged();
      const moved = await board.update(
        trip.id,
        { customerId: customerB, pickupLocationId: khoB.id, deliveryLocationId: khoB.id },
        operator,
      );
      expect(moved).toMatchObject({
        customerId: customerB,
        pickupLocationId: khoB.id,
        deliveryLocationId: khoB.id,
        pickupLatitude: 11.0,
        deliveryAddress: 'Kho B, Bình Dương',
      });
    });

    it('leaves the same customer with unchanged places exactly as it was', async () => {
      const { khoA, nhaMayA, trip } = await arranged();
      await catalogue.updateLocation(customerA, khoA.id, { latitude: 10.0, longitude: 106.0 });

      const same = await board.update(trip.id, { customerId: customerA, note: 'không đổi' }, operator);

      expect(same).toMatchObject({
        customerId: customerA,
        pickupLocationId: khoA.id,
        deliveryLocationId: nhaMayA.id,
        pickupLatitude: OSC.latitude,
        note: 'không đổi',
      });
    });

    it('★ still refuses B’s place on an A trip, and A’s place on a B trip, however it is sent', async () => {
      const { khoA, khoB, trip } = await arranged();
      await expect(board.update(trip.id, { pickupLocationId: khoB.id }, operator)).rejects.toThrow(ValidationError);
      await expect(
        board.update(trip.id, { customerId: customerB, pickupLocationId: khoA.id, deliveryLocationId: khoB.id }, operator),
      ).rejects.toThrow(ValidationError);
      const rows = (await sql(`SELECT customer_id::text AS c FROM trip_schedules WHERE id = $1`, [trip.id])) as { c: string }[];
      expect(rows[0]!.c).toBe(customerA);
    });
  });
});
