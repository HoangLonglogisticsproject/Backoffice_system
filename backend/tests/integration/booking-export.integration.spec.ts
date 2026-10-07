import type { Database } from '@common/types/database.port';
import { describeIntegration, poolAsDatabase } from '../helpers/integration-database';
import { addCost, addHire, addTrip, clearTrips, openTripBoard, type TripBoardFixture } from '../helpers/trip-board-fixture';
import { UserRepository } from '@core/users/persistence/user.repository';
import { NotFoundError } from '@common/errors/domain.error';
import { BookingExportService } from '../../src/capabilities/trip-schedule/application/booking-export.service';
import { BookingExportRepository } from '../../src/capabilities/trip-schedule/persistence/booking-export.repository';

/**
 * "Phiếu booking" against a REAL PostgreSQL: the allowlist is a SELECT, so it
 * is tested where it lives — on a trip that HAS prices, an internal note,
 * costs, a hire and a crew, to prove none of the money reaches the document.
 */
const EXPORT_KEYS = [
  'cargoInfo', 'crew', 'customerName', 'delivery', 'driverInstructions', 'pickup',
  'scheduledDeliveryAt', 'scheduledOn', 'scheduledPickupAt',
];
const FORBIDDEN = ['sellPrice', 'purchasePrice', 'costSummary', 'margin', 'vehicleCosts', 'tripCosts', 'note', 'status', 'id'];
const LONG_ADDRESS =
  'Lô B2-7, Đường số 12, Khu công nghiệp Tân Phú Trung, Xã Tân Phú Trung, Huyện Củ Chi, Thành phố Hồ Chí Minh — cổng số 3, kho lạnh phía sau nhà điều hành';

