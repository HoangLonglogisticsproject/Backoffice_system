import {
  DEFAULT_TRIP_BOARD_ORDER,
  SORT_DIRECTIONS,
  TRIP_BOARD_SORTS,
} from '../domain/trip-board';
import { orderBySql } from './trip-board-order';

const EVERY_ORDER = TRIP_BOARD_SORTS.flatMap((sort) =>
  SORT_DIRECTIONS.map((direction) => ({ sort, direction })),
);

describe('orderBySql', () => {
  it('★ keeps the default byte-for-byte what the board ordered by before sorting existed', () => {
    // The shape `idx_trip_schedule_page` is built for; a caller naming no order
    // must get exactly the statement it got yesterday.
    expect(orderBySql(DEFAULT_TRIP_BOARD_ORDER)).toBe('ORDER BY t.scheduled_on DESC, t.id DESC');
  });

  it.each(EVERY_ORDER)(
    '★ ends $sort $direction in the id tiebreaker, in the same direction',
    (order) => {
      const dir = order.direction.toUpperCase();
      expect(orderBySql(order)).toMatch(new RegExp(`^ORDER BY t\\.\\w+ ${dir}, t\\.id ${dir}$`));
    },
  );

  it('reads a real column for each key, and a different one for each', () => {
    const columns = TRIP_BOARD_SORTS.map((sort) =>
      orderBySql({ sort, direction: 'asc' }).split(' ')[2],
    );

    expect(columns).toEqual(['t.scheduled_on', 't.created_at', 't.updated_at']);
  });
});
