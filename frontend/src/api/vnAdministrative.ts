import { httpClient } from './client';

/**
 * Vietnam's administrative units, for the location form's three dropdowns.
 *
 * ★ FROM OUR OWN API, NOT FROM THE SOURCE. The server proxies and caches the
 * public service behind `/vn-provinces`. The browser never learns which service
 * that is — so swapping it is a server-side change, the office's shared
 * rate-limit allowance is spent once rather than once per dispatcher, and an
 * outage upstream is answered from a cache instead of by an empty dropdown.
 *
 * ★ TWO LEVELS: tỉnh/thành → phường/xã. The 2025 merger left 34 provinces and
 * abolished quận/huyện, so a ward hangs directly off a PROVINCE and there is no
 * rung in between to ask for.
 */

/** One unit: the state's code, and its name. */
export interface AdministrativeUnit {
  /** The identity — survives a rename, and 2025 renamed thousands. */
  code: string;
  /** The label: `Thành phố Hà Nội`, `Xã An Khánh`. */
  name: string;
}

/** The tỉnh/thành phố. */
export async function fetchProvinces(): Promise<AdministrativeUnit[]> {
  const { data } = await httpClient.get<AdministrativeUnit[]>('/vn-provinces');
  return data;
}

/** The phường/xã of one province. */
export async function fetchWards(provinceCode: string): Promise<AdministrativeUnit[]> {
  const { data } = await httpClient.get<AdministrativeUnit[]>(
    `/vn-provinces/${encodeURIComponent(provinceCode)}/wards`,
  );
  return data;
}
