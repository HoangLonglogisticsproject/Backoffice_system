import type { TripLocation } from '@/types/trip';

/**
 * A place's address as somebody would write it on an envelope:
 * `105 đường số 10, Phường Phú Thuận, Quận 7, Thành phố Hồ Chí Minh`.
 *
 * ★ THE STREET LINE AND THE ADMINISTRATIVE UNITS ARE STORED APART AND READ
 * TOGETHER. They are separate columns because they are entered separately — one
 * is typed, three are chosen from a list — but nobody reads an address in
 * pieces. Splitting them across two table columns showed the same place twice
 * and neither copy was complete.
 *
 * ★ NARROWEST FIRST, WIDEST LAST, which is the Vietnamese convention: house and
 * street, then phường/xã, then quận/huyện, then tỉnh/thành.
 *
 * Any part may be missing — the administrative three are optional and a place
 * is real before anybody has filled them in — so the join skips blanks rather
 * than leaving `, ,` behind.
 */
export const fullAddress = (location: TripLocation): string =>
  [location.address, location.ward, location.district, location.province]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');
