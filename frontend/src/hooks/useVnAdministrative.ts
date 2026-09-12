import { useQuery } from '@tanstack/react-query';
import {
  fetchDistricts,
  fetchProvinces,
  fetchWards,
  type AdministrativeUnit,
} from '@/api/vnAdministrative';
import { useSession } from '@/contexts/SessionProvider';

/**
 * The tỉnh/thành list, one province's quận/huyện, and one district's xã/phường.
 *
 * ★ `staleTime: Infinity`, WHICH IS NOT THE USUAL EXAGGERATION. Vietnam's
 * administrative units change roughly once a generation — the 2025 reform was
 * the first in decades — so within one browser session they are constant. The
 * server holds a 24-hour TTL and is where freshness is actually decided; a
 * second opinion here would only mean re-asking our own API for an answer that
 * cannot have moved.
 *
 * ★ AND A FAILURE IS NOT RETRIED INTO A WALL. When the server has never managed
 * to load the list it answers 503, and hammering it changes nothing — the
 * dropdown says so instead, and the form still saves without these fields.
 */

const ADMIN_KEYS = {
  all: ['vn-administrative'] as const,
  provinces: () => [...ADMIN_KEYS.all, 'provinces'] as const,
  districts: (provinceCode: string) => [...ADMIN_KEYS.all, 'districts', provinceCode] as const,
  wards: (districtCode: string) => [...ADMIN_KEYS.all, 'wards', districtCode] as const,
};

export interface AdministrativeList {
  items: AdministrativeUnit[];
  loading: boolean;
  /** The source could not be reached — the screen says so rather than showing nothing. */
  failed: boolean;
}

export function useProvinces(enabled = true): AdministrativeList {
  const { state } = useSession();

  const query = useQuery({
    queryKey: ADMIN_KEYS.provinces(),
    queryFn: fetchProvinces,
    enabled: enabled && state?.status === 'ready',
    staleTime: Infinity,
    retry: 1,
  });

  return { items: query.data ?? [], loading: query.isFetching, failed: query.isError };
}

/** `null` before a province is chosen: no request, and an empty, settled list. */
export function useDistricts(provinceCode: string | null): AdministrativeList {
  return useChildren(provinceCode, ADMIN_KEYS.districts, fetchDistricts);
}

/**
 * `null` before a DISTRICT is chosen. Wards hang off the district, not the
 * province — the old hierarchy this deployment records has three rungs.
 */
export function useWards(districtCode: string | null): AdministrativeList {
  return useChildren(districtCode, ADMIN_KEYS.wards, fetchWards);
}

/**
 * One rung below whatever was chosen above it.
 *
 * ★ THE TWO LOWER LEVELS ARE THE SAME QUERY WITH A DIFFERENT PARENT, so they
 * are written once. A parent of `null` means the control above has not been
 * answered yet: no request goes out, and the list comes back EMPTY AND SETTLED
 * rather than loading — a dropdown that spins forever because nothing was ever
 * asked for is the bug this avoids.
 */
function useChildren(
  parentCode: string | null,
  key: (code: string) => readonly unknown[],
  fetchChildren: (code: string) => Promise<AdministrativeUnit[]>,
): AdministrativeList {
  const { state } = useSession();

  const query = useQuery({
    queryKey: key(parentCode ?? ''),
    queryFn: () => fetchChildren(parentCode as string),
    enabled: parentCode !== null && state?.status === 'ready',
    staleTime: Infinity,
    retry: 1,
  });

  if (parentCode === null) return { items: [], loading: false, failed: false };
  return { items: query.data ?? [], loading: query.isFetching, failed: query.isError };
}
