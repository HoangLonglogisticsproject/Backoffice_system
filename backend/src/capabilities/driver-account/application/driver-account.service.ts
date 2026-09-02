import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, ValidationError } from '../../../common/errors/domain.error';
import { DATABASE, type Database } from '../../../common/types/database.port';
import { AppConfig } from '../../../config/app.config';
import { IdentityRepository } from '../../../core/identity/persistence/identity.repository';
import { AccountProvisioningService } from '../../../core/users/application/account-provisioning.service';
import { assertProvisionableEmail } from '../../../core/users/domain/email';
import { LOCAL_PROVIDER } from '../../../core/users/domain/user.entity';
import {
  isUsableRejectionReason,
  type DriverAccountRequest,
  type DriverAccountRequestWithUsers,
} from '../domain/driver-account-request';
import { DriverAccountRequestRepository } from '../persistence/driver-account-request.repository';

/** What a newly provisioned driver hands back, once. */
export interface ProvisionedDriver {
  userId: string;
  displayName: string;
  username: string;
  /**
   * ★ PRESENT ONLY WHEN THE SERVER GENERATED IT — the approval path. When a
   * global administrator typed the password themselves it is not echoed back:
   * repeating a value the caller just sent adds a place for it to leak and
   * tells them nothing.
   */
  temporaryPassword?: string;
}

/**
 * Driver accounts: created directly, or proposed and then approved.
 *
 * ★ TWO DOORS, ONE OF WHICH IS NOT A DOOR. A global administrator creates a
 * driver outright. A department head can only PROPOSE one — the request they
 * create grants nothing, activates nothing, and has no route that could. That
 * separation is the requirement, and it is enforced here rather than by hiding
 * a button: `createDirectly` is reachable only behind `user.write`, which is
 * `'global'` and which no head holds.
 *
 * ★ AND A DRIVER GETS NO DEPARTMENT. Not an empty one, not a placeholder unit
 * named "Tài xế" — none. `AccountProvisioningService` skips enrollment when no
 * department is given, so there is no membership row to later mistake for
 * staff. Everything else about the account is the ordinary path: same user
 * table, same identity, same `must_change_secret` first login.
 */
@Injectable()
export class DriverAccountService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly requests: DriverAccountRequestRepository,
    private readonly provisioning: AccountProvisioningService,
    private readonly identities: IdentityRepository,
    private readonly config: AppConfig,
  ) {}

  /**
   * A global administrator creates a driver, active immediately.
   *
   * The password is theirs to choose, exactly as it is for an employee, and it
   * is used at once — nothing stores it and nothing echoes it.
   */
  async createDirectly(input: {
    displayName: string;
    email: string;
    initialPassword: string;
  }): Promise<ProvisionedDriver> {
    const provisioned = await this.provisioning.provision({
      displayName: input.displayName,
      email: input.email,
      // ★ NO `departmentId`. This is the whole difference from employee
      // creation, and it is an omission rather than a special value.
      accountType: 'driver',
      initialPassword: input.initialPassword,
    });

    return {
      userId: provisioned.user.id,
      displayName: provisioned.user.displayName,
      username: provisioned.username,
    };
  }

  /**
   * A department head proposes a driver. Nothing is created.
   *
   * ★ THE EMAIL IS VALIDATED NOW, NOT AT APPROVAL. A request that cannot
   * possibly become an account is worth refusing while the person who typed it
   * is still looking at the form — not days later on somebody else's screen.
   */
  async request(input: {
    displayName: string;
    email: string;
    requestedBy: string;
  }): Promise<DriverAccountRequest> {
    const displayName = input.displayName.trim();
    if (displayName.length === 0) {
      throw new ValidationError('A driver needs a name.');
    }

    const email = assertProvisionableEmail(input.email, this.config.allowedEmailDomains);

    if (await this.identities.subjectExists(LOCAL_PROVIDER, email)) {
      throw new ConflictError('That email already has an account.');
    }

    if (await this.requests.findPendingByEmail(email)) {
      throw new ConflictError('That email already has a request awaiting a decision.');
    }

    return this.requests.insert({ email, displayName, requestedBy: input.requestedBy });
  }

  /**
   * A global administrator approves: the account is created in the same
   * transaction that closes the request.
   *
   * ★ ONE COMMIT OR NONE. "Approved but no account exists" is a state the
   * database refuses to store, and this is what makes that promise keepable —
   * a failure anywhere below leaves the request pending, not half-decided.
   */
  async approve(input: {
    requestId: string;
    decidedBy: string;
    now?: Date;
  }): Promise<{ request: DriverAccountRequest; driver: ProvisionedDriver }> {
    const now = input.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const request = await this.requests.lockPending(input.requestId, tx);
      if (!request) throw new ConflictError('That request is not awaiting a decision.');

      // Also a CHECK constraint. Refused here so the answer is a sentence.
      if (request.requestedBy === input.decidedBy) {
        throw new ConflictError('You cannot decide your own request.');
      }

      // The address may have been claimed while the request waited.
      if (await this.identities.subjectExists(LOCAL_PROVIDER, request.email, tx)) {
        throw new ConflictError('That email already has an account.');
      }

      // ★ NO PASSWORD WAS SUPPLIED, so provisioning generates one and hands it
      // back. This is the only moment the plaintext exists outside the
      // approver's screen, and it is never written to the request.
      const account = await this.provisioning.provision(
        {
          displayName: request.displayName,
          email: request.email,
          accountType: 'driver',
        },
        tx,
      );

      const decided = await this.requests.decide(
        {
          id: request.id,
          status: 'approved',
          decidedBy: input.decidedBy,
          decisionReason: null,
          createdUserId: account.user.id,
          now,
        },
        tx,
      );
      if (!decided) throw new ConflictError('That request was decided concurrently.');

      return {
        request: decided,
        driver: {
          userId: account.user.id,
          displayName: account.user.displayName,
          username: account.username,
          // Non-null by construction: provisioning generates one whenever no
          // password was supplied, which is always the case here.
          temporaryPassword: account.temporaryPassword as string,
        },
      };
    });
  }

  /** Rejecting creates nothing. The address may be proposed again afterwards. */
  async reject(input: {
    requestId: string;
    decidedBy: string;
    reason: string;
    now?: Date;
  }): Promise<DriverAccountRequest> {
    // ★ REFUSED BEFORE THE TRANSACTION OPENS. The database would refuse it too,
    // but a constraint violation reaches the caller as a 500 while this reaches
    // them as the sentence that says what to do.
    if (!isUsableRejectionReason(input.reason)) {
      throw new ValidationError('A rejection needs a reason the requester can act on.');
    }
    const reason = input.reason.trim();
    const now = input.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const request = await this.requests.lockPending(input.requestId, tx);
      if (!request) throw new ConflictError('That request is not awaiting a decision.');

      if (request.requestedBy === input.decidedBy) {
        throw new ConflictError('You cannot decide your own request.');
      }

      const decided = await this.requests.decide(
        {
          id: request.id,
          status: 'rejected',
          decidedBy: input.decidedBy,
          decisionReason: reason,
          createdUserId: null,
          now,
        },
        tx,
      );
      if (!decided) throw new ConflictError('That request was decided concurrently.');

      return decided;
    });
  }

  listPending(): Promise<DriverAccountRequestWithUsers[]> {
    return this.requests.listPending();
  }

  /** What this head proposed, and what came of it. */
  listMine(requestedBy: string): Promise<DriverAccountRequestWithUsers[]> {
    return this.requests.listByRequester(requestedBy);
  }
}
