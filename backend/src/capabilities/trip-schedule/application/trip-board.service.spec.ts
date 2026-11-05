import type { Database, DatabaseQuery } from '../../../common/types/database.port';
import type { TripBoardCostRepository } from '../persistence/trip-board-cost.repository';
import { TripBoardService } from './trip-board.service';
import type { TripBoardQuery, TripScheduleService } from './trip-schedule.service';

const QUERY: TripBoardQuery = {
  from: '2026-08-01',
  to: '2026-08-31',
  page: 1,
  limit: 20,
  assignment: 'all',
  lifecycle: 'operational',
  sort: 'executionDate',
  direction: 'desc',
  customer: null,
};

const pageOf = (...ids: string[]) => ({
  items: ids.map((id) => ({ id })),
  page: 1,
  limit: 20,
  total: ids.length,
  totalPages: ids.length === 0 ? 0 : 1,
});

const READ_AT = new Date('2026-11-05T08:42:07.123Z');

describe('TripBoardService', () => {
  let list: jest.Mock;
  let listForExport: jest.Mock;
  let forTrips: jest.Mock;
  /** Every step of an export, in the order it ran — statements on `tx` and the two reads. */
  let steps: string[];
  let tx: DatabaseQuery;
  let transaction: jest.Mock;
  let board: TripBoardService;

  beforeEach(() => {
    steps = [];
    tx = {
      query: jest.fn(async (sql: string) => {
        steps.push(sql);
        return sql.includes('statement_timestamp') ? [{ read_at: READ_AT }] : [];
      }) as DatabaseQuery['query'],
    };
    transaction = jest.fn(async (work: (tx: DatabaseQuery) => Promise<unknown>) => work(tx));
    list = jest.fn().mockResolvedValue(pageOf('t1', 't2'));
    listForExport = jest.fn(async () => {
      steps.push('listForExport');
      return [{ id: 't1' }, { id: 't2' }];
    });
    forTrips = jest.fn(async () => {
      steps.push('forTrips');
      return new Map([
        ['t1', { total: '1500000.00', itemCount: 2 }],
        ['t2', { total: '0.00', itemCount: 0 }],
      ]);
    });
    board = new TripBoardService(
      { list, listForExport } as unknown as TripScheduleService,
      { forTrips } as unknown as TripBoardCostRepository,
      { transaction, query: jest.fn() } as unknown as Database,
    );
  });

  it('passes the query through untouched, order included', async () => {
    await board.page({ ...QUERY, sort: 'bookingCreated', direction: 'asc' }, false);

    expect(list).toHaveBeenCalledWith({ ...QUERY, sort: 'bookingCreated', direction: 'asc' });
  });

  it('★ reads every summary on the page in ONE call, and keeps a real zero a zero', async () => {
    const page = await board.page(QUERY, true);

    expect(forTrips).toHaveBeenCalledTimes(1);
    expect(forTrips.mock.calls[0][0]).toEqual(['t1', 't2']);
    expect(page.items.map((row) => row.costSummary)).toEqual([
      { total: '1500000.00', itemCount: 2 },
      { total: '0.00', itemCount: 0 },
    ]);
  });

  it('★ runs no cost read at all for a caller who may not see it', async () => {
    const page = await board.page(QUERY, false);

    expect(forTrips).not.toHaveBeenCalled();
    expect(page.items.every((row) => row.costSummary === null)).toBe(true);
  });

  it('runs no cost read for an empty page, and keeps the envelope', async () => {
    list.mockResolvedValue({ ...pageOf(), page: 9, total: 40, totalPages: 2 });

    const page = await board.page({ ...QUERY, page: 9 }, true);

    expect(forTrips).not.toHaveBeenCalled();
    expect(page).toMatchObject({ items: [], page: 9, total: 40, totalPages: 2 });
  });

  it('★ answers null — never zero — for a trip the aggregate did not return', async () => {
    forTrips.mockResolvedValue(new Map([['t1', { total: '10.00', itemCount: 1 }]]));

    const page = await board.page(QUERY, true);

    expect(page.items[1]?.costSummary).toBeNull();
  });

  it('lets a failed cost read fail the page, rather than drawing it without money', async () => {
    forTrips.mockRejectedValue(new Error('connection reset'));

    await expect(board.page(QUERY, true)).rejects.toThrow('connection reset');
  });

  describe('exportSnapshot — one file, one state of the database', () => {
    const EXPORT = { ...QUERY, lifecycle: 'all' as const };

    /**
     * ★ THE ORDER IS THE GUARANTEE. PostgreSQL refuses `SET TRANSACTION` after
     * the first query, and takes a repeatable-read snapshot at that first query —
     * so the level must come first, the snapshot second, and both reads after,
     * on the SAME transaction.
     */
    it('★ sets REPEATABLE READ, READ ONLY before any read, then reads trips and costs on that one transaction', async () => {
      const snapshot = await board.exportSnapshot(EXPORT, true);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(steps).toEqual([
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
        'SELECT statement_timestamp() AS read_at',
        'listForExport',
        'forTrips',
      ]);
      expect(listForExport).toHaveBeenCalledWith(EXPORT, tx);
      expect(forTrips).toHaveBeenCalledWith(['t1', 't2'], tx);
      expect(list).not.toHaveBeenCalled();
      expect(snapshot.readAt).toBe(READ_AT);
      expect(snapshot.items.map((row) => row.costSummary?.total)).toEqual(['1500000.00', '0.00']);
    });

    it('★ runs no cost read without cost.export — still inside the one snapshot', async () => {
      const snapshot = await board.exportSnapshot(EXPORT, false);

      expect(forTrips).not.toHaveBeenCalled();
      expect(steps).toContain('listForExport');
      expect(snapshot.items.every((row) => row.costSummary === null)).toBe(true);
    });

    it('★ answers a failed read with the error — never with the rows read so far', async () => {
      forTrips.mockRejectedValue(new Error('canceling statement due to statement timeout'));

      await expect(board.exportSnapshot(EXPORT, true)).rejects.toThrow('statement timeout');
    });
  });
});
