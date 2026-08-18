import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain.error';
import { DATABASE, type Database } from '../../../common/types/database.port';
import { AuthorizationRepository } from '../../../core/authorization/persistence/authorization.repository';
import { MembershipService } from '../../../core/organization/application/membership.service';
import { DepartmentRepository } from '../../../core/organization/persistence/department.repository';
import { MembershipRepository } from '../../../core/organization/persistence/membership.repository';
import { AccountLifecycleService } from '../../../core/users/application/account-lifecycle.service';
import { UserRepository } from '../../../core/users/persistence/user.repository';
import { MembershipChangeRequest, RequestAction } from '../domain/membership-request';
import { MembershipRequestRepository } from '../persistence/membership-request.repository';

/**
 * Hoàng Long's approval workflow: a head proposes, a global administrator decides.
 *
 * THIS CLASS OWNS NO MEMBERSHIP LOGIC. Transferring somebody and offboarding
 * them already exist in core — `MembershipService.transfer` and
 * `AccountLifecycleService.disable` — and both accept the transaction this
 * service opens, so the decision and its effect commit together. Re-implementing
 * either here would produce a second version of a rule that must never differ
 * from the first.
 *
 * What it does own: whether a request may be raised, whether it may be decided,
 * and re-checking the world at decision time.
 *
 * WHY RE-VALIDATION MATTERS. A request created on Monday can be approved on
 * Friday. In between, the target may have moved unit, been disabled, or the
 * requester may have stopped being a head. Trusting the values captured at
 * creation would move the wrong person, out of the wrong place, on the authority
 * of somebody who no longer has it — so every one of them is read again inside
 * the deciding transaction.
 */
