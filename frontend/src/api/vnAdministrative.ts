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
 * ★ THREE LEVELS: tỉnh/thành → quận/huyện → phường/xã. Vietnam went two-tier
 * on 1 July 2025 and this deployment records the older hierarchy on purpose —
 * the server’s administrative client explains why. Wards hang off a DISTRICT,
 * not off a province.
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

/** The quận/huyện of one province. */
export async function fetchDistricts(provinceCode: string): Promise<AdministrativeUnit[]> {
  const { data } = await httpClient.get<AdministrativeUnit[]>(
    `/vn-provinces/${encodeURIComponent(provinceCode)}/districts`,
  );
  return data;
}

/** The phường/xã of one DISTRICT — the district identifies itself, so no province in the path. */
export async function fetchWards(districtCode: string): Promise<AdministrativeUnit[]> {
  const { data } = await httpClient.get<AdministrativeUnit[]>(
    `/vn-districts/${encodeURIComponent(districtCode)}/wards`,
  );
  return data;
}
