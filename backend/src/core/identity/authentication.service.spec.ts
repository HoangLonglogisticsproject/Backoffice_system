import { UnauthorizedError } from '../../common/errors/domain.error';
import { LOCAL_PROVIDER, User } from '../users/user.entity';
import { UserRepository } from '../users/user.repository';
import { AuthenticationService, TooManyAttemptsError } from './authentication.service';
import { LoginThrottleService } from './login-throttle.service';
import type { PasswordHasher } from './password-hasher.port';
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
  let users: { findIdentityWithUser: jest.Mock };
  let sessions: { issue: jest.Mock; revoke: jest.Mock };
  let service: AuthenticationService;

  beforeEach(() => {
    hasher = {
      hash: jest.fn(),
      verify: jest.fn().mockResolvedValue(true),
      fakeVerify: jest.fn().mockResolvedValue(undefined),
    };
    users = { findIdentityWithUser: jest.fn() };
    sessions = {
      issue: jest.fn().mockResolvedValue({ token: 'tok', expiresAt: new Date() }),
      revoke: jest.fn(),
    };

    service = new AuthenticationService(
      users as unknown as UserRepository,
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
    users.findIdentityWithUser.mockResolvedValue({
      identity: identityFor('scrypt$digest'),
      user: activeUser,
    });

    const result = await service.login('a@example.com', 'right');

    expect(result.user.id).toBe('user-1');
    expect(result.session.token).toBe('tok');
    expect(sessions.issue).toHaveBeenCalledWith('user-1');
  });

  it('rejects a wrong password without issuing anything', async () => {
    users.findIdentityWithUser.mockResolvedValue({
      identity: identityFor('scrypt$digest'),
      user: activeUser,
    });
    hasher.verify.mockResolvedValue(false);

    await expectIndistinguishableRejection(service.login('a@example.com', 'wrong'));
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('rejects an unknown subject with the identical error', async () => {
    users.findIdentityWithUser.mockResolvedValue(null);

    await expectIndistinguishableRejection(service.login('nobody@example.com', 'anything'));
  });

  it('spends the same work on an unknown subject, so timing does not answer either', async () => {
    users.findIdentityWithUser.mockResolvedValue(null);

    await expect(service.login('nobody@example.com', 'x')).rejects.toThrow();

    // Without this, an unknown subject returns before any hashing happens and
    // the response time reveals what the message refuses to.
    expect(hasher.fakeVerify).toHaveBeenCalledTimes(1);
  });

  it('rejects a disabled user — and only AFTER checking the password', async () => {
    users.findIdentityWithUser.mockResolvedValue({
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
    users.findIdentityWithUser.mockResolvedValue({
      identity: identityFor(null),
      user: activeUser,
    });

    await expectIndistinguishableRejection(service.login('a@example.com', ''));
    expect(hasher.fakeVerify).toHaveBeenCalled();
  });

  it('looks the subject up under the local provider', async () => {
    users.findIdentityWithUser.mockResolvedValue(null);
    await expect(service.login('A@Example.com', 'x')).rejects.toThrow();

    expect(users.findIdentityWithUser).toHaveBeenCalledWith(LOCAL_PROVIDER, 'A@Example.com');
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
      users.findIdentityWithUser.mockResolvedValue({
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

      users.findIdentityWithUser.mockClear();
      hasher.verify.mockClear();
      hasher.fakeVerify.mockClear();

      await expect(service.login('a@example.com', 'wrong', '203.0.113.9')).rejects.toThrow();

      // If any of these ran, the throttle would be the thing being exhausted.
      expect(users.findIdentityWithUser).not.toHaveBeenCalled();
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
});
