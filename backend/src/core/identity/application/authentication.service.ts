import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '../../../common/types/database.port';
import { DomainError, NotFoundError, UnauthorizedError } from '../../../common/errors/domain.error';
import { assertPasswordAcceptable } from '../domain/password.policy';
import { LOCAL_PROVIDER } from '../../users/domain/user.entity';
import { IdentityRepository } from '../persistence/identity.repository';
import { PASSWORD_HASHER, type PasswordHasher } from '../domain/password-hasher.port';
import { LoginThrottleService } from './login-throttle.service';
import { IssuedSession, SessionService, SessionUser, toSessionUser } from './session.service';

/**
 * The login use case.
 *
 * Every rejection below returns the SAME error with the SAME message, and
 * takes roughly the same time. Unknown subject, wrong password and disabled
 * account are indistinguishable from outside — otherwise the login endpoint
 * doubles as an account-enumeration oracle, and "this email is not registered"
 * is exactly the answer an attacker wants before they start guessing.
 */

/** One message for every failure. Deliberately says nothing. */
const REJECTED = 'Invalid credentials.';

/**
 * Distinct from a failed login on purpose: 429 tells an honest user to wait,
 * and it says nothing about whether the account exists — the throttle counts
 * attempts, not accounts.
 */
export class TooManyAttemptsError extends DomainError {
  readonly code = 'TOO_MANY_ATTEMPTS';

  constructor(readonly retryAfterSeconds: number) {
    super('Too many attempts. Try again later.');
  }
}

export interface LoginResult {
  session: IssuedSession;
  user: SessionUser;
}

@Injectable()
export class AuthenticationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly identities: IdentityRepository,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottleService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async login(subject: string, password: string, ip = 'unknown'): Promise<LoginResult> {
    // Checked BEFORE the database and before any hashing: a blocked caller must
    // cost nothing, or the throttle becomes the thing being exhausted.
    const decision = this.throttle.check({ ip, subject });
    if (!decision.allowed) {
      throw new TooManyAttemptsError(decision.retryAfterSeconds ?? 0);
    }

    const found = await this.identities.findWithUserBySubject(LOCAL_PROVIDER, subject);

    if (!found) {
      // Burn the same work a real verification would, so an unknown subject
      // does not answer faster than a wrong password.
      await this.hasher.fakeVerify();
      this.throttle.recordFailure({ ip, subject });
      throw new UnauthorizedError(REJECTED);
    }

    const { identity, user } = found;

    // A local identity with no secret is a broken row, not a passwordless
    // login. Treated as a failed attempt rather than a crash.
    if (identity.secretHash === null) {
      await this.hasher.fakeVerify();
      this.throttle.recordFailure({ ip, subject });
      throw new UnauthorizedError(REJECTED);
    }

    const passwordMatches = await this.hasher.verify(password, identity.secretHash);
    if (!passwordMatches) {
      this.throttle.recordFailure({ ip, subject });
      throw new UnauthorizedError(REJECTED);
    }

    // Checked AFTER the password on purpose: checking first would let anyone
    // discover which accounts are disabled without knowing a password.
    if (user.status !== 'active') {
      this.throttle.recordFailure({ ip, subject });
      throw new UnauthorizedError(REJECTED);
    }

    this.throttle.recordSuccess({ ip, subject });

    return {
      session: await this.sessions.issue(user.id),
      user: toSessionUser(user),
    };
  }

  async logout(token: string): Promise<void> {
    await this.sessions.revoke(token);
  }

  /**
   * ChangePassword — the only thing a temporary credential can do.
   *
   * Four writes that must land together, and each one exists for a reason:
   *
   *   verify the current secret   proves it is the owner asking, not a hijacked
   *                               session
   *   replace the hash            the old secret dies here
   *   clear must_change_secret    provisioning is now complete
   *   revoke EVERY session        including the caller's own
   *
   * Cutting the caller's own session costs one re-login and buys a guarantee:
   * no session issued against the old secret survives the moment it stopped
   * being valid. A session that outlived a password change is exactly what
   * somebody changes their password to end.
   *
   * The current password is verified BEFORE the transaction so a wrong guess
   * costs no lock, and the throttle that protects login does not protect this —
   * an attacker here already holds a live session, which is a different
   * problem than guessing.
   */
  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();

    const identity = await this.identities.findLocalForUser(input.userId);
    if (!identity?.secretHash) throw new NotFoundError('No local credential for this account.');

    const correct = await this.hasher.verify(input.currentPassword, identity.secretHash);
    if (!correct) throw new UnauthorizedError(REJECTED);

    // Policy applies to the NEW secret only. Tightening it later must not make
    // an existing account impossible to log into.
    assertPasswordAcceptable(input.newPassword);

    const secretHash = await this.hasher.hash(input.newPassword);

    await this.db.transaction(async (tx) => {
      const replaced = await this.identities.replaceLocalSecret(
        { userId: input.userId, secretHash },
        tx,
      );
      if (replaced === 0) throw new NotFoundError('No local credential for this account.');

      await this.sessions.revokeAllForUser(input.userId, now, tx);
    });
  }
}
