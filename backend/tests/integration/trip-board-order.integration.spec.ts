import { describeIntegration } from '../helpers/integration-database';
import {
  addTrip,
  boardQuery,
  clearTrips,
  openTripBoard,
  type TripBoardFixture,
} from '../helpers/trip-board-fixture';
import type {
  SortDirection,
  TripBoardSort,
} from '../../src/capabilities/trip-schedule/domain/trip-board';

/**
 * The board's three orders against a REAL PostgreSQL.
 *
 *   EACH KEY READS ITS OWN COLUMN      and both directions of it
 *   A TIE IS BROKEN THE SAME WAY       every read, by id, in the key's direction
 *   PAGING LOSES AND REPEATS NOTHING   under a non-default order, ties included
 */
describeIntegration('Trip board order against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let fx: TripBoardFixture;

  beforeAll(async () => {
    fx = await openTripBoard('trip_board_order_itest');
  });

  afterAll(async () => {
    await fx?.pool.end();
  });

  beforeEach(async () => {
    await clearTrips(fx.pool);
  });

  const ids = async (sort: TripBoardSort, direction: SortDirection, page = 1, limit = 50) =>
    (await fx.board.page(boardQuery({ sort, direction, page, limit }), false)).items.map(
      (trip) => trip.id,
    );

  /** Several trips in ONE statement: one `now()`, so every timestamp ties. */
  const tiedTrips = async (count: number): Promise<string[]> => {
    const { rows } = await fx.pool.query<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, created_by)
       SELECT '2026-08-10', $1 FROM generate_series(1, $2) RETURNING id`,
      [fx.author, count],
    );
    return rows.map((row) => row.id);
  };

  // PostgreSQL compares uuids byte-wise, which is lower-case hex string order —
  // plain `<`, not `localeCompare`, so no collation gets a say.
  const byId = (list: string[], direction: SortDirection) => {
    const ascending = [...list].sort((a, b) => (a < b ? -1 : 1));
    return direction === 'asc' ? ascending : ascending.reverse();
  };

  it('orders by when the trip was entered, not by the day it runs', async () => {
    const early = await addTrip(fx, '2026-08-20');
    const late = await addTrip(fx, '2026-08-05');
    await fx.pool.query(`UPDATE trip_schedules SET created_at = '2026-07-01' WHERE id = $1`, [early]);
    await fx.pool.query(`UPDATE trip_schedules SET created_at = '2026-07-15' WHERE id = $1`, [late]);

    expect(await ids('bookingCreated', 'asc')).toEqual([early, late]);
    expect(await ids('bookingCreated', 'desc')).toEqual([late, early]);
    // The run-day order is the opposite — so the two keys are not one column.
    expect(await ids('executionDate', 'desc')).toEqual([early, late]);
  });

  it('★ puts the trip edited last on top under lastUpdated', async () => {
    const first = await addTrip(fx, '2026-08-01');
    const second = await addTrip(fx, '2026-08-02');
    const third = await addTrip(fx, '2026-08-03');

    // The trigger stamps `updated_at` on any edit of the row.
    await fx.pool.query(`UPDATE trip_schedules SET note = 'đổi giờ' WHERE id = $1`, [first]);

    expect(await ids('lastUpdated', 'desc')).toEqual([first, third, second]);
    expect(await ids('lastUpdated', 'asc')).toEqual([second, third, first]);
  });

  it.each([
    ['executionDate', 'desc'],
    ['executionDate', 'asc'],
    ['bookingCreated', 'desc'],
    ['bookingCreated', 'asc'],
    ['lastUpdated', 'desc'],
    ['lastUpdated', 'asc'],
  ] as const)('★ breaks a tie on %s %s by id, identically on every read', async (sort, direction) => {
    const tied = await tiedTrips(6);

    const expected = byId(tied, direction);
    expect(await ids(sort, direction)).toEqual(expected);
    expect(await ids(sort, direction)).toEqual(expected);
  });

  it('★ walks a non-default order page by page with nothing twice and nothing missing', async () => {
    const tied = await tiedTrips(4);
    const solo = [await addTrip(fx, '2026-08-11'), await addTrip(fx, '2026-08-12')];
    const all = [...tied, ...solo];

    const walked: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      walked.push(...(await ids('lastUpdated', 'asc', page, 2)));
    }

    expect(walked).toHaveLength(all.length);
    expect(new Set(walked).size).toBe(all.length);
    // The tied four first (inserted first), in id order; then the two later rows.
    expect(walked).toEqual([...byId(tied, 'asc'), ...solo]);
  });
});
