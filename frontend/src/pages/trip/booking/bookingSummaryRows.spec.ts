import { describe, expect, it } from 'vitest';
import { translate, type TranslationKey } from '@/types/translate';
import type { FormState } from '../entry/tripEntryModel';
import { summaryRows } from './bookingSummaryRows';

const t = (key: TranslationKey) => translate('vi', key);

const form = (over: Partial<FormState> = {}): FormState => ({
  scheduledOn: '',
  pickupTime: '',
  deliveryAt: '',
  customerId: null,
  cargoInfo: '',
  pickupAddress: '',
  deliveryAddress: '',
  pickupContact: '',
  deliveryContact: '',
  pickupLocationId: null,
  deliveryLocationId: null,
  sellPrice: '',
  purchasePrice: '',
  note: '',
  status: 'pending',
  ...over,
});
const none = { pickup: null, delivery: null };
const place = (name: string) => ({ id: name, name, address: 'x', contact: null, latitude: null, longitude: null });
const keys = (rows: { key: string }[]) => rows.map((row) => row.key);

describe('summaryRows — the booking read back from the form, nothing of its own', () => {
  it('★ says nothing for a field still empty', () => {
    expect(summaryRows(form(), none, null, true, t, 'vi')).toEqual([]);
  });

  it('★ names an end by its place, or by the first line typed', () => {
    const rows = summaryRows(
      form({ deliveryAddress: 'Bãi tạm Q9\nCổng 2\n0909' }),
      { pickup: place('Kho OSC'), delivery: null },
      null,
      false,
      t,
      'vi',
    );
    expect(rows.map((row) => [row.key, row.value])).toEqual([
      ['pickup', 'Kho OSC'],
      ['delivery', 'Bãi tạm Q9'],
    ]);
  });

  it('★ gives the pickup day with its hour — or says the hour is not known yet', () => {
    const day = (pickupTime: string) =>
      summaryRows(form({ scheduledOn: '2099-09-01', pickupTime }), none, null, false, t, 'vi')[0]?.value;
    expect(day('08:30')).toBe('1/9/2099 · 08:30');
    expect(day('')).toBe('1/9/2099 · Chưa có giờ lấy hàng');
  });

  it('★ gives the delivery the same way — day · hour, as typed on the business clock', () => {
    const rows = summaryRows(form({ deliveryAt: '2099-09-02T17:00' }), none, null, false, t, 'vi');
    expect(rows.map((row) => [row.key, row.value])).toEqual([['deliveryAt', '2/9/2099 · 17:00']]);
  });

  it('★ shows the prices only to a caller who may see them, grouped for reading', () => {
    const priced = form({ purchasePrice: '3000000', sellPrice: '4500000' });
    expect(keys(summaryRows(priced, none, null, false, t, 'vi'))).toEqual([]);
    expect(summaryRows(priced, none, null, true, t, 'vi').map((row) => row.value)).toEqual(['3,000,000', '4,500,000']);
  });

  it('keeps the order a booking is read in', () => {
    const full = form({
      scheduledOn: '2099-09-01',
      pickupTime: '08:30',
      deliveryAt: '2099-09-02T17:00',
      cargoInfo: '17CTN',
      pickupAddress: 'Kho A',
      deliveryAddress: 'Kho B',
      purchasePrice: '1',
      sellPrice: '2',
    });
    expect(keys(summaryRows(full, none, 'WWL', true, t, 'vi'))).toEqual([
      'customer',
      'cargo',
      'pickup',
      'delivery',
      'pickupAt',
      'deliveryAt',
      'purchase',
      'sell',
    ]);
  });
});
