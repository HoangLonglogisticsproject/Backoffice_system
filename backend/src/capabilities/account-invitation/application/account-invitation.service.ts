import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain.error';
import { DATABASE, type Database } from '../../../common/types/database.port';
import { AppConfig } from '../../../config/app.config';
import { AuthorizationRepository } from '../../../core/authorization/persistence/authorization.repository';
import { IdentityRepository } from '../../../core/identity/persistence/identity.repository';
import { DepartmentRepository } from '../../../core/organization/persistence/department.repository';
import { AccountProvisioningService } from '../../../core/users/application/account-provisioning.service';
import { assertProvisionableEmail } from '../../../core/users/domain/email';
import { LOCAL_PROVIDER } from '../../../core/users/domain/user.entity';
import { AccountInvitation } from '../domain/account-invitation';
import { decodeCursor, toPage, type Page } from '../../../common/pagination/cursor';
import type { PageQuery } from '../../../common/pagination/page-query.dto';
import { AccountInvitationRepository } from '../persistence/account-invitation.repository';

export interface ApprovedInvitation {
  invitation: AccountInvitation;
  username: string;
  /**
   * The generated secret, returned EXACTLY ONCE.
   *
   * There is no email adapter in this deployment, so the approver's response is
   * the only channel that can carry it to the person it belongs to. It is never
   * stored in plaintext, never logged, and no endpoint can produce it again.
   */
  temporaryPassword: string;
}

/**
 * Hoàng Long's onboarding policy: a head invites, a global administrator decides.
 *
 * ACCOUNT CREATION IS NOT IMPLEMENTED HERE. `AccountProvisioningService` already
 * knows how to create a person, a credential and a membership atomically, and it
 * accepts the transaction this service opens — so approving an invitation is
 * "provision, then close the invitation", one commit. A second provisioning
 * implementation would be a second place for email normalisation, domain policy,
 * password hashing and the temporary-credential flag to drift apart.
 *
 * WHAT THIS OWNS: whether an address may be invited, who may decide, and the
 * fact that nothing at all exists until the decision.
 */
