import { useEffect, useRef, useState } from 'react';
import { fetchDepartment } from '@/api/department';
import { useSession } from '@/contexts/SessionProvider';
import type { Department } from '@/types/organization';

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
  // The identity of the array changes every render, so it cannot be a
  // dependency. Its CONTENTS are what matters, and this is their stable
  // serialisation.
  const key = ids?.join(',') ?? '';

  // The real array, read inside the effect. Rebuilding it from `key.split(',')`
  // would work only for as long as no id ever contains a comma — a property of
  // the data rather than of the code, and not one worth depending on. A ref is
  // exempt from the dependency rule, so this needs no suppression.
  const idsRef = useRef<string[]>([]);
  idsRef.current = ids ?? [];

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key) {
      setDepartments([]);
      return;
    }

    let current = true;
    setLoading(true);

    Promise.all(idsRef.current.map((id) => fetchDepartment(id).catch(() => null)))
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
