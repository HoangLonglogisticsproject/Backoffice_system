import { describe, expect, it } from 'vitest';
import { translate, type TranslationKey } from '@/types/translate';
import type { TripScheduleWithRefs } from '@/types/trip';
import { toTripSheetRows } from './tripScheduleSheet';

/**
 * The half of the export worth testing: trips in, spreadsheet rows out.
 *
 * Nothing here touches SheetJS or the DOM. What could go wrong in this module
 * is a column silently changing meaning — a price that arrives as text and
 * cannot be summed, an unpriced trip drawn as `0`, a status written as its enum
 * — and every one of those is visible in a plain object.
 */

const t = (key: TranslationKey) => translate('vi', key);

const trip = (over: Partial<TripScheduleWithRefs> = {}): TripScheduleWithRefs =>
  ({
    id: 't1',
    scheduledOn: '2026-08-04',
    vehicleId: 'v1',
    vehicle: { id: 'v1', plate: '50H49266' },
    customerId: 'c1',
    customer: { id: 'c1', name: 'WWL' },
    cargoInfo: '17CTN / 1.22CBM',
    pickupAddress: 'BÃI XE MIỀN NAM',
    deliveryAddress: 'TCS',
    pickupContact: 'A Tuấn 0909',
    deliveryContact: null,
    pickupAt: null,
    deliveryAt: null,
    price: null,
    note: null,
    status: 'confirmed',
    createdBy: 'u9',
    createdByUser: { id: 'u9', displayName: 'Điều Độ' },
    driver: null,
    pickupLocationId: null,
    deliveryLocationId: null,
    pickupLocation: null,
    deliveryLocation: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  }) as TripScheduleWithRefs;

describe('toTripSheetRows', () => {
  /**
   * ★ THE WHOLE POINT OF EXPORTING: a column somebody can sum.
   *
   * The app carries the agreed charge as a string end to end so that
   * `NUMERIC(14,2)` never round-trips through float64. A spreadsheet is the one
   * place that rule is deliberately broken, and if it ever silently stops being
   * broken — a string lands in the cell — the column goes quiet: Excel sums it
   * to zero rather than refusing.
   */
  it('★ writes the price as a number, not the string the API sends', () => {
    const [row] = toTripSheetRows([trip({ price: '4500000' })], t, 'vi');

    expect(row[t('colPrice')]).toBe(4_500_000);
  });

  /**
   * ★ AN UNPRICED TRIP IS EMPTY, NOT ZERO. They are different claims — "we have
   * not agreed a figure" against "this run was free" — and a zero would drag
   * any average taken over the column without anybody noticing.
   */
  it('★ leaves an unpriced trip blank rather than writing 0', () => {
    const [row] = toTripSheetRows([trip({ price: null })], t, 'vi');

    expect(row[t('colPrice')]).toBeNull();
  });

  it('writes the status label a dispatcher reads, never the enum', () => {
    const [row] = toTripSheetRows([trip({ status: 'executing' })], t, 'vi');

    expect(row[t('colStatus')]).toBe(t('tripExecuting'));
    expect(row[t('colStatus')]).not.toBe('executing');
  });

  /**
   * ★ THE STT COLUMN COUNTS THE FILE, NOT THE PAGE. The export is one list
   * assembled from several reads; numbering it per page would restart at 1
   * every fifty rows.
   */
  it('★ numbers the rows 1..n across the whole export', () => {
    const rows = toTripSheetRows(
      [trip({ id: 'a' }), trip({ id: 'b' }), trip({ id: 'c' })],
      t,
      'vi',
    );

    expect(rows.map((row) => row[t('colIndex')])).toEqual([1, 2, 3]);
  });

  /**
   * The board stacks address, contact and time in one cell because it reads
   * well. A spreadsheet wants the opposite — three columns that can be filtered.
   */
  it('splits each leg into address, contact and time', () => {
    const [row] = toTripSheetRows(
      [trip({ pickupAt: '2026-08-04T02:00:00.000Z' })],
      t,
      'vi',
    );

    expect(row[t('colPickup')]).toBe('BÃI XE MIỀN NAM');
    expect(row[`${t('colPickup')} — ${t('exportColContact')}`]).toBe('A Tuấn 0909');
    expect(row[`${t('colPickup')} — ${t('exportColTime')}`]).not.toBe('');
  });

  /**
   * A missing reference is an empty cell, not the em dash the screen draws.
   * `<Unset />` is a reading aid; in a spreadsheet it would be a value people
   * filter and sort on.
   */
  it('leaves a missing vehicle, driver or customer as an empty cell', () => {
    const [row] = toTripSheetRows(
      [trip({ vehicle: null, driver: null, customer: null })],
      t,
      'vi',
    );

    expect(row[t('colVehicle')]).toBe('');
    expect(row[t('colDriver')]).toBe('');
    expect(row[t('colCustomer')]).toBe('');
  });

  it('formats the plate the way the board does', () => {
    const [row] = toTripSheetRows([trip()], t, 'vi');

    // Stored as somebody typed it, drawn for reading — one lorry down one column.
    expect(row[t('colVehicle')]).toBe('50H-49266');
  });

  it('follows the interface language, so the headings match the screen', () => {
    const [row] = toTripSheetRows([trip()], (key) => translate('en', key), 'en');

    expect(row).toHaveProperty(translate('en', 'colStatus'));
    expect(row[translate('en', 'colStatus')]).toBe(translate('en', 'tripConfirmed'));
  });
});
