import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import type { Cursor, CursorAnchored } from '../../../common/pagination/cursor';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { normalizeEmail } from '../../../core/users/domain/email';
import {
  AccountInvitation,
  AccountInvitationWithUser,
  InvitationStatus,
} from '../domain/account-invitation';

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

interface InvitationRow {
  id: string;
  department_id: string;
  email: string;
  status: InvitationStatus;
  requested_by: string;
  requested_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  reason: string | null;
  created_user_id: string | null;
}

/** An invitation plus its cursor anchor — `requested_at` at full precision. */
export interface InvitationPageRow extends AccountInvitationWithUser, CursorAnchored {}

/**
 * An invitation, with the name of whoever asked for it and the cursor anchor.
 *
 * ONE join, not three. `requested_by` is the only user reference on this row a
 * screen shows; `decided_by` and `created_user_id` are nullable and unread, so
 * projecting them would mean two LEFT JOINs paid on every row for nothing.
 *
 * `requested_by` is NOT NULL with a `NO ACTION` foreign key: the user is
 * guaranteed to exist, the join is INNER, and it is 1:1 on a primary key.
 *
 * There is deliberately no projection of `email` either - an email is not a
 * display name and must never be substituted for one.
 */
const INVITATIONS_WITH_USER = `
  SELECT i.id, i.department_id, i.email, i.status, i.requested_by, i.requested_at,
         i.decided_by, i.decided_at, i.reason, i.created_user_id,
         i.requested_at::text AS cursor_at,
         ru.display_name AS requested_by_display_name
    FROM account_invitations i
    JOIN users ru ON ru.id = i.requested_by`;

type InvitationJoinedRow = InvitationRow & {
  cursor_at: string;
  requested_by_display_name: string;
};

const toInvitation = (row: InvitationRow): AccountInvitation => ({
  id: row.id,
  departmentId: row.department_id,
  email: row.email,
  status: row.status,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  reason: row.reason,
  createdUserId: row.created_user_id,
});

const toInvitationPageRow = (row: InvitationJoinedRow): InvitationPageRow => ({
  ...toInvitation(row),
  requestedByUser: { id: row.requested_by, displayName: row.requested_by_display_name },
  cursorAt: row.cursor_at,
});

