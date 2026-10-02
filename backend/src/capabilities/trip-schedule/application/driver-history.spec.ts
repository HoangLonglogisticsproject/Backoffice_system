import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DriverPortalService } from './driver-portal.service';
import type { DriverTrip } from '../domain/driver-read-model';
import type { DriverTripReadModelRepository } from '../persistence/driver-read-model.repository';

/**
 * The driver's own history: which trips are in it, and how it pages.
 *
 * ★ TWO DIFFERENT KINDS OF TEST IN ONE FILE, ON PURPOSE.
 *
 * The paging is ordinary logic and is tested by calling it. Which trips BELONG
 * in the history is a property of one SQL string, and the only honest way to
 * pin it without a database is to read that string — the same technique
 * `tests/architecture/trip-write-paths.spec.ts` uses on this very file to keep
 * money out of it. An integration test against a real PostgreSQL would prove
 * more; this proves the part that a careless edit would silently change.
 */

const REPOSITORY = join(
  __dirname,
  '..',
  'persistence',
  'driver-read-model.repository.ts',
);

/** Source with comments stripped, so prose about SQL is never mistaken for SQL. */
const sqlOf = async (): Promise<string> => {
  const source = await readFile(REPOSITORY, 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
};

/** The `listFinishedForDriver` statement alone. */
const historyQuery = async (): Promise<string> => {
  const sql = await sqlOf();
  const start = sql.indexOf('listFinishedForDriver');
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('return rows.map', start));
};

describe('which trips a driver’s history contains', () => {
  it('★ is defined by the TRIP being finished, not by the turn having ended', async () => {
    const query = await historyQuery();

    // DL-97: a trip closes when every ACTIVE assignment has been approved, so a
    // completed trip leaves its assignments `active`. Filtering on
    // `a.state = 'ended'` would return the opposite of this list — the turns
    // somebody was taken off, and none of the work they actually finished.
    expect(query).toContain("t.status = 'finished'");
    expect(query).not.toContain("a.state = 'ended'");
  });

  it('★ filters on the driver, so a lost guard returns nothing rather than somebody else', async () => {
    expect(await historyQuery()).toContain('a.driver_user_id = $1');
  });

  it('excludes archived trips and the pre-0027 turns that name no lorry', async () => {
    const query = await historyQuery();

    // A row taken off the board is not work, and a turn with no lorry has
    // nothing that was driven. Same two exclusions the live list makes.
    expect(query).toContain('t.archived_at IS NULL');
    expect(query).toContain('a.vehicle_id IS NOT NULL');
  });

  it('★ orders by exactly the columns 0023’s history index is built on', async () => {
    const query = await historyQuery();
    const migration = await readFile(
      join(__dirname, '..', '..', '..', '..', 'migrations', '0023_driver_roster_indexes.sql'),
      'utf8',
    );

    // `idx_trip_driver_assignment_driver_history` was created for this screen
    // and had no reader until now. An ORDER BY that drifts from it turns every
    // page into a sort of the driver's whole history.
    expect(migration).toContain('(driver_user_id, assigned_at DESC, id DESC)');
    expect(query).toContain('ORDER BY a.assigned_at DESC, a.id DESC');
  });

  it('★ keyset, never OFFSET', async () => {
    const query = await historyQuery();

    // ADR-0002. This list only grows and is read from a phone: OFFSET re-walks
    // every earlier row per page, and one row arriving mid-scroll shifts the
    // whole window by one.
    expect(query).toContain('(a.assigned_at, a.id) <');
    expect(query).not.toMatch(/OFFSET/i);
  });

  it('★ selects no column the live list does not', async () => {
    const sql = await sqlOf();

    // The history reuses `DRIVER_TRIP_COLUMNS` — the whitelist — rather than
    // naming its own. Two lists would drift, and the one nobody is looking at
    // is where a commercial column would appear.
    expect(await historyQuery()).toContain('${DRIVER_TRIP_COLUMNS}');
    // `end_reason` is Operations' free text: it may be COMPARED (whether a turn
    // was recorded after the run), never SELECTED as a value.
    expect(sql).not.toMatch(/a\.end_reason(?!\s*=)/);
    expect(sql).not.toContain('t.status,');
  });

  it('★ leaves the LIVE list exactly as it was', async () => {
    const sql = await sqlOf();
    const live = sql.slice(sql.indexOf('listForDriver'), sql.indexOf('listFinishedForDriver'));

    // ★ ADDING HISTORY MUST NOT REDEFINE THE SCHEDULE. The schedule already
    // splits the driver's live turns into today / upcoming / past by DATE, so
    // filtering finished trips out of it here would empty that "past" tab and
    // make a trip finished this morning vanish from "today" while the driver
    // was still looking at it. Whether the two screens should stop overlapping
    // is a product decision, not a side effect of this one.
    expect(live).not.toContain('t.status');
  });
});

describe('how a driver’s history pages', () => {
  const trip = (id: string, assignedAt: Date): DriverTrip =>
    ({ tripId: `t-${id}`, assignment: { id, assignedAt } }) as DriverTrip;

  const serviceReading = (rows: DriverTrip[]) => {
    const listFinishedForDriver = jest.fn().mockResolvedValue(rows);
    const service = new DriverPortalService(
      { listFinishedForDriver } as unknown as DriverTripReadModelRepository,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, listFinishedForDriver };
  };

  it('★ asks for one row more than the page, and does not return it', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => trip(`a${i}`, new Date(2026, 0, 10 - i)));
    const { service, listFinishedForDriver } = serviceReading(rows);

    const page = await service.listMyFinishedTrips('driver-1', { limit: 2 });

    // The extra row is how "is there more" is answered without a second scan
    // of the same index to learn one boolean.
    expect(listFinishedForDriver).toHaveBeenCalledWith('driver-1', { limit: 3, before: null });
    expect(page.trips).toHaveLength(2);
  });

  it('★ the cursor names the LAST row shown, so the next page resumes after it', async () => {
    const rows = [
      trip('a', new Date('2026-01-10T00:00:00Z')),
      trip('b', new Date('2026-01-09T00:00:00Z')),
      trip('c', new Date('2026-01-08T00:00:00Z')),
    ];
    const { service } = serviceReading(rows);

    const page = await service.listMyFinishedTrips('driver-1', { limit: 2 });

    // `b`, not `c`: `c` is the probe row nobody was shown. Pointing the cursor
    // at it would skip it on the next page.
    expect(page.nextCursor).toEqual({ assignedAt: new Date('2026-01-09T00:00:00Z'), id: 'b' });
  });

  it('★ says the end is the end, so the screen stops asking', async () => {
    const { service } = serviceReading([trip('a', new Date('2026-01-10T00:00:00Z'))]);

    const page = await service.listMyFinishedTrips('driver-1', { limit: 2 });

    expect(page.trips).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('a driver who has finished nothing gets an empty page, not an error', async () => {
    const { service } = serviceReading([]);

    // A new driver's history is empty, and empty is an answer.
    expect(await service.listMyFinishedTrips('driver-1', { limit: 20 })).toEqual({
      trips: [],
      nextCursor: null,
    });
  });

  it('passes a cursor straight through — it is a position, not a permission', async () => {
    const { service, listFinishedForDriver } = serviceReading([]);
    const before = { assignedAt: new Date('2026-01-09T00:00:00Z'), id: 'b' };

    await service.listMyFinishedTrips('driver-1', { limit: 20, before });

    // The driver id still comes from the session either way, which is why a
    // forged cursor can only move somebody's own window.
    expect(listFinishedForDriver).toHaveBeenCalledWith('driver-1', { limit: 21, before });
  });
});
