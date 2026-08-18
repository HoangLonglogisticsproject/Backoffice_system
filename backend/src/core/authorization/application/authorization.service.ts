import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { DepartmentRepository } from '../../organization/persistence/department.repository';
import { MembershipRepository } from '../../organization/persistence/membership.repository';
import { SessionService } from '../../identity/application/session.service';
import type { AuthorizationContext } from '../domain/authorization.context';
import { AuthorizationRepository, RoleAssignment } from '../persistence/authorization.repository';

/**
 * Granting and revoking authority.
 *
 * Three invariants shape every method here, and only two of them are the
 * database's to keep:
 *
 *   #1  at most one active SuperAdmin        → partial unique index
 *   #2  at most one active head per unit     → partial unique index
 *   #6  an active head holds an active membership of that unit
 *                                            → composite foreign key
 *   #7  never ZERO active SuperAdmins via the API
 *                                            → THIS CLASS, and nowhere else
 *
 * #7 cannot be a constraint: "at least one row must exist" is not something a
 * CHECK, a foreign key or an index can say about a table that is allowed to be
 * empty. So it is a guard, it is stated here, and the CLI is deliberately
 * exempt from it — the operator holding a shell is how a locked-out deployment
 * gets recovered.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repository: AuthorizationRepository,
    private readonly departments: DepartmentRepository,
    private readonly memberships: MembershipRepository,
    private readonly sessions: SessionService,
  ) {}

  async loadContext(userId: string): Promise<AuthorizationContext> {
    return this.repository.loadContext(userId);
  }

  /** The caller's login name, for display. Never an authorization input. */
  async findLocalSubject(userId: string): Promise<string | null> {
    return this.repository.findLocalSubject(userId);
  }

  // ------------------------------------------------------ department head --

  /**
   * AssignDepartmentHead.
   *
   * The head must already be an active member of that department — invariant #6
   * — and the membership row is named explicitly on the assignment rather than
   * looked up later, which is what lets the foreign key police the rule
   * afterwards.
   *
   * The whole thing runs in one transaction with the membership locked: without
   * the lock, the membership could end between the read and the insert, and the
   * assignment would be created against a membership that no longer exists.
   */
  async assignDepartmentHead(input: {
    userId: string;
    departmentId: string;
    grantedBy: string;
  }): Promise<RoleAssignment> {
    return this.db.transaction(async (tx) => {
      const department = await this.departments.findById(input.departmentId, tx);
      if (!department) throw new NotFoundError('Department not found.');
      if (department.status !== 'active') {
        throw new ConflictError('That department is archived.');
      }

      const membership = await this.memberships.lockActiveForUser(input.userId, tx);
      if (!membership || membership.departmentId !== input.departmentId) {
        throw new ConflictError(
          'A department head must hold an active membership of the department they lead.',
        );
      }

      return this.repository.grant(
        {
          userId: input.userId,
          roleKey: 'DEPARTMENT_HEAD',
          scopeId: input.departmentId,
          membershipId: membership.id,
          grantedVia: 'api',
          grantedBy: input.grantedBy,
        },
        tx,
      );
    });
  }

  // ------------------------------------------------------------ superadmin --

  /**
   * BootstrapSuperAdmin — the first one, or a recovery.
   *
   * `granted_via = 'bootstrap'` with no `granted_by`, because there is no actor
   * inside the system to name: the first SuperAdmin has nobody above them. That
   * provenance is what makes the null meaningful rather than merely absent.
   *
   * Exempt from invariant #7 by design — this is the path that CREATES the
   * SuperAdmin a locked-out deployment lacks.
   */
  async bootstrapSuperAdmin(userId: string): Promise<RoleAssignment> {
    return this.repository.grant({
      userId,
      roleKey: 'SUPERADMIN',
      scopeId: null,
      membershipId: null,
      grantedVia: 'bootstrap',
      grantedBy: null,
    });
  }

  /**
   * TransferSuperAdmin — revoke, then grant, then cut the old holder's sessions.
   *
   * That order is forced by the database, not chosen: granting first collides
   * with `uq_single_active_superadmin` and the transaction rolls back. So "two
   * SuperAdmins for a moment" is a state that cannot be committed rather than a
   * window somebody has to remember.
   *
   * The session revocation is inside the transaction too: leaving the previous
   * holder with a live session would mean their authority survives the moment
   * it was taken away, for up to the session lifetime.
   */
  async transferSuperAdmin(input: {
    toUserId: string;
    actingUserId: string;
    now?: Date;
  }): Promise<RoleAssignment> {
    const now = input.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const current = await this.repository.findActiveSuperAdmin(tx);
      if (!current) {
        throw new ConflictError('There is no active SuperAdmin to hand over from.');
      }
      if (current.userId === input.toUserId) {
        throw new ConflictError('That user is already the SuperAdmin.');
      }

      const revoked = await this.repository.revoke(
        { id: current.id, revokedVia: 'api', revokedBy: input.actingUserId, now },
        tx,
      );
      if (!revoked) throw new ConflictError('The SuperAdmin assignment changed concurrently.');

      const granted = await this.repository.grant(
        {
          userId: input.toUserId,
          roleKey: 'SUPERADMIN',
          scopeId: null,
          membershipId: null,
          grantedVia: 'api',
          grantedBy: input.actingUserId,
        },
        tx,
      );

      await this.sessions.revokeAllForUser(current.userId, now, tx);

      return granted;
    });
  }

  /**
   * RevokeRoleAssignment, addressed by assignment — the path invariant #7
   * guards.
   *
   * Refuses to revoke the ONLY active SuperAdmin, because that would leave the
   * deployment with nobody able to administer it and no API path back. Global
   * authority moves through `transferSuperAdmin`, never through a revocation.
   *
   * For a head this is a DEMOTION and nothing more: the membership stays, the
   * account stays active, and the person becomes an ordinary member. Those are
   * two lifecycles, and collapsing them would mean demoting somebody silently
   * removed them from the company.
   */
  async revokeAssignment(input: {
    assignmentId: string;
    revokedBy: string;
    now?: Date;
  }): Promise<RoleAssignment> {
    return this.db.transaction(async (tx) => {
      const assignment = await this.repository.findActiveAssignmentById(input.assignmentId, tx);
      if (!assignment) throw new NotFoundError('Active role assignment not found.');

      if (assignment.roleKey === 'SUPERADMIN') {
        throw new ConflictError(
          'Refusing to leave the system with no SuperAdmin. Hand the role over instead.',
        );
      }

      return this.revokeActive(assignment, input.revokedBy, input.now ?? new Date(), tx);
    });
  }

  /**
   * Revokes every elevated assignment a user holds, inside a caller's
   * transaction.
   *
   * Exposed for the account-disable and member-removal flows, which must revoke
   * roles BEFORE ending the membership: invariant #6's foreign key rejects
   * ending a membership while its head assignment is still active, so the
   * reverse order cannot be committed.
   */
  async revokeAllForUser(
    input: { userId: string; revokedBy: string; now?: Date },
    tx: DatabaseQuery,
  ): Promise<number> {
    return this.repository.revokeAllForUser(
      {
        userId: input.userId,
        revokedVia: 'api',
        revokedBy: input.revokedBy,
        now: input.now ?? new Date(),
      },
      tx,
    );
  }

  async listActiveAssignmentsForUser(userId: string): Promise<RoleAssignment[]> {
    return this.repository.listActiveAssignmentsForUser(userId);
  }

  async findActiveHeadOfDepartment(departmentId: string): Promise<RoleAssignment | null> {
    return this.repository.findActiveHeadOfDepartment(departmentId);
  }

  /**
   * RevokeHeadOfDepartment — the same act as `revokeDepartmentHead`, addressed
   * by DEPARTMENT rather than by assignment.
   *
   * The HTTP surface is keyed on the unit, because that is what an administrator
   * knows: "this department should have no head". Looking the assignment up and
   * revoking it are ONE transaction on purpose — done as two calls, the head
   * could change in between and the second call would revoke somebody the
   * caller never saw.
   *
   * Revoking leadership is not leaving the department: the membership stays and
   * the person becomes an ordinary member.
   */
  async revokeHeadOfDepartment(input: {
    departmentId: string;
    revokedBy: string;
    now?: Date;
  }): Promise<RoleAssignment> {
    const now = input.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const assignment = await this.repository.findActiveHeadOfDepartment(input.departmentId, tx);
      if (!assignment) throw new NotFoundError('That department has no active head.');

      // No SuperAdmin check here, unlike `revokeAssignment`: this lookup only
      // ever returns DEPARTMENT_HEAD rows, so a global assignment cannot arrive.
      return this.revokeActive(assignment, input.revokedBy, now, tx);
    });
  }

  /**
   * The revocation itself, shared by the two paths that reach it.
   *
   * They differ in HOW the assignment is found — by id, or by the department it
   * scopes — and agree on everything after. `revoke` reports rows affected, so
   * two concurrent callers cannot both succeed: the loser gets the conflict
   * rather than a silent no-op.
   *
   * Takes the caller's transaction, never opening one: both callers have
   * already read the assignment inside theirs, and re-reading it on another
   * connection would defeat the reason they did.
   */
  private async revokeActive(
    assignment: RoleAssignment,
    revokedBy: string,
    now: Date,
    tx: DatabaseQuery,
  ): Promise<RoleAssignment> {
    const revoked = await this.repository.revoke(
      { id: assignment.id, revokedVia: 'api', revokedBy, now },
      tx,
    );
    if (!revoked) throw new ConflictError('That assignment was already revoked.');

    return revoked;
  }
}
