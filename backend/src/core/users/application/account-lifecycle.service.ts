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
 * ★ `enable()` EXISTS NOW, AND ONLY FOR DRIVERS. The reason this file gave for
 * having no enable at all was: "re-enabling asks INTO WHICH DEPARTMENT, because
 * an active user with none is forbidden, and that answer has not been decided."
 * That objection is real and still stands — for an employee.
 *
 * It does not apply to a driver, and 0018 is what made that true. A driver
 * account is an active user with NO membership by construction: the whole point
 * of `account_type` is that "belongs to no unit" is a correct, permanent state
 * rather than a broken one. So there is no department to ask about, nothing to
 * decide, and nothing to invent. The invariant 0003 carries reads, accurately,
 * "an active EMPLOYEE holds exactly one active membership".
 *
 * ⚠ ENABLING IS NOT THE UNDO OF DISABLING, and must never become it. Disabling
 * revokes roles and kills sessions; enabling restores NEITHER. Roles come back
 * only by being granted again, with a new audit row — silently returning
 * authority somebody deliberately took away is the exact failure the table above
 * calls "re-enabling silently restores authority".
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
   * EnableDriver — putting a driver account back into service.
   *
   * ★ ONE WRITE, WHERE DISABLING IS FIVE, and the asymmetry is the design rather
   * than an unfinished job:
   *
   *   roles       NOT restored. They were revoked with an audit row; granting
   *               them again is a separate, deliberate act by somebody who
   *               decides to. Restoring them here would hand back authority
   *               nobody chose to hand back.
   *   sessions    NOT restored. A revoked session is gone; the person signs in
   *               again with the credential they already have.
   *   membership  NOTHING TO RESTORE. A driver has none — that is the state, not
   *               a gap — so the question that blocked `enable()` for years
   *               ("into which department") has no subject here.
   *
   * ★ DRIVERS ONLY, CHECKED AGAINST `account_type` AND NOT AGAINST THE ABSENCE
   * OF A MEMBERSHIP. An offboarded employee also has no active membership, so
   * "has no unit" would let this path quietly reactivate one into a deployment
   * where an active employee with no department is forbidden. The stored column
   * is the only thing that tells the two apart — which is exactly why 0018
   * stores it.
   */
  async enableDriver(userId: string, tx?: DatabaseQuery): Promise<User> {
    const run = async (tx: DatabaseQuery): Promise<User> => {
      const existing = await this.users.findById(userId, tx);
      if (!existing) throw new NotFoundError('User not found.');

      if (existing.accountType !== 'driver') {
        throw new ConflictError(
          'Only a driver account can be re-enabled. Re-enabling an employee has to say which department they return to, and that is not decided here.',
        );
      }

      // `expectedCurrent` makes a second concurrent enable affect no row, so the
      // caller hears "already active" instead of a success it did not cause —
      // the same shape `disable` uses, for the same reason.
      const enabled = await this.users.setStatus(
        { userId, status: 'active', expectedCurrent: 'disabled' },
        tx,
      );
      if (!enabled) throw new ConflictError('That account is already active.');

      return enabled;
    };

    return tx ? run(tx) : this.db.transaction(run);
  }
}