/** SQL for invitations. Opens no transaction; decides nothing. */
@Injectable()
export class AccountInvitationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    input: { departmentId: string; email: string; requestedBy: string; reason: string | null },
    executor: DatabaseQuery = this.db,
  ): Promise<AccountInvitation> {
    try {
      const rows = await executor.query<InvitationRow>(
        `INSERT INTO account_invitations (department_id, email, requested_by, reason)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        // Canonicalised HERE, not left to the caller. The service already does
        // it as part of validating the address, but this is the only statement
        // that writes the column — so doing it here is what makes "stored
        // canonical" true of every caller rather than of the current one.
        // `IdentityRepository` treats `subject` the same way, for the same
        // reason, and `uq_pending_invitation_email_canonical` is the third layer
        // behind both.
        [input.departmentId, normalizeEmail(input.email), input.requestedBy, input.reason],
      );

      const row = rows[0];
      if (!row) throw new Error('INSERT INTO account_invitations returned no row');

      return toInvitation(row);
    } catch (error) {
      // Two heads inviting the same address in the same instant: the partial
      // unique index picks one, and the loser hears the same conflict the
      // pre-check would have given them.
      if (isUniqueViolation(error)) {
        throw new ConflictError('That email already has an invitation awaiting a decision.');
      }
      throw error;
    }
  }

  async findById(
    id: string,
    executor: DatabaseQuery = this.db,
  ): Promise<AccountInvitation | null> {
    const rows = await executor.query<InvitationRow>(
      'SELECT * FROM account_invitations WHERE id = $1',
      [id],
    );
    return rows[0] ? toInvitation(rows[0]) : null;
  }

  /** Locks the invitation and returns it only while still pending. */
  async lockPending(id: string, executor: DatabaseQuery): Promise<AccountInvitation | null> {
    const rows = await executor.query<InvitationRow>(
      "SELECT * FROM account_invitations WHERE id = $1 AND status = 'pending' FOR UPDATE",
      [id],
    );
    return rows[0] ? toInvitation(rows[0]) : null;
  }

  async findPendingByEmail(
    email: string,
    executor: DatabaseQuery = this.db,
  ): Promise<AccountInvitation | null> {
    // ★ MATCHES THE INDEX EXPRESSION, not the raw column. 0010 replaced the
    // raw-column unique index with one over `lower(btrim(email))`, so `email =
    // $1` would now be a sequential scan AND would test a different predicate
    // than the constraint enforces — a pre-check that can pass where the insert
    // then fails.
    const rows = await executor.query<InvitationRow>(
      `SELECT * FROM account_invitations
        WHERE lower(btrim(email)) = $1 AND status = 'pending'`,
      [normalizeEmail(email)],
    );
    return rows[0] ? toInvitation(rows[0]) : null;
  }

  /**
   * One page of this department's history, NEWEST first — the order a queue is
   * read in. Keyset on `(requested_at, id)`; see `common/pagination/cursor` for
   * why the id is not optional.
   *
   * No status filter, deliberately: this list is the department's whole record,
   * decided rows included. That is also why it needs pagination most — it grows
   * with the deployment's age and nothing ever leaves it.
   */
  async listForDepartmentPage(
    departmentId: string,
    limit: number,
    cursor: Cursor | undefined,
    executor: DatabaseQuery = this.db,
  ): Promise<InvitationPageRow[]> {
    const rows = await executor.query<InvitationJoinedRow>(
      cursor
        ? `${INVITATIONS_WITH_USER}
            WHERE i.department_id = $1 AND (i.requested_at, i.id) < ($2::timestamptz, $3)
            ORDER BY i.requested_at DESC, i.id DESC
            LIMIT $4`
        : `${INVITATIONS_WITH_USER}
            WHERE i.department_id = $1
            ORDER BY i.requested_at DESC, i.id DESC
            LIMIT $2`,
      cursor ? [departmentId, cursor.t, cursor.i, limit + 1] : [departmentId, limit + 1],
    );
    return rows.map(toInvitationPageRow);
  }

  /**
   * One page of the global decision queue, OLDEST first: the thing waiting
   * longest is the thing to decide next.
   */
  async listPendingPage(
    limit: number,
    cursor: Cursor | undefined,
    executor: DatabaseQuery = this.db,
  ): Promise<InvitationPageRow[]> {
    const rows = await executor.query<InvitationJoinedRow>(
      cursor
        ? `${INVITATIONS_WITH_USER}
            WHERE i.status = 'pending' AND (i.requested_at, i.id) > ($1::timestamptz, $2)
            ORDER BY i.requested_at ASC, i.id ASC
            LIMIT $3`
        : `${INVITATIONS_WITH_USER}
            WHERE i.status = 'pending'
            ORDER BY i.requested_at ASC, i.id ASC
            LIMIT $1`,
      cursor ? [cursor.t, cursor.i, limit + 1] : [limit + 1],
    );
    return rows.map(toInvitationPageRow);
  }

  async decide(
    input: {
      id: string;
      status: 'approved' | 'rejected';
      decidedBy: string;
      createdUserId: string | null;
      now: Date;
    },
    executor: DatabaseQuery,
  ): Promise<AccountInvitation | null> {
    const rows = await executor.query<InvitationRow>(
      `UPDATE account_invitations
          SET status = $2, decided_by = $3, decided_at = $4, created_user_id = $5
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [input.id, input.status, input.decidedBy, input.now, input.createdUserId],
    );
    return rows[0] ? toInvitation(rows[0]) : null;
  }
}