describeIntegration('Booking export — real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let fx: TripBoardFixture;
  let bookings: BookingExportService;
  let drivers: string[];
  /** Every statement the export issues — "one SELECT" as a measurement. */
  const issued: string[] = [];

  beforeAll(async () => {
    fx = await openTripBoard('booking_export_itest');
    const base = poolAsDatabase(fx.pool);
    const counted: Database = {
      ...base,
      query: <T>(text: string, params?: readonly unknown[]) => {
        issued.push(text);
        return base.query<T>(text, params);
      },
    };
    bookings = new BookingExportService(new BookingExportRepository(counted));
    const users = new UserRepository(base);
    drivers = [fx.driver];
    for (const name of ['Nguyễn Văn Bình', 'Trần Thị Cúc']) {
      drivers.push((await users.insertUser({ displayName: name, accountType: 'driver' })).id);
    }
  });

  afterAll(async () => {
    await fx?.pool.end();
  });

  beforeEach(async () => {
    await clearTrips(fx.pool);
    await fx.pool.query('TRUNCATE trip_locations, trip_customers RESTART IDENTITY CASCADE');
  });

  const sql = async <T>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await fx.pool.query(text, params)).rows as T[];

  /** A lorry and `driver` on the trip, at a fixed minute so the order is the test's. */
  const crewOn = async (trip: string, plate: string, driver: string, minute: number): Promise<string> => {
    const [vehicle] = await sql<{ id: string }>(
      `INSERT INTO trip_vehicles (plate, created_by) VALUES ($1, $2) RETURNING id`, [plate, fx.author]);
    const [turn] = await sql<{ id: string }>(
      `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by, assigned_at)
       VALUES ($1, $2, $3, $4, '2026-08-04T01:00:00Z'::timestamptz + make_interval(mins => $5)) RETURNING id`,
      [trip, vehicle!.id, driver, fx.author, minute]);
    return turn!.id;
  };

  /** A booked trip carrying EVERYTHING — the money and the internal note included. */
  const fullTrip = async (): Promise<string> => {
    const [customer] = await sql<{ id: string }>(
      `INSERT INTO trip_customers (name, note, created_by) VALUES ('Công ty TNHH Thực phẩm Sài Gòn Xanh', 'nợ 2 tháng', $1) RETURNING id`,
      [fx.author]);
    const place = async (name: string) =>
      (await sql<{ id: string }>(
        `INSERT INTO trip_locations (customer_id, name, address, contact, note, created_by)
         VALUES ($1, $2, 'địa chỉ danh mục', 'liên hệ danh mục', 'ghi chú địa điểm', $3) RETURNING id`,
        [customer!.id, name, fx.author]))[0]!.id;
    const trip = await addTrip(fx, '2026-08-04');
    await fx.pool.query(
      `UPDATE trip_schedules
          SET customer_id = $2, pickup_location_id = $3, delivery_location_id = $4,
              pickup_address = $5, pickup_contact = 'Anh Tuấn — 0909 123 456',
              delivery_address = '12 Nguyễn Huệ, Phường Sài Gòn, TP. Hồ Chí Minh', delivery_contact = 'Chị Lan — 0912 000 111',
              pickup_at = '2026-08-04T09:00:00Z', delivery_at = '2026-08-05T03:00:00Z',
              cargo_info = '24 kiện · 1.2 tấn · 6 CBM', driver_instructions = 'Gọi trước 30 phút',
              sell_price = 4500000, purchase_price = 3800000, note = 'giá đã chốt 4.5tr, thu sau 30 ngày'
        WHERE id = $1`,
      [trip, customer!.id, await place('Kho Củ Chi'), await place('Cửa hàng Nguyễn Huệ'), LONG_ADDRESS]);
    await addCost(fx, trip, '750000.00');
    await addHire(fx, trip, '3800000.00');
    return trip;
  };

  it('★ exactly the allowlist — every forbidden field absent as a KEY, not merely null', async () => {
    const booking = await bookings.find(await fullTrip());

    expect(Object.keys(booking).sort()).toEqual(EXPORT_KEYS);
    for (const key of FORBIDDEN) expect(booking).not.toHaveProperty(key);
    expect(Object.keys(booking.pickup).sort()).toEqual(['address', 'contact', 'name']);
  });

  it('★ carries no figure, internal note or catalogue note that the trip holds', async () => {
    const json = JSON.stringify(await bookings.find(await fullTrip()));

    for (const secret of ['4500000', '3800000', '750000', 'giá đã chốt', 'nợ 2 tháng', 'ghi chú địa điểm', 'Hai Thành']) {
      expect([secret, json.includes(secret)]).toEqual([secret, false]);
    }
  });

  it('the operational facts, whole — the long address and the Vietnamese text unchanged', async () => {
    const booking = await bookings.find(await fullTrip());

    expect(booking).toEqual({
      scheduledOn: '2026-08-04',
      scheduledPickupAt: new Date('2026-08-04T09:00:00Z'),
      scheduledDeliveryAt: new Date('2026-08-05T03:00:00Z'),
      pickup: { name: 'Kho Củ Chi', address: LONG_ADDRESS, contact: 'Anh Tuấn — 0909 123 456' },
      delivery: {
        name: 'Cửa hàng Nguyễn Huệ',
        address: '12 Nguyễn Huệ, Phường Sài Gòn, TP. Hồ Chí Minh',
        contact: 'Chị Lan — 0912 000 111',
      },
      customerName: 'Công ty TNHH Thực phẩm Sài Gòn Xanh',
      cargoInfo: '24 kiện · 1.2 tấn · 6 CBM',
      driverInstructions: 'Gọi trước 30 phút',
      crew: [],
    });
  });

  it('0..N crew: none is an empty list; three are all listed, oldest first; a turn ended by hand is not crew', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    expect((await bookings.find(trip)).crew).toEqual([]);

    await crewOn(trip, '51C-333.33', drivers[2]!, 3);
    await crewOn(trip, '51H-273.14', drivers[0]!, 1);
    const removed = await crewOn(trip, '50H-999.99', drivers[1]!, 0);
    await crewOn(trip, '51D-652.33', drivers[1]!, 2);
    await fx.pool.query(
      `UPDATE trip_driver_assignments SET state = 'ended', ended_at = now(), ended_by = $2, end_reason = 'Đổi xe' WHERE id = $1`,
      [removed, fx.author]);

    expect((await bookings.find(trip)).crew).toEqual([
      { plate: '51H-273.14', driverName: 'Tài Xế A' },
      { plate: '51D-652.33', driverName: 'Nguyễn Văn Bình' },
      { plate: '51C-333.33', driverName: 'Trần Thị Cúc' },
    ]);
  });

  it('★ a finished run is exported — the crew it was RECORDED with, and no delivery time when none was booked', async () => {
    const [vehicle] = await sql<{ id: string }>(
      `INSERT INTO trip_vehicles (plate, created_by) VALUES ('51G-999.99', $1) RETURNING id`, [fx.author]);
    const recorded = await fx.trips.create({
      scheduledOn: '2026-08-02',
      entryMode: 'historical',
      crew: [{ vehicleId: vehicle!.id, driverUserId: drivers[1]! }],
      createdBy: fx.author,
    });

    const booking = await bookings.find(recorded.id);
    expect(booking.crew).toEqual([{ plate: '51G-999.99', driverName: 'Nguyễn Văn Bình' }]);
    expect(booking.scheduledDeliveryAt).toBeNull();
    expect(Object.keys(booking).sort()).toEqual(EXPORT_KEYS);
  });

  it('an archived trip is not found — the detail route`s own visibility — and nor is an unknown one', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await fx.pool.query(`UPDATE trip_schedules SET archived_at = now(), archived_by = $2 WHERE id = $1`, [trip, fx.author]);

    await expect(bookings.find(trip)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bookings.find('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('★ read-only: one SELECT, and not a row of any table changes', async () => {
    const trip = await fullTrip();
    const snapshot = () => sql(`SELECT t.updated_at, (SELECT count(*) FROM trip_status_history) AS history FROM trip_schedules t WHERE t.id = $1`, [trip]);
    const before = await snapshot();
    issued.length = 0;

    await bookings.find(trip);

    expect(await snapshot()).toEqual(before);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatch(/^\s*SELECT\s/);
  });
});
