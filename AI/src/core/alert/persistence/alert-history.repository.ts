import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { actorColumns, type Actor, type ActorType } from '../domain/actor';
import type { AlertStatus } from '../domain/alert';

export interface AlertTransition {
  id: string;
  alertId: string;
  fromStatus: AlertStatus | null;
  toStatus: AlertStatus;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
  scanRunId: string | null;
  correlationId: string | null;
  createdAt: Date;
}

interface HistoryRow {
  id: string;
  alert_id: string;
  from_status: AlertStatus | null;
  to_status: AlertStatus;
  actor_type: ActorType;
  actor_id: string | null;
  reason: string | null;
  scan_run_id: string | null;
  correlation_id: string | null;
  created_at: Date;
}

const toTransition = (row: HistoryRow): AlertTransition => ({
  id: row.id,
  alertId: row.alert_id,
  fromStatus: row.from_status,
  toStatus: row.to_status,
  actorType: row.actor_type,
  actorId: row.actor_id,
  reason: row.reason,
  scanRunId: row.scan_run_id,
  correlationId: row.correlation_id,
  createdAt: row.created_at,
});

/**
 * Append-only. No update, no delete.
 *
 * ⚠ `record` TAKES AN EXECUTOR WITH NO DEFAULT. A transition recorded outside
 * the transaction that performed it could commit while the status change
 * rolls back, or the reverse — and either way the history stops being true.
 * The backend's trip_status_history repository makes the same demand.
 */
@Injectable()
export class AlertHistoryRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(
    entry: {
      alertId: string;
      from: AlertStatus | null;
      to: AlertStatus;
      actor: Actor;
      reason: string | null;
      scanRunId: string | null;
      correlationId: string | null;
    },
    executor: DatabaseQuery,
  ): Promise<AlertTransition> {
    const { actorType, actorId } = actorColumns(entry.actor);
    const rows = await executor.query<HistoryRow>(
      `INSERT INTO alert_transition_history
         (alert_id, from_status, to_status, actor_type, actor_id, reason, scan_run_id, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, alert_id, from_status, to_status, actor_type, actor_id, reason,
                 scan_run_id, correlation_id, created_at`,
      [
        entry.alertId,
        entry.from,
        entry.to,
        actorType,
        actorId,
        entry.reason,
        entry.scanRunId,
        entry.correlationId,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error('History insert returned no row.');
    return toTransition(row);
  }

  /** Oldest first: the story in the order it happened. */
  async listByAlert(alertId: string, executor: DatabaseQuery = this.db): Promise<AlertTransition[]> {
    const rows = await executor.query<HistoryRow>(
      `SELECT id, alert_id, from_status, to_status, actor_type, actor_id, reason,
              scan_run_id, correlation_id, created_at
         FROM alert_transition_history
        WHERE alert_id = $1
        ORDER BY created_at ASC, id ASC`,
      [alertId],
    );
    return rows.map(toTransition);
  }
}
