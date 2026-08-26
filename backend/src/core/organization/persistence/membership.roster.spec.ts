import type { Database } from '../../../common/types/database.port';
import { MembershipRepository } from './membership.repository';

/**
 * The employee roster read model, without a database.
 *
 * What is worth testing here is not that PostgreSQL can join — it is the two
 * translations this repository performs, both of which are business rules
 * wearing SQL clothing:
 *
 *   1. an ABSENT head assignment means MEMBER, because `role_assignments` has
 *      no MEMBER value to return (0004);
 *   2. `membershipStatus` and `accountStatus` are carried side by side and
 *      neither is derived from the other.
 *
 * Feeding rows in directly is what makes those assertions about the mapping
 * rather than about the query planner.
 */

/** A row shaped exactly as `ROSTER_SELECT` aliases it. */
const row = (over: Record<string, unknown> = {}) => ({
  membership_id: 'mem-1',
  membership_status: 'active',
  joined_at: new Date('2026-08-26T00:00:00.000Z'),
  ended_at: null,
  cursor_at: '2026-08-26 00:00:00+00',
  user_id: 'user-1',
  user_display_name: 'Lê Gia Minh Phú',
  account_status: 'active',
  department_id: 'dep-sales',
  department_name: 'Sales',
  is_head: false,
  ...over,
});

const repositoryOver = (rows: unknown[]) => {
  const query = jest.fn().mockResolvedValue(rows);
  const db = { query, transaction: jest.fn() } as unknown as Database;
  return { repository: new MembershipRepository(db), query };
};

