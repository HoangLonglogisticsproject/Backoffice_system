import type { Pool } from 'pg';
import type { DatabaseQuery } from '@common/types/database.port';
import type { AppConfig } from '../../src/config/app.config';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { TripBoardService } from '../../src/capabilities/trip-schedule/application/trip-board.service';
import type {
  TripExportQuery,
  TripScheduleService,
} from '../../src/capabilities/trip-schedule/application/trip-schedule.service';
import type { TripExportSnapshot } from '../../src/capabilities/trip-schedule/domain/trip-board';
import type { TripExportScope, TripStatus } from '../../src/capabilities/trip-schedule/domain/trip-schedule';
import { TripBoardCostRepository } from '../../src/capabilities/trip-schedule/persistence/trip-board-cost.repository';
import { TEST_URL, describeIntegration, poolAsDatabase } from '../helpers/integration-database';
import { addCost, boardQuery, clearTrips, openTripBoard, type TripBoardFixture } from '../helpers/trip-board-fixture';

/**
 * The Excel export's one-snapshot read against a REAL PostgreSQL.
 *
 *   BOTH SCREENS, NOTHING BETWEEN     `all` = Lịch xe ∪ Lịch sử chuyến, disjoint
 *   ONE STATE OF THE DATABASE         a commit after the snapshot changes nothing in it —
 *                                     not the set, not a date, not a customer, not a cost
 *   ALL OR NOTHING                    a failed read is an error, never part of the rows
 *   NO LEAK                           every transaction gives its connection back clean
 *   NOTHING CUT SHORT                 many exports of a large range at once, each complete
 *
 * ★ HOW "WHILE IT RUNS" IS MADE DETERMINISTIC. The service is built with its two
 * reads wrapped, so a SECOND connection commits changes after the snapshot was
 * taken (`SELECT statement_timestamp()` is the export's first statement) and
 * before the trips, or the costs, are read. Without REPEATABLE READ each of
 * those commits would show up in the file.
 */
