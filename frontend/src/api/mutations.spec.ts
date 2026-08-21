import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const patch = vi.fn();

vi.mock('./client', () => ({
  httpClient: {
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
}));

const { createUser, disableUser } = await import('./users');
const { approveMembershipRequest, rejectMembershipRequest } = await import(
  './membership-request'
);
const { approveAccountInvitation, rejectAccountInvitation, requestAccountInvitation } =
  await import('./account-invitation');

/**
 * What the mutation repositories send — and, more importantly, what they refuse
 * to send.
 *
 * Every negative assertion here is a rule that only shows up as a bug much
 * later: an actor field the server would have to be trusted to ignore, a
 * password the client had no business choosing, a permission decided on the
 * wrong side of the wire.
 */
describe('mutation repositories', () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: {} });
    patch.mockReset().mockResolvedValue({ data: {} });
  });

  describe('creating an account directly (GLOBAL)', () => {
    it('sends exactly the four fields the contract defines', async () => {
      await createUser({
        displayName: 'New Comer',
        email: 'new@hoanglong.test',
        initialPassword: 'a long enough passphrase',
        departmentId: '7ce2630e-0000-4000-8000-000000000000',
      });

      expect(post).toHaveBeenCalledWith('/users', {
        displayName: 'New Comer',
        email: 'new@hoanglong.test',
        initialPassword: 'a long enough passphrase',
        departmentId: '7ce2630e-0000-4000-8000-000000000000',
      });
      // No role, no status, no actor: none of those are the client's to set.
      expect(Object.keys(post.mock.calls[0][1] as object).sort()).toEqual([
        'departmentId',
        'displayName',
        'email',
        'initialPassword',
      ]);
    });

    it('only ever disables — re-enabling is a different question', async () => {
      await disableUser('fab71f53-0000-4000-8000-000000000000');

      expect(patch).toHaveBeenCalledWith('/users/fab71f53-0000-4000-8000-000000000000/status', {
        status: 'disabled',
      });
    });
  });

  describe('a head asking for an account', () => {
    it('sends the email and nothing else, with the department on the PATH', async () => {
      await requestAccountInvitation('7ce2630e-0000-4000-8000-000000000000', 'ask@hoanglong.test');

      expect(post).toHaveBeenCalledWith(
        '/departments/7ce2630e-0000-4000-8000-000000000000/account-invitations',
        { email: 'ask@hoanglong.test' },
      );
      // A head does not name, does not assign, and does not set a password.
      const body = post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('displayName');
      expect(body).not.toHaveProperty('initialPassword');
      expect(body).not.toHaveProperty('departmentId');
    });

    it('includes a reason only when one was given', async () => {
      await requestAccountInvitation('7ce2630e-0000-4000-8000-000000000000', 'a@b.test', 'needed');
      expect(post.mock.calls[0][1]).toEqual({ email: 'a@b.test', reason: 'needed' });
    });
  });

  describe('deciding', () => {
    it('never sends who is deciding — the cookie says that', async () => {
      await approveMembershipRequest('f6d42eed-0000-4000-8000-000000000000');

      expect(post).toHaveBeenCalledWith(
        '/membership-requests/f6d42eed-0000-4000-8000-000000000000/approve',
      );
      // One argument: no body at all, so there is no `decidedBy` to trust.
      expect(post.mock.calls[0]).toHaveLength(1);
    });

    it('sends a rejection reason when there is one, and an empty body when not', async () => {
      await rejectMembershipRequest('f6d42eed-0000-4000-8000-000000000000', 'duplicate');
      expect(post.mock.calls[0][1]).toEqual({ reason: 'duplicate' });

      post.mockClear();
      await rejectMembershipRequest('f6d42eed-0000-4000-8000-000000000000');
      expect(post.mock.calls[0][1]).toEqual({});
    });

    it('approving an invitation never sends a password', async () => {
      // ★ The server generates the temporary secret. A client that chose one
      // would be choosing a credential it has no authority over.
      await approveAccountInvitation('a1b2c3d4-0000-4000-8000-000000000000', 'New Comer');

      const body = post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).toEqual({ displayName: 'New Comer' });
      expect(body).not.toHaveProperty('temporaryPassword');
      expect(body).not.toHaveProperty('password');
    });

    it('a body-less approve is legal', async () => {
      await approveAccountInvitation('a1b2c3d4-0000-4000-8000-000000000000');
      expect(post.mock.calls[0][1]).toEqual({});
    });

    it('rejecting an invitation carries only the reason', async () => {
      await rejectAccountInvitation('a1b2c3d4-0000-4000-8000-000000000000', 'wrong address');
      expect(post.mock.calls[0][1]).toEqual({ reason: 'wrong address' });
    });
  });

  it('encodes ids into paths rather than concatenating them raw', async () => {
    await approveMembershipRequest('a b/c');
    expect(post.mock.calls[0][0]).toBe('/membership-requests/a%20b%2Fc/approve');
  });
});
