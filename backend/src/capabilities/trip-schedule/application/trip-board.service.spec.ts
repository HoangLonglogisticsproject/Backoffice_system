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

describe('TripBoardService', () => {
  let list: jest.Mock;
  let forTrips: jest.Mock;
  let board: TripBoardService;

  beforeEach(() => {
    list = jest.fn().mockResolvedValue(pageOf('t1', 't2'));
    forTrips = jest.fn().mockResolvedValue(
      new Map([
        ['t1', { total: '1500000.00', itemCount: 2 }],
        ['t2', { total: '0.00', itemCount: 0 }],
      ]),
    );
    board = new TripBoardService(
      { list } as unknown as TripScheduleService,
      { forTrips } as unknown as TripBoardCostRepository,
    );
  });

  it('passes the query through untouched, order included', async () => {
    await board.page({ ...QUERY, sort: 'bookingCreated', direction: 'asc' }, false);

    expect(list).toHaveBeenCalledWith({ ...QUERY, sort: 'bookingCreated', direction: 'asc' });
  });

  it('★ reads every summary on the page in ONE call, and keeps a real zero a zero', async () => {
    const page = await board.page(QUERY, true);

    expect(forTrips).toHaveBeenCalledTimes(1);
    expect(forTrips).toHaveBeenCalledWith(['t1', 't2']);
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
});
