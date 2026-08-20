import { useEffect, useState } from 'react';
import { fetchDepartment } from './department.repository';
import { useSession } from '../session/SessionProvider';
import type { Department } from '../type/organization';

/**
 * The departments this user may actually look at, with their real names.
 *
 * ★ BUILT FROM `departmentIds`, NOT FROM `GET /departments`. The list endpoint
 * is GLOBAL-only, so a head or a member asking it gets a 403 — it is the wrong
 * source for a menu. `GET /authorization/me` already says which departments
 * this session may reach, and reading each one by id works for every role.
 *
 * A department that fails to load is dropped rather than rendered as an error
 * row: navigation is not the place to report a transient failure, and an
 * unreachable department is exactly the one that should not be offered as a
 * destination.
 */
export function useMyDepartments(): { departments: Department[]; loading: boolean } {
  const { state } = useSession();
  const ids = state?.status === 'ready' ? state.authorization.departmentIds : undefined;
  const key = ids?.join(',') ?? '';

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key) {
      setDepartments([]);
      return;
    }

    let current = true;
    setLoading(true);

    Promise.all(
      key.split(',').map((id) =>
        fetchDepartment(id).catch(() => null),
      ),
    )
      .then((results) => {
        if (!current) return;
        setDepartments(results.filter((d): d is Department => d !== null));
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [key]);

  return { departments, loading };
}
