import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type {
  DriverAccountRequest,
  DriverAccountRequestWithUsers,
  DriverRequestStatus,
} from '../domain/driver-account-request';

interface RequestRow {
  id: string;
  email: string;
  display_name: string;
  status: DriverRequestStatus;
  requested_by: string;
  requested_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  created_user_id: string | null;
}

interface RequestWithUsersRow extends RequestRow {
  requester_name: string;
  decider_name: string | null;
}

const toRequest = (row: RequestRow): DriverAccountRequest => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  status: row.status,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  decisionReason: row.decision_reason,
  createdUserId: row.created_user_id,
});

const toRequestWithUsers = (row: RequestWithUsersRow): DriverAccountRequestWithUsers => ({
  ...toRequest(row),
  requester: { id: row.requested_by, displayName: row.requester_name },
  decider: row.decided_by ? { id: row.decided_by, displayName: row.decider_name ?? '' } : null,
});

/**
 * SQL for driver account requests. No decisions — who may request, who may
 * decide and whether a rejection needs a reason all live in the service.
 */
@Injectable()
export class DriverAccountRequestRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async insert(
    input: { email: string; displayName: string; requestedBy: string },
    executor: DatabaseQuery = this.db,
  ): Promise<DriverAccountRequest> {
    const rows = await executor.query<RequestRow>(
      `INSERT INTO driver_account_requests (email, display_name, requested_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.email, input.displayName, input.requestedBy],
    );

    const row = rows[0];
    if (!row) throw new Error('Insert returned no driver account request.');
    return toRequest(row);
  }

  /**
   * ★ `FOR UPDATE`, AND IT IS WHAT MAKES A DOUBLE DECISION IMPOSSIBLE.
   *
   * Two administrators opening the same pending request and both clicking is
   * the ordinary case, not the exotic one. The second transaction waits here,
   * then reads a row that is no longer `pending` and gets nothing back — so it
   * is refused with a sentence rather than overwriting the first decision.
   */
  async lockPending(id: string, executor: DatabaseQuery): Promise<DriverAccountRequest | null> {
    const rows = await executor.query<RequestRow>(
      "SELECT * FROM driver_account_requests WHERE id = $1 AND status = 'pending' FOR UPDATE",
      [id],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async findPendingByEmail(
    email: string,
    executor: DatabaseQuery = this.db,
  ): Promise<DriverAccountRequest | null> {
    const rows = await executor.query<RequestRow>(
      "SELECT * FROM driver_account_requests WHERE email = $1 AND status = 'pending'",
      [email],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  /**
   * Records the decision, but only while the row is still pending.
   *
   * ★ THE `status = 'pending'` PREDICATE IS THE SECOND LOCK. Even reached
   * without `lockPending`, this updates zero rows on an already-decided
   * request, so the caller learns it lost rather than silently winning.
   */
  async decide(
    input: {
      id: string;
      status: Exclude<DriverRequestStatus, 'pending'>;
      decidedBy: string;
      decisionReason: string | null;
      createdUserId: string | null;
      now: Date;
    },
    executor: DatabaseQuery,
  ): Promise<DriverAccountRequest | null> {
    const rows = await executor.query<RequestRow>(
      `UPDATE driver_account_requests
          SET status = $2,
              decided_by = $3,
              decided_at = $4,
              decision_reason = $5,
              created_user_id = $6
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [
        input.id,
        input.status,
        input.decidedBy,
        input.now,
        input.decisionReason,
        input.createdUserId,
      ],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  /** The reviewer's queue: still waiting, longest wait first. */
  async listPending(executor: DatabaseQuery = this.db): Promise<DriverAccountRequestWithUsers[]> {
    const rows = await executor.query<RequestWithUsersRow>(
      `SELECT r.*, ru.display_name AS requester_name, du.display_name AS decider_name
         FROM driver_account_requests r
         JOIN users ru ON ru.id = r.requested_by
         LEFT JOIN users du ON du.id = r.decided_by
        WHERE r.status = 'pending'
        ORDER BY r.requested_at ASC`,
    );
    return rows.map(toRequestWithUsers);
  }

  /**
   * One requester's own history, newest first.
   *
   * ★ SCOPED BY REQUESTER, WHICH IS THE AUTHORIZATION. A head sees what they
   * proposed and what came of it — including the rejection reason, which is the
   * only thing that tells them what to fix.
   */
  async listByRequester(
    requestedBy: string,
    executor: DatabaseQuery = this.db,
  ): Promise<DriverAccountRequestWithUsers[]> {
    const rows = await executor.query<RequestWithUsersRow>(
      `SELECT r.*, ru.display_name AS requester_name, du.display_name AS decider_name
         FROM driver_account_requests r
         JOIN users ru ON ru.id = r.requested_by
         LEFT JOIN users du ON du.id = r.decided_by
        WHERE r.requested_by = $1
        ORDER BY r.requested_at DESC`,
      [requestedBy],
    );
    return rows.map(toRequestWithUsers);
  }
}