@Injectable()
export class AccountInvitationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly invitations: AccountInvitationRepository,
    private readonly provisioning: AccountProvisioningService,
    private readonly identities: IdentityRepository,
    private readonly departments: DepartmentRepository,
    private readonly assignments: AuthorizationRepository,
    private readonly config: AppConfig,
  ) {}

  /**
   * A head invites somebody who has no account.
   *
   * Nothing is created: no person, no credential, no membership, no role. The
   * invitation is a request, and a request that provisioned anything would make
   * "pending" a lie.
   */
  async create(input: {
    departmentId: string;
    requestedBy: string;
    email: string;
    reason?: string;
  }): Promise<AccountInvitation> {
    // Same rules as any other provisioning: shape, then the deployment's domain
    // allowlist. Applied here so a head learns immediately rather than after an
    // administrator has already agreed.
    const email = assertProvisionableEmail(input.email, this.config.allowedEmailDomains);

    return this.db.transaction(async (tx) => {
      const department = await this.departments.findById(input.departmentId, tx);
      if (!department) throw new NotFoundError('Department not found.');
      if (department.status !== 'active') {
        throw new ConflictError('That department is archived and cannot take new members.');
      }

      // An address that already has an account is not an invitation — it is a
      // person, and moving them is `TRANSFER_MEMBER`. This also covers a
      // disabled account: the address stays theirs, so it cannot be reused to
      // create a second one.
      if (await this.identities.subjectExists(LOCAL_PROVIDER, email, tx)) {
        throw new ConflictError(
          'That email already has an account. Transfer the existing person instead.',
        );
      }

      const pending = await this.invitations.findPendingByEmail(email, tx);
      if (pending) {
        throw new ConflictError('That email already has an invitation awaiting a decision.');
      }

      return this.invitations.create(
        {
          departmentId: input.departmentId,
          email,
          requestedBy: input.requestedBy,
          reason: input.reason?.trim() ?? null,
        },
        tx,
      );
    });
  }

  /**
   * Approving creates the account — person, credential, membership — and closes
   * the invitation, in ONE transaction.
   *
   * The world is re-read first: an invitation raised on Monday can be approved
   * on Friday, and by then the department may be archived, the head may have
   * been replaced, or the address may already have an account.
   */
  async approve(input: {
    invitationId: string;
    decidedBy: string;
    displayName?: string;
    now?: Date;
  }): Promise<ApprovedInvitation> {
    const now = input.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const invitation = await this.invitations.lockPending(input.invitationId, tx);
      if (!invitation) {
        throw new ConflictError('That invitation is not awaiting a decision.');
      }

      // The database refuses this too; answering here makes it readable.
      if (invitation.requestedBy === input.decidedBy) {
        throw new ConflictError('You cannot decide your own invitation.');
      }

      const department = await this.departments.findById(invitation.departmentId, tx);
      if (!department) throw new NotFoundError('Department not found.');
      if (department.status !== 'active') {
        throw new ConflictError('That department is archived and cannot take new members.');
      }

      const head = await this.assignments.findActiveHeadOfDepartment(invitation.departmentId, tx);
      if (head?.userId !== invitation.requestedBy) {
        throw new ConflictError('The requester no longer leads that department.');
      }

      // The race this closes: a global administrator creating the same account
      // through `POST /users` while the invitation sat pending. If it slips
      // past, `UNIQUE (provider, subject)` refuses the insert and this whole
      // transaction rolls back — leaving the invitation pending, not half-done.
      if (await this.identities.subjectExists(LOCAL_PROVIDER, invitation.email, tx)) {
        throw new ConflictError('That email already has an account.');
      }

      // No password is passed, so provisioning generates one and hands it back.
      const account = await this.provisioning.provision(
        {
          displayName: input.displayName?.trim() || invitation.email,
          email: invitation.email,
          departmentId: invitation.departmentId,
        },
        tx,
      );

      const decided = await this.invitations.decide(
        {
          id: invitation.id,
          status: 'approved',
          decidedBy: input.decidedBy,
          createdUserId: account.user.id,
          now,
        },
        tx,
      );
      if (!decided) throw new ConflictError('That invitation was decided concurrently.');

      return {
        invitation: decided,
        username: account.username,
        // Non-null by construction: provisioning generates one whenever no
        // password was supplied, which is always the case here.
        temporaryPassword: account.temporaryPassword as string,
      };
    });
  }

  /** Rejecting creates nothing. The address may be invited again afterwards. */
  async reject(input: {
    invitationId: string;
    decidedBy: string;
    now?: Date;
  }): Promise<AccountInvitation> {
    const now = input.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const invitation = await this.invitations.lockPending(input.invitationId, tx);
      if (!invitation) throw new ConflictError('That invitation is not awaiting a decision.');

      if (invitation.requestedBy === input.decidedBy) {
        throw new ConflictError('You cannot decide your own invitation.');
      }

      const decided = await this.invitations.decide(
        {
          id: invitation.id,
          status: 'rejected',
          decidedBy: input.decidedBy,
          createdUserId: null,
          now,
        },
        tx,
      );
      if (!decided) throw new ConflictError('That invitation was decided concurrently.');

      return decided;
    });
  }

  /** One page of this department's history, newest first. */
  async listForDepartment(
    departmentId: string,
    page: PageQuery,
  ): Promise<Page<AccountInvitation>> {
    const cursor = page.cursor ? decodeCursor(page.cursor) : undefined;
    const rows = await this.invitations.listForDepartmentPage(departmentId, page.limit, cursor);

    return toPage(rows, page.limit, (r) => ({ t: r.requestedAt.toISOString(), i: r.id }));
  }

  /** One page of the global decision queue, oldest first. */
  async listPending(page: PageQuery): Promise<Page<AccountInvitation>> {
    const cursor = page.cursor ? decodeCursor(page.cursor) : undefined;
    const rows = await this.invitations.listPendingPage(page.limit, cursor);

    return toPage(rows, page.limit, (r) => ({ t: r.requestedAt.toISOString(), i: r.id }));
  }
}
