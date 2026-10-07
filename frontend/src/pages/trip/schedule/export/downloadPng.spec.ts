import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingPngFileName, downloadPng } from './downloadPng';

/** 15:30:12 on the business clock — the "Ngày xuất" the document prints. */
const EXPORTED_AT = new Date('2026-10-07T08:30:12Z');
const name = (customerName: string | null, scheduledPickupAt: string | null = null, scheduledOn = '2026-10-06') =>
  bookingPngFileName({ customerName, scheduledOn, scheduledPickupAt }, EXPORTED_AT);

describe('bookingPngFileName', () => {
  it('★ booking-<customer>-<pickup day>-<pickup hour>-xuat-<export second>.png — on the Hồ Chí Minh clock', () => {
    expect(name('KAPV', '2026-10-06T09:00:00.000Z')).toBe('booking-KAPV-2026-10-06-1600-xuat-153012.png');
    expect(name('KAPV')).toBe('booking-KAPV-2026-10-06-xuat-153012.png');
  });

  it('★ two bookings of one customer at the same hour get two names — with no internal id in either', () => {
    const booking = { customerName: 'KAPV', scheduledOn: '2026-10-06', scheduledPickupAt: '2026-10-06T01:00:00.000Z' };
    const first = bookingPngFileName(booking, EXPORTED_AT);
    const second = bookingPngFileName(booking, new Date(EXPORTED_AT.getTime() + 4_000));
    expect([first, second]).toEqual(['booking-KAPV-2026-10-06-0800-xuat-153012.png', 'booking-KAPV-2026-10-06-0800-xuat-153016.png']);
  });

  it('folds Vietnamese to ASCII and collapses anything a filesystem could refuse', () => {
    expect(name('Công ty TNHH Đông Á')).toBe('booking-Cong-ty-TNHH-Dong-A-2026-10-06-xuat-153012.png');
    expect(name('A/B\\C:D*E?"F<G>H|')).toBe('booking-A-B-C-D-E-F-G-H-2026-10-06-xuat-153012.png');
    expect(name('  ../..  ')).toBe('booking-2026-10-06-xuat-153012.png');
  });

  it('caps the customer after a whole word, and falls back when there is no customer or no real day', () => {
    expect(name('Công ty TNHH Thương mại Dịch vụ Thực phẩm Sài Gòn Xanh')).toBe(
      'booking-Cong-ty-TNHH-Thuong-mai-Dich-vu-Thuc-2026-10-06-xuat-153012.png',
    );
    expect(name('X'.repeat(200))).toBe(`booking-${'X'.repeat(40)}-2026-10-06-xuat-153012.png`);
    expect(name(null)).toBe('booking-2026-10-06-xuat-153012.png');
    expect(name('KAPV', null, '../../etc')).toBe('booking-KAPV-undated-xuat-153012.png');
  });
});

describe('downloadPng', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('★ saves THE GIVEN blob under the name, then revokes its URL — nothing sent anywhere', () => {
    vi.useFakeTimers();
    const blob = new Blob(['png'], { type: 'image/png' });
    const create = vi.fn(() => 'blob:download');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });

    downloadPng(blob, 'booking-KAPV-2026-10-06.png');

    expect(create).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:download', download: 'booking-KAPV-2026-10-06.png' }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:download');
  });
});
