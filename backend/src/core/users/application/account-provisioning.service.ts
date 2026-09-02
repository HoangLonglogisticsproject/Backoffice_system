import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ConflictError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { AppConfig } from '../../../config/app.config';
import { assertTemporaryPasswordAcceptable } from '../../identity/domain/password.policy';
import { PASSWORD_HASHER, type PasswordHasher } from '../../identity/domain/password-hasher.port';
import { IdentityRepository } from '../../identity/persistence/identity.repository';
import { MembershipService } from '../../organization/application/membership.service';
import { assertProvisionableEmail, localPartOfEmail } from '../domain/email';
import { AccountType, LOCAL_PROVIDER, User } from '../domain/user.entity';
import { UserRepository } from '../persistence/user.repository';

export interface ProvisionedAccount {
  user: User;
  /** Derived from the email; display only, never an authorization input. */
  username: string;
  /**
   * Present ONLY when this service generated the secret — the caller is then
   * the sole channel that can deliver it, and it exists nowhere else.
   */
  temporaryPassword?: string;
}

/** 24 bytes of CSPRNG, base64url — comfortably past the policy floor. */
const GENERATED_SECRET_BYTES = 24;

/**
 * Creating an account, atomically, with the department it belongs to.
 *
 * THE WHOLE POINT OF THIS CLASS IS THE TRANSACTION. An active user with no
 * department is a state the model forbids, so the account, its credential and
 * its membership are one commit or none. Splitting them across two calls would
 * expose exactly the forbidden state in between — briefly, and only sometimes,
 * which is the worst kind of bug.
 *
 * TWO CALLERS, which is why it takes an optional executor rather than always
 * opening its own transaction:
 *
 *   POST /users                     a global administrator creating an account
 *   invitation approval (Phase 5)   the same work, plus closing the invitation
 *                                   in the SAME transaction
 *
 * Depends on `organization` to enroll. That direction is deliberate and one-way:
 * provisioning needs to know where a person lands; `organization` never learns
 * that accounts exist.
 */
@Injectable()
export class AccountProvisioningService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly users: UserRepository,
    private readonly identities: IdentityRepository,
    private readonly memberships: MembershipService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Provisions an account into a department.
   *
   * `initialPassword` omitted means "generate one": the invitation flow has no
   * human to type a password, so the server produces it and hands it back
   * exactly once. Supplied means a global administrator chose it, and it is
   * never echoed back — repeating a value the caller just sent adds a place for
   * it to leak and tells them nothing.
   *
   * Either way the credential is temporary: `must_change_secret` is set, so the
   * account can log in and change its password and do nothing else until it has.
   */
  async provision(
    input: {
      displayName: string;
      email: string;
      /**
       * ★ OMITTED MEANS "THIS ACCOUNT BELONGS TO NO UNIT", WHICH IS A DRIVER.
       *
       * Every employee lands in a department and this stayed required for
       * years because of it. A driver is the first account that legitimately
       * has none — they are not staff of Operations or of Accounting, and
       * inventing a department named "Tài xế" to satisfy the signature would
       * put a fiction in the org chart to spare this line a branch.
       *
       * So absence is the input, and `enroll` is simply not called. Nothing
       * else about provisioning changes: same user row, same credential, same
       * `must_change_secret` first-login.
       */
      departmentId?: string;
      accountType?: AccountType;
      initialPassword?: string;
    },
    tx?: DatabaseQuery,
  ): Promise<ProvisionedAccount> {
    const displayName = input.displayName.trim();
    if (displayName.length === 0) {
      throw new ConflictError('Display name is required.');
    }

    // Provisioning-time rules: shape and domain. Neither is ever applied at
    // login — see `domain/email.ts` for why that asymmetry is deliberate.
    const email = assertProvisionableEmail(input.email, this.config.allowedEmailDomains);

    const generated = input.initialPassword === undefined;
    const password = input.initialPassword ?? randomBytes(GENERATED_SECRET_BYTES).toString('base64url');

    // THE TEMPORARY FLOOR, not the permanent one. What is created here is a
    // hand-over credential that opens nothing until it is replaced; holding it
    // to the passphrase rule an employee chooses for themselves would make
    // onboarding harder without making anything safer. See `password.policy`.
    assertTemporaryPasswordAcceptable(password);

    // Checked before hashing so a duplicate does not cost 100 ms of scrypt, and
    // before the transaction so the common conflict needs no rollback. The
    // unique index on (provider, subject) stays the authority for the race that
    // slips past this.
    if (await this.identities.subjectExists(LOCAL_PROVIDER, email)) {
      throw new ConflictError('That identity is already registered.');
    }

    const secretHash = await this.hasher.hash(password);

    const departmentId = input.departmentId;

    const run = async (executor: DatabaseQuery): Promise<User> => {
      const user = await this.users.insertUser(
        { displayName, ...(input.accountType ? { accountType: input.accountType } : {}) },
        executor,
      );
      await this.identities.insertLocal(
        { userId: user.id, subject: email, secretHash, mustChangeSecret: true },
        executor,
      );
      // ★ NO MEMBERSHIP FOR AN ACCOUNT WITH NO UNIT. Skipped, never faked.
      if (departmentId !== undefined) {
        await this.memberships.enroll({ userId: user.id, departmentId }, executor);
      }
      return user;
    };

    const user = tx ? await run(tx) : await this.db.transaction(run);

    return {
      user,
      username: localPartOfEmail(email),
      // The plaintext leaves this process exactly here, exactly once, and only
      // when nobody else could already know it.
      ...(generated ? { temporaryPassword: password } : {}),
    };
  }
}
