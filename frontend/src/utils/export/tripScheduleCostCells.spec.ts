import { describe, expect, it } from 'vitest';
import { translate, type TranslationKey } from '@/types/translate';
import type { TripCostSummary } from '@/types/tripBoard';
import {
  TRIP_SHEET_COST_WIDTHS,
  tripSheetCostCells,
  tripSheetCostHeadings,
} from './tripScheduleCostCells';

const t = (key: TranslationKey) => translate('vi', key);
const HEADINGS = tripSheetCostHeadings(t);

const summary = (over: Partial<TripCostSummary> = {}): TripCostSummary => ({
  total: '0.00',
  itemCount: 0,
  hires: '0.00',
  byCategory: { fuel: '0.00', toll: '0.00', warehouse: '0.00', loading: '0.00', overtime: '0.00' },
  ...over,
});

describe('tripSheetCostHeadings', () => {
  it('★ names each canonical category as the cost dialog does, then the hires, then the total', () => {
    expect(HEADINGS).toEqual([
      'Dầu', 'Cầu trạm', 'Phí kho', 'Bốc xếp', 'Tăng ca', 'Xe thuê ngoài', 'Tổng chi phí chuyến',
    ]);
  });

  it('has one width per heading', () => {
    expect(TRIP_SHEET_COST_WIDTHS).toHaveLength(HEADINGS.length);
  });
});

describe('tripSheetCostCells', () => {
  it('★ writes every recorded figure as a number a spreadsheet can sum — and a category with no line as empty', () => {
    const cells = tripSheetCostCells(
      summary({
        total: '5300000.50',
        hires: '4500000.00',
        byCategory: { fuel: '800000.50', toll: '0.00', warehouse: '0.00', loading: '0.00', overtime: '0.00' },
      }),
      HEADINGS,
    );

    expect(cells).toEqual({
      'Dầu': 800000.5, 'Cầu trạm': null, 'Phí kho': null, 'Bốc xếp': null, 'Tăng ca': null,
      'Xe thuê ngoài': 4500000, 'Tổng chi phí chuyến': 5300000.5,
    });
  });

  /**
   * ★ NOTHING RECORDED IS EMPTY, NEVER 0 — and never the board's "Chưa có"
   * text. Every stored amount is > 0, so the server's "0.00" can only mean no
   * live line; a 0 in a file would read as a cost confirmed to be nothing.
   */
  it('★ leaves a trip with nothing recorded empty — the total included, not 0, not text', () => {
    const cells = tripSheetCostCells(summary(), HEADINGS);

    expect(Object.values(cells)).toEqual(Array(7).fill(null));
  });

  it('★ leaves every cell blank when there is no summary — unknown is not zero', () => {
    for (const missing of [null, undefined]) {
      expect(Object.values(tripSheetCostCells(missing, HEADINGS))).toEqual(Array(7).fill(null));
    }
  });

  it('★ takes the total from the server, never by adding the cells beside it', () => {
    // A total that is not the sum of the parts can only come through unchanged
    // if nothing here re-adds them.
    const cells = tripSheetCostCells(summary({ total: '999.00', hires: '1.00' }), HEADINGS);

    expect(cells['Tổng chi phí chuyến']).toBe(999);
  });
});
