import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  createDepartment,
  fetchDepartments,
  updateDepartment,
  type CreateDepartmentInput,
  type UpdateDepartmentInput,
} from '@/api/department';
import { assignDepartmentHead, revokeDepartmentHead } from '@/api/department-head';
import { fetchEmployeeRoster, transferMember } from '@/api/membership';
import { useSession } from '@/contexts/SessionProvider';
import { ApiError, isApiError } from '@/utils/errors';
import type { Department, EmployeeRosterRow, UserSummary } from '@/types/organization';

/**
 * Department administration for a GLOBAL caller — the one screen that reads
 * every unit and every active membership at once.
 *
 * ★ TWO READS, ONE JOIN, NO NEW ENDPOINT. The backend has no "head of each
 * unit" or "member count" route, and asking `/departments/:id/members` once
 * per row would be a request per department on every render. `GET /memberships`
 * (the global roster, `unit.member.read` with no scope — GLOBAL only) already
 * carries every active membership with its department and its position, so
 * the head and the count of every unit are one read, paged to the end here
 * and joined to `GET /departments` in memory. A deployment has tens of
 * employees, not thousands; the roster's page limit is 200.
 *
 * ★ ONE CACHE PREFIX, INVALIDATED COARSELY. Every mutation on this screen —
 * a rename, a transfer, a head appointed — changes what the join shows, so
 * each one drops the whole `organization` prefix rather than guessing which
 * half moved. The pattern is `tripKeys` / `useTripCatalogue`.
 */
export const organizationKeys = {
  all: ['organization'] as const,
  departments: () => [...organizationKeys.all, 'departments'] as const,
  roster: () => [...organizationKeys.all, 'roster'] as const,
};

const ROSTER_PAGE_LIMIT = 200;

/** Every ACTIVE membership in the deployment, followed to the last page. */
async function fetchActiveRoster(): Promise<EmployeeRosterRow[]> {
  const rows: EmployeeRosterRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchEmployeeRoster({ limit: ROSTER_PAGE_LIMIT, cursor }, 'active');
    rows.push(...page.items);
    cursor = page.hasMore && page.nextCursor ? page.nextCursor : undefined;
  } while (cursor);
  return rows;
}

export interface DepartmentDirectoryRow {
  department: Department;
  /** The active DEPARTMENT_HEAD, read off the roster; null when nobody holds it. */
  head: UserSummary | null;
  /** Active memberships, the head included. */
  memberCount: number;
}

export interface ResourceState {
  loading: boolean;
  error: ApiError | null;
  forbidden: boolean;
}

export interface DepartmentDirectory extends ResourceState {
  rows: DepartmentDirectoryRow[];
  /** The whole active roster, for the detail views: members of a unit, and people who could be moved into it. */
  roster: EmployeeRosterRow[];
  reload: () => void;
}

const stateOf = (queries: UseQueryResult<unknown, Error>[], sessionLoading: boolean): ResourceState => {
  const failed = queries.find((query) => query.error)?.error ?? null;
  const error = failed ? (isApiError(failed) ? failed : new ApiError(0, undefined, 'Unexpected error.')) : null;
  return {
    loading: sessionLoading || queries.some((query) => query.isFetching),
    error,
    forbidden: error?.status === 403,
  };
};

export function useDepartmentDirectory(): DepartmentDirectory {
  const queryClient = useQueryClient();
  const { state, loading: sessionLoading } = useSession();
  const enabled = state?.status === 'ready';

  const departments = useQuery({
    queryKey: organizationKeys.departments(),
    queryFn: fetchDepartments,
    enabled,
  });
  const roster = useQuery({
    queryKey: organizationKeys.roster(),
    queryFn: fetchActiveRoster,
    enabled,
  });

  const rows = useMemo<DepartmentDirectoryRow[]>(() => {
    const units = departments.data ?? [];
    const memberships = roster.data ?? [];
    return units.map((department) => {
      const own = memberships.filter((row) => row.department.id === department.id);
      return {
        department,
        head: own.find((row) => row.role === 'DEPARTMENT_HEAD')?.user ?? null,
        memberCount: own.length,
      };
    });
  }, [departments.data, roster.data]);

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: organizationKeys.all });
  }, [queryClient]);

  return {
    rows,
    roster: roster.data ?? [],
    ...stateOf([departments, roster], sessionLoading),
    reload,
  };
}

/**
 * The five writes, each dropping the cache prefix on success. The screen
 * reads `isPending` off each to disable its control while a request is out.
 */
export function useDepartmentMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: organizationKeys.all });

  // Each `mutationFn` is wrapped so the API function sees its one argument and
  // not TanStack's trailing mutation context.
  const create = useMutation({
    mutationFn: (input: CreateDepartmentInput) => createDepartment(input),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ departmentId, ...patch }: { departmentId: string } & UpdateDepartmentInput) =>
      updateDepartment(departmentId, patch),
    onSuccess: invalidate,
  });
  const transfer = useMutation({
    mutationFn: (input: { departmentId: string; userId: string }) =>
      transferMember(input.departmentId, input.userId),
    onSuccess: invalidate,
  });
  const assignHead = useMutation({
    mutationFn: (input: { departmentId: string; userId: string }) =>
      assignDepartmentHead(input.departmentId, input.userId),
    onSuccess: invalidate,
  });
  const revokeHead = useMutation({
    mutationFn: (input: { departmentId: string }) => revokeDepartmentHead(input.departmentId),
    onSuccess: invalidate,
  });

  return { create, update, transfer, assignHead, revokeHead };
}
