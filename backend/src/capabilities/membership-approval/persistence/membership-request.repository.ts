import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import {
  MembershipChangeRequest,
  RequestAction,
  RequestStatus,
} from '../domain/membership-request';

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

interface RequestRow {
  id: string;
  department_id: string;
  target_department_id: string | null;
  target_user_id: string;
  action: RequestAction;
  status: RequestStatus;
  requested_by: string;
  requested_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  reason: string | null;
}

const toRequest = (row: RequestRow): MembershipChangeRequest => ({
  id: row.id,
  departmentId: row.department_id,
  targetDepartmentId: row.target_department_id,
  targetUserId: row.target_user_id,
  action: row.action,
  status: row.status,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  reason: row.reason,
});

/** SQL for approval requests. Opens no transaction; decides nothing. */
@Injectable()
export class MembershipRequestRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    input: {
      departmentId: string;
      targetDepartmentId: string | null;
      targetUserId: string;
      action: RequestAction;
      requestedBy: string;
      reason: string | null;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<MembershipChangeRequest> {
    try {
      const rows = await executor.query<RequestRow>(
        `INSERT INTO membership_change_requests
           (department_id, target_department_id, target_user_id, action, requested_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          input.departmentId,
          input.targetDepartmentId,
          input.targetUserId,
          input.action,
          input.requestedBy,
          input.reason,
        ],
      );

      const row = rows[0];
      if (!row) throw new Error('INSERT INTO membership_change_requests returned no row');

      return toRequest(row);
    } catch (error) {
      // The service checks first, but two heads can pass that check in the same
      // instant and only one can win the partial unique index.
      if (isUniqueViolation(error)) {
        throw new ConflictError('An identical request is already awaiting a decision.');
      }
      throw error;
    }
  }

  async findById(
    id: string,
    executor: DatabaseQuery = this.db,
  ): Promise<MembershipChangeRequest | null> {
    const rows = await executor.query<RequestRow>(
      'SELECT * FROM membership_change_requests WHERE id = $1',
      [id],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  /**
   * Locks the request and returns it only while it is still pending.
   *
   * `FOR UPDATE` plus the status predicate is what serialises two administrators
   * deciding the same request: the second waits, then sees no row, and the
   * service turns that into a conflict rather than deciding twice.
   */
  async lockPending(
    id: string,
    executor: DatabaseQuery,
  ): Promise<MembershipChangeRequest | null> {
    const rows = await executor.query<RequestRow>(
      "SELECT * FROM membership_change_requests WHERE id = $1 AND status = 'pending' FOR UPDATE",
      [id],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async findPendingFor(
    input: { departmentId: string; targetUserId: string; action: RequestAction },
    executor: DatabaseQuery = this.db,
  ): Promise<MembershipChangeRequest | null> {
    const rows = await executor.query<RequestRow>(
      `SELECT * FROM membership_change_requests
        WHERE department_id = $1 AND target_user_id = $2 AND action = $3 AND status = 'pending'`,
      [input.departmentId, input.targetUserId, input.action],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async listForDepartment(
    departmentId: string,
    executor: DatabaseQuery = this.db,
  ): Promise<MembershipChangeRequest[]> {
    const rows = await executor.query<RequestRow>(
      'SELECT * FROM membership_change_requests WHERE department_id = $1 ORDER BY requested_at DESC',
      [departmentId],
    );
    return rows.map(toRequest);
  }

  async listPending(executor: DatabaseQuery = this.db): Promise<MembershipChangeRequest[]> {
    const rows = await executor.query<RequestRow>(
      "SELECT * FROM membership_change_requests WHERE status = 'pending' ORDER BY requested_at ASC",
    );
    return rows.map(toRequest);
  }

  /**
   * Closes a request, only from pending.
   *
   * Returns null when this call was not the one that closed it — the caller then
   * answers "already decided" instead of reporting a decision it did not make.
   */
  async decide(
    input: { id: string; status: 'approved' | 'rejected'; decidedBy: string; now: Date },
    executor: DatabaseQuery,
  ): Promise<MembershipChangeRequest | null> {
    const rows = await executor.query<RequestRow>(
      `UPDATE membership_change_requests
          SET status = $2, decided_by = $3, decided_at = $4
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [input.id, input.status, input.decidedBy, input.now],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }
}
