import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { SessionRepository } from '../../identity/persistence/session.repository';
import { AuthorizationRepository } from '../../authorization/persistence/authorization.repository';
import { MembershipRepository } from '../../organization/persistence/membership.repository';
import { User } from '../domain/user.entity';
import { UserRepository } from '../persistence/user.repository';

/**
 * Taking somebody out of the deployment.
 *
 * "Disable" is not one write. It is five, and they must all land together —
 * every partial outcome is a security hole with a name:
 *
 *   status flipped, sessions alive      → they keep working until the cookie expires
 *   status flipped, roles kept          → re-enabling silently restores authority
 *   status flipped, membership kept     → a disabled person still counted in a unit
 *   roles revoked, status not flipped   → demoted without being disabled
 *
 * THE ORDER IS FORCED BY THE DATABASE, not chosen. Invariant #6 says an active
 * head assignment must point at an active membership, enforced by a foreign key
 * — so ending the membership before revoking the role is rejected outright.
 * Revoke first and the generated column goes NULL, the foreign key stops
 * applying, and the membership can close.
 *
 * There is deliberately NO enable() here. Re-enabling asks "into which
 * department", because an active user with none is forbidden, and that answer
 * has not been decided. Inventing one would be inventing business rules.
 */
@Injectable()
export class AccountLifecycleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserRepository,
    private readonly assignments: AuthorizationRepository,
    private readonly sessions: SessionRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  /**
   * DisableUser — remove somebody from the organization.
   *
   * Refuses to disable the only active SuperAdmin. That is invariant #7, and it
   * cannot be a database constraint: "at least one row must exist" is not
   * something a CHECK can say about a table allowed to be empty. So it is a
   * guard, it lives here, and the bootstrap CLI is deliberately exempt — the
   * operator with a shell is how a locked-out deployment recovers.
   */
  async disable(
    input: { userId: string; actingUserId: string; now?: Date },
    tx?: DatabaseQuery,
  ): Promise<User> {
    const now = input.now ?? new Date();

    const run = async (tx: DatabaseQuery): Promise<User> => {
      const active = await this.assignments.listActiveAssignmentsForUser(input.userId, tx);
      const holdsGlobal = active.some((assignment) => assignment.roleKey === 'SUPERADMIN');

      if (holdsGlobal) {
        // Reading it inside the transaction is what makes the check meaningful:
        // outside it, another hand-over could commit in between.
        const superAdmin = await this.assignments.findActiveSuperAdmin(tx);
        if (superAdmin?.userId === input.userId) {
          throw new ConflictError(
            'Refusing to leave the deployment with no SuperAdmin. Hand the role over first.',
          );
        }
      }

      // 1. Roles first — invariant #6 rejects step 4 otherwise.
      await this.assignments.revokeAllForUser(
        { userId: input.userId, revokedVia: 'api', revokedBy: input.actingUserId, now },
        tx,
      );

      // 2. The account itself. `expectedCurrent` makes a second concurrent
      //    disable affect no row, so the caller hears "already disabled"
      //    instead of a success it did not cause.
      const disabled = await this.users.setStatus(
        { userId: input.userId, status: 'disabled', expectedCurrent: 'active' },
        tx,
      );
      if (!disabled) {
        const existing = await this.users.findById(input.userId, tx);
        if (!existing) throw new NotFoundError('User not found.');
        throw new ConflictError('That user is already disabled.');
      }

      // 3. Every session, including the one they are using right now.
      await this.sessions.revokeAllForUser(input.userId, now, tx);

      // 4. Their place in the organization. A disabled person holds no active
      //    membership — the other half of "an active user holds exactly one".
      const membership = await this.memberships.lockActiveForUser(input.userId, tx);
      if (membership) {
        await this.memberships.end(membership.id, now, tx);
      }

      return disabled;
    };

    // The offboarding approval passes its own transaction, so closing the
    // request and disabling the account are one commit.
    return tx ? run(tx) : this.db.transaction(run);
  }

  /**
   * EnableUser — the way back, for a DRIVER account only.
   *
   * ★ ONE WRITE, AND THAT IS THE WHOLE DEFINITION. `status` goes back to
   * `active`; nothing else is touched. No session is issued (they sign in
   * again), no role is restored (a driver never held one), no membership is
   * created (a driver has none), and nothing in dispatch — assignments,
   * trips, expenses, completions — is read or written. The account lifecycle
   * and the assignment lifecycle are separate concerns, and re-enabling is
   * where that separation is easiest to break by "helpfully" doing more.
   *
   * ⚠ AN EMPLOYEE IS REFUSED, NOT BECAUSE IT IS HARD BUT BECAUSE IT IS
   * UNDECIDED. Disabling ended their membership, and "an active user holds
   * exactly one" means re-enabling one asks "into which department" — a
   * question this deployment has not answered. A driver has no membership to
   * restore, so for them the flip is complete on its own.
   */
  async enable(
    input: { userId: string; actingUserId: string; now?: Date },
    tx?: DatabaseQuery,
  ): Promise<User> {
    const run = async (tx: DatabaseQuery): Promise<User> => {
      const user = await this.users.findById(input.userId, tx);
      if (!user) throw new NotFoundError('User not found.');
      if (user.accountType !== 'driver') {
        throw new ConflictError(
          'Only a driver account can be re-enabled. Re-enabling an employee is not available.',
        );
      }

      // `expectedCurrent` makes two simultaneous enables — or an enable racing
      // a disable — resolve to one winner and one sentence.
      const enabled = await this.users.setStatus(
        { userId: input.userId, status: 'active', expectedCurrent: 'disabled' },
        tx,
      );
      if (!enabled) throw new ConflictError('That user is already active.');

      return enabled;
    };

    return tx ? run(tx) : this.db.transaction(run);
  }
}
