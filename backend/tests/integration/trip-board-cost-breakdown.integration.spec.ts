import { describeIntegration } from '../helpers/integration-database';
import {
  addCost,
  addCrew,
  addHire,
  addTrip,
  boardQuery,
  clearTrips,
  openTripBoard,
  type TripBoardFixture,
} from '../helpers/trip-board-fixture';

/**
 * The board's per-category cost split — what the Excel export writes — against
 * a REAL PostgreSQL.
 *
 *   ONE TRIP, ONE SUMMARY        lines of a category are summed, never listed
 *   THE PARTS ARE THE WHOLE      categories + hires = total = the dialog's figure
 *   THE RULE IS THE DIALOG'S     voided out; a driver's unreviewed line in
 *   NOTHING LEAKS ACROSS TRIPS   and nothing is multiplied by the crew
 */
describeIntegration('Trip board cost breakdown against real PostgreSQL', () => {
  jest.setTimeout(30_000);

  let fx: TripBoardFixture;

  beforeAll(async () => {
    fx = await openTripBoard('trip_board_cost_breakdown_itest');
  });

  afterAll(async () => {
    await fx?.pool.end();
  });

  beforeEach(async () => {
    await clearTrips(fx.pool);
  });

  const ZERO = { fuel: '0.00', toll: '0.00', warehouse: '0.00', loading: '0.00', overtime: '0.00' };

  const summaryOf = async (trip: string) =>
    (await fx.board.page(boardQuery(), true)).items.find((row) => row.id === trip)!.costSummary;

  it('★ answers a trip with nothing recorded with every figure a counted "0.00"', async () => {
    const trip = await addTrip(fx, '2026-08-04');

    expect(await summaryOf(trip)).toEqual({ total: '0.00', itemCount: 0, hires: '0.00', byCategory: ZERO });
  });

  it('puts one fuel line under fuel, and nowhere else', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await addCost(fx, trip, '800000');

    expect(await summaryOf(trip)).toEqual({
      total: '800000.00', itemCount: 1, hires: '0.00', byCategory: { ...ZERO, fuel: '800000.00' },
    });
  });

  it('★ sums several lines of one category into one figure', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await addCost(fx, trip, '500000');
    await addCost(fx, trip, '300000.50');

    const summary = await summaryOf(trip);
    expect(summary?.byCategory.fuel).toBe('800000.50');
    expect(summary?.itemCount).toBe(2);
  });

  it('keeps each category in its own figure', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await addCost(fx, trip, '100', { category: 'toll' });
    await addCost(fx, trip, '200', { category: 'warehouse' });
    await addCost(fx, trip, '300', { category: 'loading' });
    await addCost(fx, trip, '400', { category: 'overtime' });

    expect((await summaryOf(trip))?.byCategory).toEqual({
      fuel: '0.00', toll: '100.00', warehouse: '200.00', loading: '300.00', overtime: '400.00',
    });
  });

  it('★ counts a voided line or hire nowhere — not in its category, not in the total', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await addCost(fx, trip, '100');
    await addCost(fx, trip, '999', { voided: true });
    await addHire(fx, trip, '7777', true);

    expect(await summaryOf(trip)).toMatchObject({
      total: '100.00', itemCount: 1, hires: '0.00', byCategory: { ...ZERO, fuel: '100.00' },
    });
  });

  it('★ keeps outsourced hires apart from the own-vehicle categories, and inside the total', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await addCost(fx, trip, '200000', { category: 'loading' });
    await addHire(fx, trip, '4500000');

    expect(await summaryOf(trip)).toEqual({
      total: '4700000.00', itemCount: 2, hires: '4500000.00', byCategory: { ...ZERO, loading: '200000.00' },
    });
  });

  /**
   * ★ "GIÁ CƯỚC MUA" NEVER ENTERS THE TOTAL. It may be the very payment the
   * hire records; the two stay independent facts, and the total is the ledgers.
   */
  it('★ leaves the trip’s purchase price out of the total — 4.7M, never 9.2M', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await fx.pool.query(`UPDATE trip_schedules SET purchase_price = 4500000 WHERE id = $1`, [trip]);
    await addHire(fx, trip, '4500000');
    await addCost(fx, trip, '200000', { category: 'loading' });

    expect(await summaryOf(trip)).toMatchObject({ total: '4700000.00', hires: '4500000.00' });
  });

  it('★ counts a driver line still awaiting review, exactly as the cost dialog does', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    const turn = await addCrew(fx, trip, '51D-00001');
    await addCost(fx, trip, '600000', { fromDriver: turn });

    const [summary, dialog] = [await summaryOf(trip), await fx.totals.forTrip(trip)];
    expect(summary?.byCategory.fuel).toBe('600000.00');
    expect(summary?.total).toBe(dialog.combined);
  });

  it('★ multiplies nothing by the crew — three lorries, the same split', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    for (const plate of ['51D-00001', '51D-00002', '51D-00003']) await addCrew(fx, trip, plate);
    await addCost(fx, trip, '100', { category: 'toll' });
    await addHire(fx, trip, '1000');

    expect(await summaryOf(trip)).toMatchObject({ total: '1100.00', hires: '1000.00', byCategory: { toll: '100.00' } });
  });

  it('keeps two trips’ money apart', async () => {
    const [first, second] = [await addTrip(fx, '2026-08-04'), await addTrip(fx, '2026-08-05')];
    await addCost(fx, first, '100');
    await addCost(fx, second, '900', { category: 'overtime' });

    expect((await summaryOf(first))?.byCategory).toEqual({ ...ZERO, fuel: '100.00' });
    expect((await summaryOf(second))?.byCategory).toEqual({ ...ZERO, overtime: '900.00' });
  });

  it('★ adds up to the cost dialog: categories = its own-vehicle total, hires = its hires', async () => {
    const trip = await addTrip(fx, '2026-08-04');
    await addCost(fx, trip, '1500000.50');
    await addCost(fx, trip, '250000', { category: 'toll' });
    await addHire(fx, trip, '4500000');

    const [summary, dialog] = [await summaryOf(trip), await fx.totals.forTrip(trip)];
    const { rows } = await fx.pool.query<{ parts: string }>(
      `SELECT (SELECT SUM(v::numeric) FROM jsonb_each_text($1::jsonb) AS e(k, v))::numeric(14,2)::text AS parts`,
      [JSON.stringify(summary?.byCategory)],
    );
    expect(rows[0]?.parts).toBe(dialog.costs);
    expect(summary?.hires).toBe(dialog.hires);
    expect(summary?.total).toBe(dialog.combined);
  });
});
