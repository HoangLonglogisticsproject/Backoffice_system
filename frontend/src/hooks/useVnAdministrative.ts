import { useQuery } from '@tanstack/react-query';
import { fetchProvinces, fetchWards, type AdministrativeUnit } from '@/api/vnAdministrative';
import { useSession } from '@/contexts/SessionProvider';

/**
 * The tỉnh/thành list, and one province's xã/phường.
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
  wards: (provinceCode: string) => [...ADMIN_KEYS.all, 'wards', provinceCode] as const,
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

/**
 * One province's phường/xã — wards hang off the PROVINCE, because the 2025
 * merger left nothing between the two.
 *
 * `null` before a province is chosen: no request goes out, and the list comes
 * back EMPTY AND SETTLED rather than loading. A dropdown that spins forever
 * because nothing was ever asked for is the bug that avoids.
 */
export function useWards(provinceCode: string | null): AdministrativeList {
  const { state } = useSession();

  const query = useQuery({
    queryKey: ADMIN_KEYS.wards(provinceCode ?? ''),
    queryFn: () => fetchWards(provinceCode as string),
    enabled: provinceCode !== null && state?.status === 'ready',
    staleTime: Infinity,
    retry: 1,
  });

  if (provinceCode === null) return { items: [], loading: false, failed: false };
  return { items: query.data ?? [], loading: query.isFetching, failed: query.isError };
}
