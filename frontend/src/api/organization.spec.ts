import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();

vi.mock('./client', () => ({
  httpClient: { get: (...args: unknown[]) => get(...args) },
}));

const { fetchDepartment } = await import('./department');
const { fetchDepartmentMembers } = await import('./membership');

/**
 * What these repositories send, and what they refuse to do on the way.
 *
 * The interesting assertions are the negative ones: scope on the path and not
 * in a body, no client-side filtering, no permission decision. Each of those is
 * a rule that only shows up as a bug much later.
 */
describe('department repository', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: {} });
  });

  it('reads one department by id, with the id on the PATH (§15)', async () => {
    await fetchDepartment('7ce2630e-0000-4000-8000-000000000000');

    expect(get).toHaveBeenCalledWith('/departments/7ce2630e-0000-4000-8000-000000000000');
    // One argument only: no config object smuggling a body, params or headers.
    expect(get.mock.calls[0]).toHaveLength(1);
  });

  it('returns the response unchanged (§5)', async () => {
    const department = {
      id: '60630e75-0000-4000-8000-000000000000',
      slug: 'finance',
      name: 'Finance',
      status: 'active',
      createdAt: '2026-08-18T08:34:22.918Z',
      updatedAt: '2026-08-18T08:34:22.918Z',
    };
    get.mockResolvedValue({ data: department });

    // Not reshaped, not renamed, not enriched — the response IS the contract.
    await expect(fetchDepartment(department.id)).resolves.toEqual(department);
  });

  it('escapes the id rather than trusting it into the URL', async () => {
    await fetchDepartment('../../authorization/me');

    const [url] = get.mock.calls[0] as [string];
    expect(url).not.toContain('../');
    expect(url).toBe('/departments/..%2F..%2Fauthorization%2Fme');
  });

  it('lets the error layer own the failure — no swallowing, no defaults', async () => {
    const { ApiError } = await import('@/utils/errors');
    const forbidden = new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.');
    get.mockRejectedValue(forbidden);

    // A repository that returned `null` on 403 would erase the difference
    // between "not allowed" and "not there".
    await expect(fetchDepartment('any')).rejects.toBe(forbidden);
  });
});

describe('membership repository', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: [] });
  });

  it('reads members by department, id on the PATH (§6, §15)', async () => {
    await fetchDepartmentMembers('7ce2630e-0000-4000-8000-000000000000');

    // The page parameters are part of the call now; nothing else is. No body,
    // no headers, no scope smuggled beside the path.
    expect(get).toHaveBeenCalledWith('/departments/7ce2630e-0000-4000-8000-000000000000/members', {
      params: { limit: undefined, cursor: undefined },
    });
  });

  it('takes ONLY a department id — no sourceDepartmentId, no actor', async () => {
    // Scope is the route parameter and the actor is the session cookie. An
    // extra argument would be a value the client picks and the server ignores.
    expect(fetchDepartmentMembers).toHaveLength(1); // page arg is optional
  });

  it('returns every row the server sent, unfiltered (§0)', async () => {
    const members = [
      {
        id: 'm1',
        userId: 'u1',
        departmentId: 'd1',
        status: 'active',
        createdAt: '2026-08-18T08:34:04.975Z',
        endedAt: null,
      },
      {
        id: 'm2',
        userId: 'u2',
        departmentId: 'd1',
        status: 'ended',
        createdAt: '2026-08-01T08:34:04.975Z',
        endedAt: '2026-08-10T08:34:04.975Z',
      },
    ];
    get.mockResolvedValue({ data: members });

    // No status filter, no sort, no dedupe. Hiding a row the server chose to
    // return is the client deciding what may be seen, which is the server's
    // answer.
    await expect(fetchDepartmentMembers('d1')).resolves.toEqual(members);
  });

  it('propagates 403, which is a normal outcome here (§6)', async () => {
    const { ApiError } = await import('@/utils/errors');
    const forbidden = new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.');
    get.mockRejectedValue(forbidden);

    // An ordinary member is refused this list by design. The caller renders
    // that; it must never be mistaken for a broken session.
    await expect(fetchDepartmentMembers('d1')).rejects.toBe(forbidden);
  });
});
