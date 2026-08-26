import type { Database } from '../../../common/types/database.port';
import { UnauthorizedError, ValidationError } from '../../../common/errors/domain.error';
import { LOCAL_PROVIDER, User } from '../../users/domain/user.entity';
import { IdentityRepository } from '../persistence/identity.repository';
import { AuthenticationService, TooManyAttemptsError } from './authentication.service';
import { LoginThrottleService } from './login-throttle.service';
import type { PasswordHasher } from '../domain/password-hasher.port';
import { SessionService } from './session.service';

/**
 * The rule this file protects: **every** rejection is indistinguishable.
 *
 * Unknown subject, wrong password, disabled account and a broken credential row
 * all produce the same error with the same message. Anything else turns the
 * login endpoint into an account-enumeration oracle, and "that email is not
 * registered" is precisely the answer an attacker wants before guessing.
 */
describe('AuthenticationService', () => {
  const activeUser: User = {
    id: 'user-1',
    displayName: 'A Person',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const identityFor = (secretHash: string | null) => ({
    id: 'identity-1',
    userId: activeUser.id,
    provider: LOCAL_PROVIDER,
    subject: 'a@example.com',
    secretHash,
    createdAt: new Date(),
  });

  let hasher: jest.Mocked<PasswordHasher>;
  let users: {
    findWithUserBySubject: jest.Mock;
    findLocalForUser: jest.Mock;
    replaceLocalSecret: jest.Mock;
  };
  let sessions: { issue: jest.Mock; revoke: jest.Mock; revokeAllForUser: jest.Mock };
  let service: AuthenticationService;

  beforeEach(() => {
    hasher = {
      hash: jest.fn(),
      verify: jest.fn().mockResolvedValue(true),
      fakeVerify: jest.fn().mockResolvedValue(undefined),
    };
    users = {
      findWithUserBySubject: jest.fn(),
      findLocalForUser: jest.fn().mockResolvedValue(identityFor('stored-hash')),
      replaceLocalSecret: jest.fn().mockResolvedValue(1),
    };
    sessions = {
      issue: jest.fn().mockResolvedValue({ token: 'tok', expiresAt: new Date() }),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuthenticationService(
      {
        query: jest.fn(),
        transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
      } as unknown as Database,
      users as unknown as IdentityRepository,
      sessions as unknown as SessionService,
      new LoginThrottleService(),
      hasher,
    );
  });

  const expectIndistinguishableRejection = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(promise).rejects.toThrow('Invalid credentials.');
  };

  it('issues a session for the right password', async () => {
    users.findWithUserBySubject.mockResolvedValue({
      identity: identityFor('scrypt$digest'),
      user: activeUser,
    });

    const result = await service.login('a@example.com', 'right');

    expect(result.user.id).toBe('user-1');
    expect(result.session.token).toBe('tok');
    expect(sessions.issue).toHaveBeenCalledWith('user-1');
  });

  it('rejects a wrong password without issuing anything', async () => {
    users.findWithUserBySubject.mockResolvedValue({
      identity: identityFor('scrypt$digest'),
      user: activeUser,
    });
    hasher.verify.mockResolvedValue(false);

    await expectIndistinguishableRejection(service.login('a@example.com', 'wrong'));
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('rejects an unknown subject with the identical error', async () => {
    users.findWithUserBySubject.mockResolvedValue(null);

    await expectIndistinguishableRejection(service.login('nobody@example.com', 'anything'));
    // Same observable outcome as a wrong password, down to the session that was
    // never issued — the two failures must be indistinguishable from outside.
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('spends the same work on an unknown subject, so timing does not answer either', async () => {
    users.findWithUserBySubject.mockResolvedValue(null);

    await expect(service.login('nobody@example.com', 'x')).rejects.toThrow();

    // Without this, an unknown subject returns before any hashing happens and
    // the response time reveals what the message refuses to.
    expect(hasher.fakeVerify).toHaveBeenCalledTimes(1);
  });

  it('rejects a disabled user — and only AFTER checking the password', async () => {
    users.findWithUserBySubject.mockResolvedValue({
      identity: identityFor('scrypt$digest'),
      user: { ...activeUser, status: 'disabled' },
    });

    await expectIndistinguishableRejection(service.login('a@example.com', 'right'));

    // Order matters: rejecting on status first would let anyone discover which
    // accounts are disabled without knowing a password.
    expect(hasher.verify).toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('treats a local identity with no secret as a failed login, not a crash', async () => {
    users.findWithUserBySubject.mockResolvedValue({
      identity: identityFor(null),
      user: activeUser,
    });

    await expectIndistinguishableRejection(service.login('a@example.com', ''));
    expect(hasher.fakeVerify).toHaveBeenCalled();
  });

  it('looks the subject up under the local provider', async () => {
    users.findWithUserBySubject.mockResolvedValue(null);
    await expect(service.login('A@Example.com', 'x')).rejects.toThrow();

    expect(users.findWithUserBySubject).toHaveBeenCalledWith(LOCAL_PROVIDER, 'A@Example.com');
  });

  it('revokes the session on logout', async () => {
    await service.logout('tok');
    expect(sessions.revoke).toHaveBeenCalledWith('tok');
  });

  /**
   * The throttle is not only about guessing. Every attempt costs ~100 ms of
   * memory-hard scrypt BY DESIGN, failures included — so an unbounded endpoint
   * turns our own password hardening into a CPU-exhaustion amplifier. That is
   * why the budget is spent before the lookup, not after.
   */
  describe('throttling', () => {
    const failOnce = async (subject = 'a@example.com') => {
      await expect(service.login(subject, 'wrong', '203.0.113.9')).rejects.toThrow();
    };

    beforeEach(() => {
      users.findWithUserBySubject.mockResolvedValue({
        identity: identityFor('scrypt$digest'),
        user: activeUser,
      });
      hasher.verify.mockResolvedValue(false);
    });

    it('refuses further attempts once the per-subject limit is spent', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) await failOnce();

      await expect(service.login('a@example.com', 'wrong', '203.0.113.9')).rejects.toMatchObject({
        code: 'TOO_MANY_ATTEMPTS',
      });
    });

    it('reports how long to wait, so a 429 is guidance rather than a wall', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) await failOnce();

      let captured: TooManyAttemptsError | undefined;
      try {
        await service.login('a@example.com', 'wrong', '203.0.113.9');
      } catch (error) {
        captured = error as TooManyAttemptsError;
      }

      expect(captured).toBeInstanceOf(TooManyAttemptsError);
      expect(captured?.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('spends NO database work and NO hashing on a blocked attempt', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) await failOnce();

      users.findWithUserBySubject.mockClear();
      hasher.verify.mockClear();
      hasher.fakeVerify.mockClear();

      await expect(service.login('a@example.com', 'wrong', '203.0.113.9')).rejects.toThrow();

      // If any of these ran, the throttle would be the thing being exhausted.
      expect(users.findWithUserBySubject).not.toHaveBeenCalled();
      expect(hasher.verify).not.toHaveBeenCalled();
      expect(hasher.fakeVerify).not.toHaveBeenCalled();
    });

    it('does not let one blocked account block a different one from the same source', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) await failOnce();

      // Still under the per-IP budget, so a different subject is judged on its
      // own record — one noisy account must not lock out a shared office.
      await expect(
        service.login('someone-else@example.com', 'wrong', '203.0.113.9'),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  // --------------------------------------------------- changing a password --

  describe('★ changePassword: a change has to change something', () => {
    const CURRENT = 'the current passphrase';
    const DIFFERENT = 'a genuinely different passphrase';

    /**
     * The first-login gate exists so that a credential the deployment HANDED
     * out stops working. Submitting the same password back cleared
     * `must_change_secret` and left that credential live — measured, 204 and
     * the flag false — which made the gate a formality.
     */
    it('★ REFUSES a new password identical to the current one', async () => {
      await expect(
        service.changePassword({
          userId: activeUser.id,
          currentPassword: CURRENT,
          newPassword: CURRENT,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('★ leaves the credential and the flag untouched when it refuses', async () => {
      // `replaceLocalSecret` is the only write, and it is what clears
      // `must_change_secret`. Not calling it is what "the flag stands" means.
      await expect(
        service.changePassword({
          userId: activeUser.id,
          currentPassword: CURRENT,
          newPassword: CURRENT,
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(users.replaceLocalSecret).not.toHaveBeenCalled();
    });

    it('★ does not end the session the caller is using to fix it', async () => {
      // A refused attempt is not a password change. Signing them out would
      // strand somebody mid-way through the one screen they are allowed to use.
      await expect(
        service.changePassword({
          userId: activeUser.id,
          currentPassword: CURRENT,
          newPassword: CURRENT,
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('accepts a genuinely different password, and still ends every session', async () => {
      hasher.hash.mockResolvedValue('new-hash');

      await service.changePassword({
        userId: activeUser.id,
        currentPassword: CURRENT,
        newPassword: DIFFERENT,
      });

      expect(users.replaceLocalSecret).toHaveBeenCalledWith(
        expect.objectContaining({ userId: activeUser.id, secretHash: 'new-hash' }),
        expect.anything(),
      );
      // Unchanged behaviour (§1): the session that made the change goes too.
      expect(sessions.revokeAllForUser).toHaveBeenCalled();
    });

    it('still rejects a wrong current password before anything else', async () => {
      hasher.verify.mockResolvedValue(false);

      await expect(
        service.changePassword({
          userId: activeUser.id,
          currentPassword: 'not it',
          newPassword: DIFFERENT,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(users.replaceLocalSecret).not.toHaveBeenCalled();
    });
  });
});
