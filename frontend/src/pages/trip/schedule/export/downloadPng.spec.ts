import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingPngFileName, downloadPng } from './downloadPng';

describe('bookingPngFileName', () => {
  it('★ booking-<reference>-<pickup day>.png', () => {
    expect(bookingPngFileName('KAPV', '2026-10-06')).toBe('booking-KAPV-2026-10-06.png');
  });

  it('folds Vietnamese to ASCII and collapses anything a filesystem could refuse', () => {
    expect(bookingPngFileName('Công ty TNHH Đông Á', '2026-10-06')).toBe('booking-Cong-ty-TNHH-Dong-A-2026-10-06.png');
    expect(bookingPngFileName('A/B\\C:D*E?"F<G>H|', '2026-10-06')).toBe('booking-A-B-C-D-E-F-G-H-2026-10-06.png');
    expect(bookingPngFileName('  ../..  ', '2026-10-06')).toBe('booking-2026-10-06.png');
  });

  it('caps the reference after a whole word, and falls back when there is no customer or no real day', () => {
    expect(bookingPngFileName('Công ty TNHH Thương mại Dịch vụ Thực phẩm Sài Gòn Xanh', '2026-10-06')).toBe(
      'booking-Cong-ty-TNHH-Thuong-mai-Dich-vu-Thuc-2026-10-06.png',
    );
    expect(bookingPngFileName('X'.repeat(200), '2026-10-06')).toBe(`booking-${'X'.repeat(40)}-2026-10-06.png`);
    expect(bookingPngFileName(null, '2026-10-06')).toBe('booking-2026-10-06.png');
    expect(bookingPngFileName('KAPV', '../../etc')).toBe('booking-KAPV-undated.png');
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
