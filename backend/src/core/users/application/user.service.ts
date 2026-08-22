import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain.error';
import { DATABASE, type Database } from '../../../common/types/database.port';
import { assertPasswordAcceptable } from '../../identity/domain/password.policy';
import { PASSWORD_HASHER, type PasswordHasher } from '../../identity/domain/password-hasher.port';
import { LOCAL_PROVIDER, User, normalizeSubject } from '../domain/user.entity';
import { IdentityRepository } from '../../identity/persistence/identity.repository';
import { UserRepository } from '../persistence/user.repository';

/**
 * User lifecycle.
 *
 * Creation only, for now: everything else — listing, editing, disabling other
 * people — is an authorization question, and answering it before Phase 4 would
 * mean inventing a rule this phase has no basis for.
 */
@Injectable()
export class UserService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserRepository,
    private readonly identities: IdentityRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async createWithPassword(input: {
    displayName: string;
    subject: string;
    password: string;
    /**
     * ★ DEFAULTS TO TRUE, and the default is the point.
     *
     * A password this method is HANDED was chosen by somebody, and the only
     * case where that somebody is the account owner is an operator typing one
     * at a prompt. Every other path — a recovery account made ahead of time, a
     * script, whatever calls this next — is a secret that travelled, and a
     * secret that travelled has to be replaced before it means anything.
     *
     * So forgetting this flag produces the STRICTER outcome. The reverse
     * default would let a new caller mint a permanent credential by omission,
     * and nothing would say so.
     */
    mustChangeSecret?: boolean;
  }): Promise<User> {
    // Policy lives at the authentication boundary, not on the User model —
    // tightening it later must not make existing rows invalid.
    assertPasswordAcceptable(input.password);

    const subject = normalizeSubject(input.subject);

    // Checked before hashing so a duplicate does not cost 100 ms of scrypt.
    // The unique index is still the authority — the repository turns the race
    // that slips past this check into the same error.
    //
    // The message names no subject on purpose. This path is a CLI today, but
    // the moment anything exposes user creation over HTTP, echoing back "an
    // identity already exists for x@y.z" makes it an account-enumeration
    // oracle. The caller already knows what they submitted.
    if (await this.identities.subjectExists(LOCAL_PROVIDER, subject)) {
      throw new ConflictError('That identity is already registered.');
    }

    const secretHash = await this.hasher.hash(input.password);

    // THE TRANSACTION BOUNDARY LIVES HERE, not in the repository: an account
    // and its credential must commit together, and later phases need a
    // membership insert to join this same transaction.
    return this.db.transaction(async (tx) => {
      const user = await this.users.insertUser({ displayName: input.displayName.trim() }, tx);
      await this.identities.insertLocal(
        { userId: user.id, subject, secretHash, mustChangeSecret: input.mustChangeSecret ?? true },
        tx,
      );
      return user;
    });
  }

  async requireById(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError('User not found.');
    return user;
  }
}