@Injectable()
export class MembershipRequestService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly requests: MembershipRequestRepository,
    private readonly memberships: MembershipService,
    private readonly membershipRows: MembershipRepository,
    private readonly departments: DepartmentRepository,
    private readonly users: UserRepository,
    private readonly assignments: AuthorizationRepository,
    private readonly accounts: AccountLifecycleService,
  ) {}

  /**
   * A head raises a request about somebody in the unit they lead.
   *
   * The SOURCE department is read from the target's active membership. It is
   * never taken from the caller: where a person currently sits is a fact, and
   * accepting a claim about it would let a head act on somebody who left.
   */
  async create(input: {
    routeDepartmentId: string;
    requestedBy: string;
    targetUserId: string;
    action: RequestAction;
    targetDepartmentId?: string;
    reason?: string;
  }): Promise<MembershipChangeRequest> {
    return this.db.transaction(async (tx) => {
      const target = await this.users.findById(input.targetUserId, tx);
      if (!target) throw new NotFoundError('User not found.');
      if (target.status !== 'active') {
        throw new ConflictError('That user is not active.');
      }

      const membership = await this.membershipRows.findActiveForUser(input.targetUserId, tx);
      if (!membership) {
        throw new ConflictError('That user has no active department membership.');
      }

      // A head may only raise requests about their OWN people. The route already
      // proved they lead that unit; this proves the target is in it.
      if (membership.departmentId !== input.routeDepartmentId) {
        throw new ConflictError('That user does not belong to the department you lead.');
      }

      const targetDepartmentId =
        input.action === 'TRANSFER_MEMBER'
          ? await this.resolveTransferTarget(input.targetDepartmentId, membership.departmentId, tx)
          : null;

      // Checked before insert so the common case reads clearly; the partial
      // unique index is still the authority for two heads racing.
      const existing = await this.requests.findPendingFor(
        {
          departmentId: membership.departmentId,
          targetUserId: input.targetUserId,
          action: input.action,
        },
        tx,
      );
      if (existing) {
        throw new ConflictError('An identical request is already awaiting a decision.');
      }

      return this.requests.create(
        {
          departmentId: membership.departmentId,
          targetDepartmentId,
          targetUserId: input.targetUserId,
          action: input.action,
          requestedBy: input.requestedBy,
          reason: input.reason?.trim() ?? null,
        },
        tx,
      );
    });
  }

  private async resolveTransferTarget(
    targetDepartmentId: string | undefined,
    sourceDepartmentId: string,
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  ): Promise<string> {
    if (!targetDepartmentId) {
      throw new ConflictError('A transfer must name the department to move the user into.');
    }
    if (targetDepartmentId === sourceDepartmentId) {
      throw new ConflictError('That user already belongs to that department.');
    }

    const destination = await this.departments.findById(targetDepartmentId, tx);
    if (!destination) throw new NotFoundError('Department not found.');
    if (destination.status !== 'active') {
      throw new ConflictError('That department is archived and cannot take new members.');
    }

    return targetDepartmentId;
  }

  /**
   * A global administrator approves — and the effect lands in the same
   * transaction as the decision.
   *
   * Everything captured at creation is read again here. If the world moved, the
   * answer is 409 and nothing changes; the requester raises a fresh request
   * against the world as it now is.
   */
  async approve(input: {
    requestId: string;
    decidedBy: string;
    now?: Date;
  }): Promise<MembershipChangeRequest> {
    const now = input.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const request = await this.requests.lockPending(input.requestId, tx);
      if (!request) {
        // Either it never existed or somebody else already decided it. Both are
        // conflicts from here, and telling them apart would leak nothing useful.
        throw new ConflictError('That request is not awaiting a decision.');
      }

      // The database refuses a self-approval too; this produces the readable
      // answer before the constraint has to.
      if (request.requestedBy === input.decidedBy) {
        throw new ConflictError('You cannot decide your own request.');
      }

      await this.revalidate(request, tx);

      if (request.action === 'TRANSFER_MEMBER') {
        // Core owns the move. It re-reads the source membership under its own
        // lock, so the source is derived twice and trusted zero times.
        await this.memberships.transfer(
          { userId: request.targetUserId, toDepartmentId: request.targetDepartmentId!, now },
          tx,
        );
      } else {
        // Core owns offboarding: revoke roles, disable, cut sessions, end
        // membership — in that order, because invariant #6 forbids the other.
        await this.accounts.disable(
          { userId: request.targetUserId, actingUserId: input.decidedBy, now },
          tx,
        );
      }

      const decided = await this.requests.decide(
        { id: request.id, status: 'approved', decidedBy: input.decidedBy, now },
        tx,
      );
      if (!decided) throw new ConflictError('That request was decided concurrently.');

      return decided;
    });
  }

  /** Rejecting changes nothing but the request. */
  async reject(input: {
    requestId: string;
    decidedBy: string;
    now?: Date;
  }): Promise<MembershipChangeRequest> {
    const now = input.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const request = await this.requests.lockPending(input.requestId, tx);
      if (!request) throw new ConflictError('That request is not awaiting a decision.');

      if (request.requestedBy === input.decidedBy) {
        throw new ConflictError('You cannot decide your own request.');
      }

      const decided = await this.requests.decide(
        { id: request.id, status: 'rejected', decidedBy: input.decidedBy, now },
        tx,
      );
      if (!decided) throw new ConflictError('That request was decided concurrently.');

      return decided;
    });
  }

  /**
   * The world, re-read at decision time.
   *
   * Each check answers a way the request could have gone stale between being
   * raised and being decided.
   */
  private async revalidate(
    request: MembershipChangeRequest,
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  ): Promise<void> {
    const target = await this.users.findById(request.targetUserId, tx);
    if (!target) throw new NotFoundError('User not found.');
    if (target.status !== 'active') {
      throw new ConflictError('That user is no longer active.');
    }

    const membership = await this.membershipRows.findActiveForUser(request.targetUserId, tx);
    if (!membership) {
      throw new ConflictError('That user no longer has an active department membership.');
    }
    if (membership.departmentId !== request.departmentId) {
      throw new ConflictError('That user has moved department since this request was raised.');
    }

    // The requester's authority is re-checked, not remembered: a head who was
    // demoted must not still be able to move people through a request they
    // raised while they could.
    const head = await this.assignments.findActiveHeadOfDepartment(request.departmentId, tx);
    if (!head || head.userId !== request.requestedBy) {
      throw new ConflictError('The requester no longer leads that department.');
    }

    if (request.action === 'TRANSFER_MEMBER') {
      const destination = await this.departments.findById(request.targetDepartmentId!, tx);
      if (!destination) throw new NotFoundError('Department not found.');
      if (destination.status !== 'active') {
        throw new ConflictError('That department is archived and cannot take new members.');
      }
      if (destination.id === membership.departmentId) {
        throw new ConflictError('That user already belongs to that department.');
      }
    }
  }

  async listForDepartment(departmentId: string): Promise<MembershipChangeRequest[]> {
    return this.requests.listForDepartment(departmentId);
  }

  async listPending(): Promise<MembershipChangeRequest[]> {
    return this.requests.listPending();
  }
}
