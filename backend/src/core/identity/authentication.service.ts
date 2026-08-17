import { Inject, Injectable } from '@nestjs/common';
import { DomainError, UnauthorizedError } from '../../common/errors/domain.error';
import { LOCAL_PROVIDER } from '../users/user.entity';
import { UserRepository } from '../users/user.repository';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher.port';
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
    private readonly users: UserRepository,
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

    const found = await this.users.findIdentityWithUser(LOCAL_PROVIDER, subject);

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
}