describe('the employee roster read model', () => {
  describe('position is derived, never stored', () => {
    it('reads an active head assignment as DEPARTMENT_HEAD', async () => {
      const { repository } = repositoryOver([row({ is_head: true })]);

      const [line] = await repository.listRosterPage({}, 50, undefined);

      expect(line!.role).toBe('DEPARTMENT_HEAD');
    });

    /**
     * ⚠ THE ABSENCE IS THE VALUE. `role_assignments` CHECKs `role_key` against
     * SUPERADMIN and DEPARTMENT_HEAD only, so there is no MEMBER row to find
     * and none must ever be created to make this work.
     */
    it('reads no head assignment as MEMBER, without a MEMBER row existing', async () => {
      const { repository } = repositoryOver([row({ is_head: false })]);

      const [line] = await repository.listRosterPage({}, 50, undefined);

      expect(line!.role).toBe('MEMBER');
    });

    it('asks only for ACTIVE head assignments, so a revoked head is not still one', async () => {
      const { repository, query } = repositoryOver([]);

      await repository.listRosterPage({}, 50, undefined);

      const [sql] = query.mock.calls[0]!;
      expect(sql).toContain("ra.role_key = 'DEPARTMENT_HEAD'");
      expect(sql).toContain("ra.status   = 'active'");
      // Joined on the membership the assignment names — not on (user, department),
      // which would also match a head assignment from an earlier rejoin.
      expect(sql).toContain('ra.membership_id = m.id');
    });
  });

  describe('the two statuses stay two', () => {
    it('carries a disabled account on an ENDED membership', async () => {
      const { repository } = repositoryOver([
        row({
          account_status: 'disabled',
          membership_status: 'ended',
          ended_at: new Date('2026-08-20'),
        }),
      ]);

      const [line] = await repository.listRosterPage({}, 50, undefined);

      expect(line!.accountStatus).toBe('disabled');
      expect(line!.membershipStatus).toBe('ended');
      expect(line!.endedAt).toEqual(new Date('2026-08-20'));
    });

    /**
     * ★ THE COMBINATION THAT PROVES THEY ARE NOT ONE FIELD. Nothing in the
     * schema ties `users.status` to `department_memberships.status`, so a
     * disabled account on a still-active membership is representable — and a
     * read model that derived one from the other would report it wrongly.
     */
    it('does not turn a disabled account into an ended membership', async () => {
      const { repository } = repositoryOver([
        row({ account_status: 'disabled', membership_status: 'active', ended_at: null }),
      ]);

      const [line] = await repository.listRosterPage({}, 50, undefined);

      expect(line!.accountStatus).toBe('disabled');
      expect(line!.membershipStatus).toBe('active');
    });
  });

  /**
   * ★ ONE PERSON, MANY MEMBERSHIPS, STILL ONE EMPLOYEE. A transfer ends one row
   * and opens another against the SAME `users.id`. Two lines of history is the
   * correct answer; two employees would be a duplicated identity.
   */
  it('keeps one identity across an ended and an active membership', async () => {
    const { repository } = repositoryOver([
      row({
        membership_id: 'mem-sales',
        membership_status: 'ended',
        ended_at: new Date('2026-08-18'),
        department_id: 'dep-sales',
        department_name: 'Sales',
      }),
      row({
        membership_id: 'mem-ops',
        membership_status: 'active',
        department_id: 'dep-ops',
        department_name: 'Vận hành',
      }),
    ]);

    const lines = await repository.listRosterPage({}, 50, undefined);

    // Two membership rows...
    expect(lines.map((line) => line.id)).toEqual(['mem-sales', 'mem-ops']);
    expect(lines.map((line) => line.department.name)).toEqual(['Sales', 'Vận hành']);
    // ...and exactly ONE person behind them.
    expect(new Set(lines.map((line) => line.user.id)).size).toBe(1);
    expect(lines.every((line) => line.user.displayName === 'Lê Gia Minh Phú')).toBe(true);
  });

  it('never reads a user id or a department id as the membership id', async () => {
    const { repository } = repositoryOver([row()]);

    const [line] = await repository.listRosterPage({}, 50, undefined);

    expect(line!.id).toBe('mem-1');
    expect(line!.user.id).toBe('user-1');
    expect(line!.department.id).toBe('dep-sales');
    expect(line!.joinedAt).toEqual(new Date('2026-08-26T00:00:00.000Z'));
  });

  describe('scope and filter are parameters, not hardcoded SQL', () => {
    it('filters by department when one is named, and binds it', async () => {
      const { repository, query } = repositoryOver([]);

      await repository.listRosterPage({ departmentId: 'dep-sales' }, 50, undefined);

      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('m.department_id = $1');
      expect(values).toContain('dep-sales');
    });

    it('names no department for the global read', async () => {
      const { repository, query } = repositoryOver([]);

      await repository.listRosterPage({}, 50, undefined);

      const [sql] = query.mock.calls[0]!;
      expect(sql).not.toContain('m.department_id =');
    });

    /**
     * ⚠ THE OLD QUERY PINNED `m.status = 'active'` INTO THE SQL, which made the
     * status column a constant and put every ended membership out of reach of
     * any query. History was in the table and unaskable.
     */
    it('filters by membership status when one is asked for', async () => {
      const { repository, query } = repositoryOver([]);

      await repository.listRosterPage({ membershipStatus: 'ended' }, 50, undefined);

      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('m.status = $1');
      expect(values).toContain('ended');
    });

    it('filters by neither when the caller asks for everybody', async () => {
      const { repository, query } = repositoryOver([]);

      await repository.listRosterPage({}, 50, undefined);

      const [sql] = query.mock.calls[0]!;
      expect(sql).not.toContain('m.status = $');
      expect(sql).not.toContain('WHERE');
    });

    it('keeps placeholders aligned when department and status are combined', async () => {
      const { repository, query } = repositoryOver([]);

      await repository.listRosterPage(
        { departmentId: 'dep-ops', membershipStatus: 'active' },
        20,
        undefined,
      );

      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('m.department_id = $1');
      expect(sql).toContain('m.status = $2');
      // limit + 1 is how `hasMore` is answered without a COUNT(*).
      expect(values).toEqual(['dep-ops', 'active', 21]);
    });

    /**
     * EMPLOYEE DETAIL reuses this one query. There is no second SQL definition
     * of employment history: the same `ROSTER_SELECT`, the same mapper, one more
     * condition.
     */
    it('filters to one person when a userId is given', async () => {
      const { repository, query } = repositoryOver([]);

      await repository.listRosterPage({ userId: 'user-1' }, 200, undefined);

      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('m.user_id = $1');
      expect(values).toContain('user-1');
    });

    /**
     * THE HEAD'S DISCLOSURE SCOPE. Narrowing happens in SQL, so periods the
     * caller may not see are never read into the process at all - filtering them
     * out afterwards would be one bug away from disclosure.
     */
    it('narrows to a set of departments with a single bound array', async () => {
      const { repository, query } = repositoryOver([]);

      await repository.listRosterPage(
        { userId: 'user-1', departmentIds: ['dep-a', 'dep-b'] },
        200,
        undefined,
      );

      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('m.user_id = $1');
      // One placeholder whatever the length, and nothing to escape.
      expect(sql).toContain('m.department_id = ANY($2::uuid[])');
      expect(values[1]).toEqual(['dep-a', 'dep-b']);
    });

    /**
     * A head who leads nothing gets an EMPTY array, not "no filter". `= ANY('{}')`
     * matches no row, which is the correct answer; treating empty as unfiltered
     * would turn a caller with no authority into a caller with all of it.
     */
    it('treats an empty department scope as matching nothing, never as unfiltered', async () => {
      const { repository, query } = repositoryOver([]);

      await repository.listRosterPage({ userId: 'user-1', departmentIds: [] }, 200, undefined);

      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('m.department_id = ANY($2::uuid[])');
      expect(values[1]).toEqual([]);
    });

    /**
     * NO N+1. One statement returns every period with its department name and
     * its derived position - not one query per membership for the department,
     * and not one more for the role.
     */
    it('answers a whole employment history in exactly one statement', async () => {
      const { repository, query } = repositoryOver([
        row({ membership_id: 'mem-1', department_id: 'dep-a', department_name: 'Sales' }),
        row({ membership_id: 'mem-2', department_id: 'dep-b', department_name: 'Operations' }),
        row({ membership_id: 'mem-3', department_id: 'dep-a', department_name: 'Sales', is_head: true }),
      ]);

      const lines = await repository.listRosterPage({ userId: 'user-1' }, 200, undefined);

      expect(query).toHaveBeenCalledTimes(1);
      expect(lines).toHaveLength(3);
      expect(lines.map((line) => line.department.name)).toEqual(['Sales', 'Operations', 'Sales']);
      // Position still derived per membership, from that membership's own
      // assignment - the third period is a headship, the first two are not.
      expect(lines.map((line) => line.role)).toEqual([
        'MEMBER',
        'MEMBER',
        'DEPARTMENT_HEAD',
      ]);
      // One person throughout.
      expect(new Set(lines.map((line) => line.user.id)).size).toBe(1);
    });

    it('resumes from a cursor with the row-wise comparison the index answers', async () => {
      const { repository, query } = repositoryOver([]);

      await repository.listRosterPage({}, 10, { t: '2026-08-26 00:00:00+00', i: 'mem-1' });

      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('(m.created_at, m.id) > ($1::timestamptz, $2)');
      expect(sql).toContain('ORDER BY m.created_at ASC, m.id ASC');
      expect(values).toEqual(['2026-08-26 00:00:00+00', 'mem-1', 11]);
    });
  });
});