describeIntegration('Excel export snapshot against real PostgreSQL', () => {
  jest.setTimeout(120_000);

  let fx: TripBoardFixture;

  beforeAll(async () => {
    fx = await openTripBoard('trip_export_snapshot_itest');
  });

  afterAll(async () => {
    await fx?.pool.end();
  });

  beforeEach(async () => {
    await clearTrips(fx.pool);
    await fx.pool.query('TRUNCATE trip_customers RESTART IDENTITY CASCADE');
  });

  /** 02/11/2026 – 08/11/2026, whole board, default order — the case says which screen. */
  const week = (lifecycle: TripExportScope, over: Partial<TripExportQuery> = {}): TripExportQuery => ({
    ...boardQuery({ from: '2026-11-02', to: '2026-11-08' }),
    lifecycle,
    ...over,
  });

  const trip = async (day: string, status: TripStatus = 'pending', customerId: string | null = null) => {
    const { rows } = await fx.pool.query<{ id: string }>(
      `INSERT INTO trip_schedules (scheduled_on, status, customer_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [day, status, customerId, fx.author],
    );
    return rows[0]!.id;
  };

  const archive = (id: string) =>
    fx.pool.query(`UPDATE trip_schedules SET archived_at = now(), archived_by = $2 WHERE id = $1`, [id, fx.author]);

  const customer = async (name: string) =>
    (
      await fx.pool.query<{ id: string }>(`INSERT INTO trip_customers (name, created_by) VALUES ($1, $2) RETURNING id`, [
        name,
        fx.author,
      ])
    ).rows[0]!.id;

  const ids = (snapshot: TripExportSnapshot) => snapshot.items.map((row) => row.id).sort();
  const row = (snapshot: TripExportSnapshot, id: string) => snapshot.items.find((item) => item.id === id);

  /**
   * The export with `between` committed by ANOTHER connection after the snapshot
   * was taken — just before the trips are read, or just before the costs are.
   */
  const exportWith = (at: 'trips' | 'costs', between: () => Promise<unknown>): TripBoardService => {
    const db = poolAsDatabase(fx.pool);
    const costs = new TripBoardCostRepository(db);
    return new TripBoardService(
      {
        countForExport: (query: TripExportQuery, tx: DatabaseQuery) => fx.trips.countForExport(query, tx),
        listForExport: async (query: TripExportQuery, tx: DatabaseQuery) => {
          if (at === 'trips') await between();
          return fx.trips.listForExport(query, tx);
        },
      } as unknown as TripScheduleService,
      {
        forTrips: async (tripIds: string[], tx: DatabaseQuery) => {
          if (at === 'costs') await between();
          return costs.forTrips(tripIds, tx);
        },
      } as unknown as TripBoardCostRepository,
      db,
    );
  };

  /** The server's clock, read by the writer once its changes are committed. */
  const committedAt = async () =>
    (await fx.pool.query<{ at: Date }>('SELECT clock_timestamp() AS at')).rows[0]!.at;

  // ------------------------------------------------------- the two screens --

  it('★ "all" is exactly Lịch xe ∪ Lịch sử chuyến — disjoint, both ends of the range in, archived out', async () => {
    const pending = await trip('2026-11-02');
    const executing = await trip('2026-11-04', 'executing');
    // Retired, still stored (0025): "Đã xác nhận (dữ liệu cũ)" — NOT finished, so Lịch xe.
    const legacy = await trip('2026-11-06', 'confirmed');
    const finished = await trip('2026-11-03', 'finished');
    const lastDay = await trip('2026-11-08', 'finished');
    await trip('2026-11-01');
    await trip('2026-11-09', 'finished');
    await archive(await trip('2026-11-05', 'finished'));
    await archive(await trip('2026-11-05'));

    const operational = await fx.board.exportSnapshot(week('operational'), true);
    const history = await fx.board.exportSnapshot(week('history'), true);
    const all = await fx.board.exportSnapshot(week('all'), true);

    expect(ids(operational)).toEqual([pending, executing, legacy].sort());
    expect(ids(history)).toEqual([finished, lastDay].sort());
    expect(ids(all)).toEqual([...ids(operational), ...ids(history)].sort());
    expect(ids(operational).filter((id) => ids(history).includes(id))).toEqual([]);
  });

  it('reads the same rows, in the same order, as the screen it was asked for', async () => {
    for (const day of ['2026-11-02', '2026-11-05', '2026-11-08']) await trip(day);
    await trip('2026-11-04', 'finished');

    for (const lifecycle of ['operational', 'history'] as const) {
      const screen = await fx.board.page({ ...week(lifecycle), lifecycle, limit: 200 }, true);
      const file = await fx.board.exportSnapshot(week(lifecycle), true);

      expect(file.items.map((item) => item.id)).toEqual(screen.items.map((item) => item.id));
    }
  });

  // ------------------------------------------- one state of the database --

  /**
   * ★ THE CASE THAT BREAKS A PAGED EXPORT. A, B, C, D; page one read A, B; A is
   * archived and E added — still four — and page two at OFFSET 2 reads D, E.
   * The file holds A, B, D, E: the right count, no id twice, and C missing.
   * One snapshot reads the set exactly as it stood.
   */
  it('★ A, B, C, D: archiving A and adding E after the snapshot leaves the file at A, B, C, D', async () => {
    const a = await trip('2026-11-02');
    const b = await trip('2026-11-03');
    const c = await trip('2026-11-04');
    const d = await trip('2026-11-05');
    let e = '';
    let writerDoneAt = new Date(0);
    const board = exportWith('trips', async () => {
      await archive(a);
      e = await trip('2026-11-06');
      writerDoneAt = await committedAt();
    });

    const snapshot = await board.exportSnapshot(week('all'), true);

    expect(ids(snapshot)).toEqual([a, b, c, d].sort());
    expect(snapshot.readAt.getTime()).toBeLessThanOrEqual(writerDoneAt.getTime());
    // The next export reads the committed state.
    expect(ids(await fx.board.exportSnapshot(week('all'), true))).toEqual([b, c, d, e].sort());
  });

  it('★ re-dating a trip or changing its customer after the snapshot does not move it in or out of the file', async () => {
    const anPhat = await customer('An Phát');
    const binhMinh = await customer('Bình Minh');
    const c = await trip('2026-11-04', 'executing', anPhat);
    const d = await trip('2026-11-05', 'pending', anPhat);
    const board = exportWith('trips', async () => {
      await fx.pool.query(`UPDATE trip_schedules SET scheduled_on = '2026-11-09' WHERE id = $1`, [c]);
      await fx.pool.query(`UPDATE trip_schedules SET customer_id = $2 WHERE id = $1`, [d, binhMinh]);
    });

    const snapshot = await board.exportSnapshot(week('all', { customer: 'An Phát' }), true);

    expect(ids(snapshot)).toEqual([c, d].sort());
    expect(row(snapshot, c)?.scheduledOn).toBe('2026-11-04');
    expect(row(snapshot, d)?.customer?.name).toBe('An Phát');
    expect(ids(await fx.board.exportSnapshot(week('all', { customer: 'An Phát' }), true))).toEqual([]);
  });

  it('★ a cost added or voided after the trips were read is not in the file — the costs are the same instant as the rows', async () => {
    const b = await trip('2026-11-03', 'finished');
    const c = await trip('2026-11-04', 'executing');
    await addCost(fx, b, '500000');
    await addCost(fx, c, '200000');
    const board = exportWith('costs', async () => {
      await addCost(fx, b, '300000');
      await fx.pool.query(
        `UPDATE trip_costs SET voided_at = now(), voided_by = $2, void_reason = 'nhập nhầm' WHERE trip_id = $1`,
        [c, fx.author],
      );
    });

    const snapshot = await board.exportSnapshot(week('all'), true);

    expect(row(snapshot, b)?.costSummary).toMatchObject({ total: '500000.00', itemCount: 1 });
    expect(row(snapshot, c)?.costSummary).toMatchObject({ total: '200000.00', itemCount: 1 });
    const after = await fx.board.exportSnapshot(week('all'), true);
    expect(row(after, b)?.costSummary).toMatchObject({ total: '800000.00', itemCount: 2 });
    expect(row(after, c)?.costSummary).toMatchObject({ total: '0.00', itemCount: 0 });
  });

  it('★ a finished trip with no live cost line comes back as "nothing recorded", not as a missing figure', async () => {
    const quiet = await trip('2026-11-03', 'finished');

    const snapshot = await fx.board.exportSnapshot(week('history'), true);

    expect(row(snapshot, quiet)?.costSummary).toMatchObject({ total: '0.00', itemCount: 0 });
  });

  // ------------------------------------------------------------ the limit --

  it('★ counts the range in the snapshot and refuses it whole when over the limit — archived trips not counted', async () => {
    for (const day of ['2026-11-02', '2026-11-03', '2026-11-04']) await trip(day);
    await archive(await trip('2026-11-05'));

    await expect(fx.board.exportSnapshot(week('all'), true, 2)).rejects.toMatchObject({
      code: 'EXPORT_TOO_LARGE',
      details: { trips: '3', limit: '2' },
    });
    expect((await fx.board.exportSnapshot(week('all'), true, 3)).items).toHaveLength(3);
  });

  it('★ a trip added between the count and the read is in neither — the file holds exactly the number counted', async () => {
    await trip('2026-11-02');
    await trip('2026-11-03');
    const board = exportWith('trips', async () => trip('2026-11-04'));

    const snapshot = await board.exportSnapshot(week('all'), true, 2);

    expect(snapshot.items).toHaveLength(2);
  });

  // -------------------------------------------------------- all or nothing --

  it('★ a read that fails part-way is an error — the rows read before it never leave', async () => {
    await trip('2026-11-04');
    const board = exportWith('costs', async () => {
      throw new Error('canceling statement due to statement timeout');
    });

    await expect(board.exportSnapshot(week('all'), true)).rejects.toThrow('statement timeout');
  });

  it('★ is read-only: the snapshot transaction refuses a write', async () => {
    const db = poolAsDatabase(fx.pool);
    await expect(
      db.transaction(async (tx) => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        await tx.query(`INSERT INTO trip_schedules (scheduled_on, created_by) VALUES ('2026-11-04', $1)`, [fx.author]);
      }),
    ).rejects.toThrow(/read-only transaction/);
  });

  // ---------------------------------------------------------------- no leak --

  it('★ gives its connection back on success and on failure, with no isolation level left on it', async () => {
    await trip('2026-11-04');
    const failing = exportWith('costs', async () => {
      throw new Error('boom');
    });

    // The pool holds 8: a connection kept by either path would exhaust it well before 20 rounds.
    for (let round = 0; round < 20; round += 1) {
      await expect(failing.exportSnapshot(week('all'), true)).rejects.toThrow('boom');
      await fx.board.exportSnapshot(week('all'), true);
    }

    expect(fx.pool.waitingCount).toBe(0);
    expect(fx.pool.idleCount).toBe(fx.pool.totalCount);
    const clients = await Promise.all(Array.from({ length: fx.pool.totalCount }, () => fx.pool.connect()));
    try {
      for (const client of clients) {
        const { rows } = await client.query(
          `SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro`,
        );
        expect(rows[0]).toEqual({ iso: 'read committed', ro: 'off' });
      }
    } finally {
      for (const client of clients) client.release();
    }
  });

  /**
   * The same two paths through the PRODUCTION `DatabaseService` — its pool of 10,
   * its timeouts, its BEGIN/COMMIT/ROLLBACK — against the same server. No
   * tables are needed: what is under test is the transaction the export opens.
   */
  it('★ the production DatabaseService releases a REPEATABLE READ, READ ONLY transaction on both paths', async () => {
    const service = new DatabaseService({ databaseUrl: TEST_URL } as unknown as AppConfig);
    const snapshotOf = (work: (tx: DatabaseQuery) => Promise<unknown>) =>
      service.transaction(async (tx) => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        return work(tx);
      });

    try {
      for (let round = 0; round < 25; round += 1) {
        await expect(snapshotOf((tx) => tx.query('SELECT 1 / 0'))).rejects.toThrow('division by zero');
        await snapshotOf((tx) => tx.query('SELECT statement_timestamp()'));
      }

      const pool = (service as unknown as { pool: Pool }).pool;
      expect(pool.waitingCount).toBe(0);
      expect(pool.idleCount).toBe(pool.totalCount);
      const [settings] = await service.query<{ iso: string; ro: string }>(
        `SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro`,
      );
      expect(settings).toEqual({ iso: 'read committed', ro: 'off' });
    } finally {
      await service.onApplicationShutdown();
    }
  });

  // ------------------------------------------------------ nothing cut short --

  it('★ hands every one of 12 concurrent exports all 3,000 trips of the week, costs included', async () => {
    await fx.pool.query(
      `INSERT INTO trip_schedules (scheduled_on, status, created_by)
       SELECT DATE '2026-11-02' + (i % 7), CASE WHEN i % 3 = 0 THEN 'finished' ELSE 'pending' END, $1
         FROM generate_series(1, 3000) AS i`,
      [fx.author],
    );
    await fx.pool.query(
      `INSERT INTO trip_costs (trip_id, category, amount, created_by, source, state)
       SELECT id, 'fuel', 100000, $1, 'backoffice', 'immutable'
         FROM trip_schedules WHERE status = 'finished'`,
      [fx.author],
    );

    // More exports than the pool has connections: the rest wait their turn.
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => fx.board.exportSnapshot(week('all'), true)),
    );

    for (const result of results) {
      expect(result.status).toBe('fulfilled');
      const snapshot = (result as PromiseFulfilledResult<TripExportSnapshot>).value;
      expect(snapshot.items).toHaveLength(3000);
      expect(new Set(snapshot.items.map((item) => item.id)).size).toBe(3000);
      expect(snapshot.items.filter((item) => item.costSummary?.itemCount === 1)).toHaveLength(1000);
    }
    expect(fx.pool.idleCount).toBe(fx.pool.totalCount);
  });
});
