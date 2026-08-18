import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { DepartmentMembership } from '../domain/department.entity';
import { DepartmentRepository } from '../persistence/department.repository';
import { MembershipRepository } from '../persistence/membership.repository';

/**
 * Who belongs where, and how that changes.
 *
 * ONE RULE SHAPES EVERY METHOD HERE:
 *
 *   AN ACTIVE USER HOLDS EXACTLY ONE ACTIVE MEMBERSHIP.
 *
 * The database enforces "at most one" with a partial unique index. "At least
 * one" cannot be a constraint — it is a claim about a row that must EXIST in
 * another table — so it is enforced structurally instead: there is no method
 * here that leaves a user with zero memberships. `transfer` closes one and
 * opens another in a single transaction; ending a membership without opening
 * another belongs to the account-disable flow, which disables the user in the
 * same transaction.
 *
 * That is why there is no `remove` on this class. Leaving the unit means
 * leaving the organization, which is an account lifecycle change rather than
 * an org-chart edit.
 */
@Injectable()
export class MembershipService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly departments: DepartmentRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  /**
   * EnrollMember — the first unit a person belongs to.
   *
   * For someone with no active membership at all: a freshly provisioned
   * account. Anyone who already belongs somewhere goes through `transfer`,
   * which is the invariant showing through rather than a limitation — you
   * cannot be added to a second unit, only moved.
   *
   * Takes an optional `tx` because provisioning must create the account and its
   * membership together or not at all.
   */
  async enroll(
    input: { userId: string; departmentId: string },
    tx?: DatabaseQuery,
  ): Promise<DepartmentMembership> {
    const run = async (executor: DatabaseQuery): Promise<DepartmentMembership> => {
      const department = await this.departments.findById(input.departmentId, executor);
      if (!department) throw new NotFoundError('Department not found.');
      if (department.status !== 'active') {
        throw new ConflictError('That department is archived and cannot take new members.');
      }

      const existing = await this.memberships.lockActiveForUser(input.userId, executor);
      if (existing) {
        throw new ConflictError(
          'That user already belongs to a department. Transfer them instead of enrolling them again.',
        );
      }

      return this.memberships.create(input, executor);
    };

    return tx ? run(tx) : this.db.transaction(run);
  }

  /**
   * TransferMembership — move a person from the unit they are in to another.
   *
   * End first, then open. The reverse order is not merely untidy: it violates
   * `uq_single_active_membership` and the transaction rolls back, so "belongs
   * to two units for a moment" is a state that cannot be committed rather than
   * a window somebody has to remember exists.
   *
   * The SOURCE is never supplied by a caller — it is read here from the user's
   * current membership, because where somebody is is a fact, not a claim.
   */
  async transfer(
    input: {
      userId: string;
      toDepartmentId: string;
      now?: Date;
    },
    tx?: DatabaseQuery,
  ): Promise<DepartmentMembership> {
    const now = input.now ?? new Date();

    const run = async (tx: DatabaseQuery): Promise<DepartmentMembership> => {
      const target = await this.departments.findById(input.toDepartmentId, tx);
      if (!target) throw new NotFoundError('Department not found.');
      if (target.status !== 'active') {
        throw new ConflictError('That department is archived and cannot take new members.');
      }

      const current = await this.memberships.lockActiveForUser(input.userId, tx);
      if (!current) {
        throw new ConflictError(
          'That user has no active department membership to transfer. Enroll them instead.',
        );
      }

      if (current.departmentId === input.toDepartmentId) {
        throw new ConflictError('That user already belongs to that department.');
      }

      const ended = await this.memberships.end(current.id, now, tx);
      // We hold the row lock, so losing a race is not possible here; a null
      // means the row changed under a lock we were holding.
      if (!ended) throw new Error('Ending the current membership affected no row under lock');

      return this.memberships.create(
        { userId: input.userId, departmentId: input.toDepartmentId },
        tx,
      );
    };

    // An approval workflow passes its own transaction so the membership change
    // and the decision it came from commit together.
    return tx ? run(tx) : this.db.transaction(run);
  }

  async listActiveMembers(departmentId: string): Promise<DepartmentMembership[]> {
    const department = await this.departments.findById(departmentId);
    if (!department) throw new NotFoundError('Department not found.');
    return this.memberships.listActiveInDepartment(departmentId);
  }

  async findActive(userId: string): Promise<DepartmentMembership | null> {
    return this.memberships.findActiveForUser(userId);
  }

  /** Everything this person has ever belonged to, including ended memberships. */
  async listHistory(userId: string): Promise<DepartmentMembership[]> {
    return this.memberships.listHistoryForUser(userId);
  }
}
