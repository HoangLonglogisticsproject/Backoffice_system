import { UserRepository } from '@core/users/persistence/user.repository';
import { describeIntegration, poolAsDatabase } from '../helpers/integration-database';
import {
  addTrip,
  boardQuery,
  clearTrips,
  openTripBoard,
  type TripBoardFixture,
} from '../helpers/trip-board-fixture';

/**
 * The board's cost column against a REAL PostgreSQL.
 *
 *   THE CELL SAYS WHAT THE DIALOG SAYS   same figure as `/cost-summary`.combined
 *   NOTHING IS COUNTED TWICE             not by the crew, not by the two ledgers
 *   ZERO IS A NUMBER, NOT A GAP          a trip with nothing recorded reads "0.00"
 *   A BOUNDED NUMBER OF STATEMENTS       one page → two statements, whatever its size
 *   NO PERMISSION, NO READ               the aggregate never runs for such a caller
 */
describeIntegration('Trip board cost summary against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let fx: TripBoardFixture;
  let driver: string;

  beforeAll(async () => {
    fx = await openTripBoard('trip_board_cost_itest');
    const users = new UserRepository(poolAsDatabase(fx.pool));
    driver = (await users.insertUser({ displayName: 'Tài Xế A', accountType: 'driver' })).id;
  });

  afterAll(async () => {
    await fx?.pool.end();
  });

  beforeEach(async () => {
    await clearTrips(fx.pool);
    fx.statements.length = 0;
  });

  const cost = (trip: string, amount: string, voided = false) =>
    fx.pool.query(
      `INSERT INTO trip_costs (trip_id, category, amount, created_by, voided_at, voided_by)
       VALUES ($1, 'fuel', $2, $3, CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN $3::uuid END)`,
      [trip, amount, fx.author, voided],
    );

  const hire = (trip: string, amount: string, voided = false) =>
    fx.pool.query(
      `INSERT INTO trip_outsource_hires (trip_id, carrier_name, agreed_amount, created_by, voided_at, voided_by)
       VALUES ($1, 'Hai Thành', $2, $3, CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN $3::uuid END)`,
      [trip, amount, fx.author, voided],
    );

  const crew = async (trip: string, plate: string) => {
    const { rows } = await fx.pool.query<{ id: string }>(
      `INSERT INTO trip_vehicles (plate, created_by) VALUES ($1, $2) RETURNING id`,
      [plate, fx.author],
    );
    await fx.pool.query(
      `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by)
       VALUES ($1, $2, $3, $4)`,
      [trip, rows[0]!.id, driver, fx.author],
    );
  };

  const summaryOf = async (trip: string) =>
    (await fx.board.page(boardQuery(), true)).items.find((row) => row.id === trip)!.costSummary;

  it('★ says exactly what the cost dialog says, voided records left out', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await cost(trip, '1500000.50');
    await cost(trip, '250000');
    await cost(trip, '999999', true);
    await hire(trip, '4500000');
    await hire(trip, '7777777', true);

    const canonical = await fx.totals.forTrip(trip);

    expect(await summaryOf(trip)).toEqual({ total: canonical.combined, itemCount: 3 });
    expect(canonical.combined).toBe('6250000.50');
  });

  it('★ counts nothing twice — three lorries, two ledgers, one total', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await crew(trip, '51D-00001');
    await crew(trip, '51D-00002');
    await crew(trip, '51D-00003');
    await cost(trip, '100');
    await cost(trip, '200');
    await hire(trip, '1000');
    await hire(trip, '2000');

    expect(await summaryOf(trip)).toEqual({ total: '3300.00', itemCount: 4 });
  });

  it('answers "0.00" and 0 for a trip with nothing recorded — a zero, not a gap', async () => {
    const trip = await addTrip(fx, '2026-08-04');

    expect(await summaryOf(trip)).toEqual({ total: '0.00', itemCount: 0 });
  });

  it('★ reads a page in two statements with cost and one without, whatever its size', async () => {
    for (let day = 1; day <= 12; day += 1) {
      const trip = await addTrip(fx, `2026-08-${String(day).padStart(2, '0')}`);
      await cost(trip, '100');
    }

    fx.statements.length = 0;
    await fx.board.page(boardQuery({ limit: 12 }), true);
    expect(fx.statements).toHaveLength(2);

    fx.statements.length = 0;
    await fx.board.page(boardQuery({ limit: 12 }), false);
    expect(fx.statements).toHaveLength(1);
  });

  it('★ carries no cost figure, and runs no cost read, for a caller without cost.read', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await cost(trip, '1234567');

    const page = await fx.board.page(boardQuery(), false);

    expect(page.items[0]!.costSummary).toBeNull();
    expect(JSON.stringify(page)).not.toContain('1234567');
    expect(fx.statements.some((text) => text.includes('trip_costs'))).toBe(false);
  });
});
