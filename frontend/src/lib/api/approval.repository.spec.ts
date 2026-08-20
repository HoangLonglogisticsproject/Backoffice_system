import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();

vi.mock('../http/client', () => ({
  httpClient: { get: (...args: unknown[]) => get(...args) },
}));

const { fetchDepartmentMembershipRequests, fetchPendingMembershipRequests } = await import(
  './membership-request.repository'
);
const { fetchDepartmentAccountInvitations, fetchPendingAccountInvitations } = await import(
  './account-invitation.repository'
);
const { fetchDepartmentHead } = await import('./department-head.repository');
const { ApiError } = await import('../http/apiError');

/**
 * Request shape, and the things these repositories deliberately do NOT do.
 *
 * The negative assertions carry the weight: no actor, no role, no filtering, no
 * status smoothing. Each is a rule that only surfaces as a bug much later.
 */

const DEPARTMENT = '7ce2630e-0000-4000-8000-000000000000';

describe('membership request repository (§10)', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: { items: [], nextCursor: null, hasMore: false } });
  });

  it('reads one department queue, id on the PATH (§15)', async () => {
    await fetchDepartmentMembershipRequests(DEPARTMENT);

    expect(get).toHaveBeenCalledWith(`/departments/${DEPARTMENT}/membership-requests`, {
      params: { limit: undefined, cursor: undefined },
    });
    // Two arguments: the path, and the page parameters. Nothing else — no body,
    // no headers, and no scope beside the path.
    expect(get.mock.calls[0]).toHaveLength(2);
    expect((get.mock.calls[0] as [string, Record<string, unknown>])[1]).toEqual({
      params: { limit: undefined, cursor: undefined },
    });
  });

  it('reads the global queue with no arguments at all', async () => {
    await fetchPendingMembershipRequests();

    expect(get).toHaveBeenCalledWith('/membership-requests', {
      params: { limit: undefined, cursor: undefined },
    });
    // No actor, no role, no permission — who is asking is the session cookie.
    expect(fetchPendingMembershipRequests).toHaveLength(0); // page arg is optional
  });

  it('takes ONLY a department id for the scoped read', () => {
    expect(fetchDepartmentMembershipRequests).toHaveLength(1); // page arg is optional
  });

  it('returns rows unchanged, including the response`s targetUserId name', async () => {
    const rows = [
      {
        id: 'r1',
        departmentId: DEPARTMENT,
        targetDepartmentId: null,
        targetUserId: '7d47b2ac-0000-4000-8000-000000000000',
        action: 'REMOVE_MEMBER',
        status: 'pending',
        requestedBy: 'u1',
        requestedAt: '2026-08-18T08:34:23.633Z',
        decidedBy: null,
        decidedAt: null,
        reason: null,
      },
    ];
    get.mockResolvedValue({ data: { items: rows, nextCursor: null, hasMore: false } });

    const { items: result } = await fetchPendingMembershipRequests();

    // Not renamed to `userId` to match the POST body. The two names are
    // genuinely different in the contract, and papering over that here would
    // hide it from whoever writes the mutation.
    expect(result).toEqual(rows);
    expect(result[0]).toHaveProperty('targetUserId');
    expect(result[0]).not.toHaveProperty('userId');
  });

  it('does not filter by status — the server decides what is returned', async () => {
    const rows = [
      { id: 'r1', status: 'pending' },
      { id: 'r2', status: 'approved' },
      { id: 'r3', status: 'rejected' },
    ];
    get.mockResolvedValue({ data: { items: rows, nextCursor: null, hasMore: false } });

    await expect(fetchPendingMembershipRequests().then((p) => p.items)).resolves.toHaveLength(3);
  });

  it('propagates 403 rather than returning an empty list', async () => {
    // An empty list would say "nothing to decide". A 403 says "you may not
    // decide". Collapsing them would render a reassuring lie.
    const forbidden = new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.');
    get.mockRejectedValue(forbidden);

    await expect(fetchPendingMembershipRequests()).rejects.toBe(forbidden);
  });
});

describe('account invitation repository (§9)', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: { items: [], nextCursor: null, hasMore: false } });
  });

  it('reads one department queue, id on the PATH', async () => {
    await fetchDepartmentAccountInvitations(DEPARTMENT);

    expect(get).toHaveBeenCalledWith(`/departments/${DEPARTMENT}/account-invitations`, {
      params: { limit: undefined, cursor: undefined },
    });
  });

  it('reads the global queue with no arguments', async () => {
    await fetchPendingAccountInvitations();

    expect(get).toHaveBeenCalledWith('/account-invitations', {
      params: { limit: undefined, cursor: undefined },
    });
    expect(fetchPendingAccountInvitations).toHaveLength(0); // page arg is optional
  });

  it('returns rows unchanged, and no password field exists to leak (§13)', async () => {
    const rows = [
      {
        id: 'i1',
        departmentId: DEPARTMENT,
        email: 'newcomer@example.com',
        status: 'pending',
        requestedBy: 'u1',
        requestedAt: '2026-08-18T08:34:20.114Z',
        decidedBy: null,
        decidedAt: null,
        reason: null,
        createdUserId: null,
      },
    ];
    get.mockResolvedValue({ data: { items: rows, nextCursor: null, hasMore: false } });

    const { items: result } = await fetchDepartmentAccountInvitations(DEPARTMENT);

    expect(result).toEqual(rows);
    // The temporary secret lives in the approval response only, and cannot be
    // read back from anywhere — including here.
    expect(JSON.stringify(result)).not.toMatch(/password/i);
  });

  it('propagates 403', async () => {
    const forbidden = new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.');
    get.mockRejectedValue(forbidden);

    await expect(fetchPendingAccountInvitations()).rejects.toBe(forbidden);
  });
});

describe('department head repository (§15b)', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: {} });
  });

  it('reads the head by department, id on the PATH', async () => {
    await fetchDepartmentHead(DEPARTMENT);

    expect(get).toHaveBeenCalledWith(`/departments/${DEPARTMENT}/head`);
    expect(fetchDepartmentHead).toHaveLength(1);
  });

  it('returns the assignment shape unchanged', async () => {
    const head = {
      assignmentId: 'a1',
      departmentId: DEPARTMENT,
      userId: 'fab71f53-0000-4000-8000-000000000000',
      membershipId: 'd4b58fd3-0000-4000-8000-000000000000',
      grantedAt: '2026-01-01T00:00:00.000Z',
    };
    get.mockResolvedValue({ data: head });

    await expect(fetchDepartmentHead(DEPARTMENT)).resolves.toEqual(head);
  });

  it('lets a 404 THROW rather than smoothing it into null', async () => {
    // "This unit has no head" and "there is no such unit" are both 404 and lead
    // to different screens. Returning null would merge them and throw away the
    // only thing that tells them apart.
    const notFound = new ApiError(404, 'NOT_FOUND', 'No active head for this department.');
    get.mockRejectedValue(notFound);

    await expect(fetchDepartmentHead(DEPARTMENT)).rejects.toBe(notFound);
  });

  it('escapes the id rather than trusting it into the URL', async () => {
    await fetchDepartmentHead('../../authorization/me');

    const [url] = get.mock.calls[0] as [string];
    expect(url).not.toContain('../');
  });
});
