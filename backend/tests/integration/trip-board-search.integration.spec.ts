import { describeIntegration } from '../helpers/integration-database';
import { addTrip, boardQuery, clearTrips, openTripBoard, type TripBoardFixture } from '../helpers/trip-board-fixture';

/**
 * Lịch xe's customer search against a REAL PostgreSQL `ILIKE` — the escaping
 * proven where it matters, not just as a string rule (`trip-board-search.spec`).
 *
 * ★ EVERY LITERAL HAS A DECOY. Each name with a `%`, `_` or `\` sits beside the
 * name an UNESCAPED pattern would match instead or as well, so a search that
 * regressed to wildcards would visibly return the decoy.
 */
const NAMES = [
  'KHO 100% A', 'KHO 1000 A', // `%` and its wildcard decoy
  'KHO_3SC', 'KHOX3SC', // `_` and its wildcard decoy
  String.raw`A\B LOGISTICS`, 'AB LOGISTICS', // `\` and what `\B` means unescaped: a plain B
  'Viễn Đạt',
];

describeIntegration('Lịch xe customer search — the escaping against a real PostgreSQL ILIKE', () => {
  jest.setTimeout(30_000);

  let fx: TripBoardFixture;

  beforeAll(async () => {
    fx = await openTripBoard('trip_board_search_itest');
  });

  afterAll(async () => {
    await fx?.pool.end();
  });

  beforeEach(async () => {
    await clearTrips(fx.pool);
    await fx.pool.query('TRUNCATE trip_customers RESTART IDENTITY CASCADE');
    for (const name of NAMES) {
      const { rows } = await fx.pool.query<{ id: string }>(
        `INSERT INTO trip_customers (name, created_by) VALUES ($1, $2) RETURNING id`,
        [name, fx.author],
      );
      const trip = await addTrip(fx, '2026-08-04');
      await fx.pool.query(`UPDATE trip_schedules SET customer_id = $2 WHERE id = $1`, [trip, rows[0]!.id]);
    }
  });

  /** The customers the board's real search returns, and the total it counts for them. */
  const found = async (customer: string) => {
    const page = await fx.board.page(boardQuery({ customer }), false);
    expect(page.total).toBe(page.items.length);
    return page.items.map((trip) => trip.customer?.name).sort();
  };

  it('★ the decoys are real: an UNESCAPED pattern would match them', async () => {
    const raw = async (pattern: string) =>
      (await fx.pool.query<{ name: string }>(`SELECT name FROM trip_customers WHERE name ILIKE $1`, [pattern]))
        .rows.map((row) => row.name)
        .sort();
    expect(await raw('%100%%')).toEqual(['KHO 100% A', 'KHO 1000 A']);
    expect(await raw('%KHO_3%')).toEqual(['KHOX3SC', 'KHO_3SC']);
    expect(await raw(String.raw`%A\B%`)).toEqual(['AB LOGISTICS']);
  });

  it('★ a typed "%" finds the per cent sign — not "anything"', async () => {
    expect(await found('100%')).toEqual(['KHO 100% A']);
  });

  it('★ a typed "_" finds the underscore — not "any one character"', async () => {
    expect(await found('KHO_3')).toEqual(['KHO_3SC']);
  });

  it('★ a typed "\\" finds the backslash — not an escape that swallows it', async () => {
    expect(await found(String.raw`A\B`)).toEqual([String.raw`A\B LOGISTICS`]);
  });

  it('an ordinary search still works: case-insensitive, Vietnamese intact, every match counted', async () => {
    expect(await found('viễn đạt')).toEqual(['Viễn Đạt']);
    expect(await found('kho')).toEqual(['KHO 100% A', 'KHO 1000 A', 'KHOX3SC', 'KHO_3SC']);
    expect(await found('logistics')).toEqual(['AB LOGISTICS', String.raw`A\B LOGISTICS`]);
  });
});
