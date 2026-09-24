import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { decodeCursor, toPage, type Page } from '../../../common/pagination/cursor';
import {
  type Alert,
  type AlertEvidence,
  type AlertSeverity,
  type AlertSignal,
  type AlertSourceType,
  type AlertStatus,
  type AlertSubjectType,
  type ResolutionKind,
  EVIDENCE_VERSION,
  LIVE_STATUSES,
} from '../domain/alert';
import { dedupeKeyOf } from '../domain/dedupe';

/**
 * Alerts, in SQL.
 *
 * ★ NO DELETE METHOD, AND NONE WILL BE ADDED HERE. The runtime role has no
 * DELETE grant; retention is a separate maintenance capability with its own
 * role (Phase 1b). A repository method would only exist to fail in production.
 *
 * Every write that is part of a lifecycle move takes an `executor` with no
 * default: the application service owns the transaction, and the history row
 * must commit with the status change or not at all.
 */

interface AlertRow {
  id: string;
  detector_code: string;
  detector_version: number;
  source_type: AlertSourceType;
  subject_type: AlertSubjectType;
  subject_id: string;
  trip_id: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  summary: string;
  evidence: AlertEvidence;
  evidence_version: number;
  dedupe_key: string;
  first_seen_at: Date;
  last_seen_at: Date;
  occurrence_count: number;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  dismissed_at: Date | null;
  dismissed_by: string | null;
  dismissed_reason: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_kind: ResolutionKind | null;
  first_scan_run_id: string | null;
  last_scan_run_id: string | null;
  resolved_scan_run_id: string | null;
  confidence: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `
  id, detector_code, detector_version, source_type, subject_type, subject_id, trip_id,
  severity, status, title, summary, evidence, evidence_version, dedupe_key,
  first_seen_at, last_seen_at, occurrence_count,
  acknowledged_at, acknowledged_by, dismissed_at, dismissed_by, dismissed_reason,
  resolved_at, resolved_by, resolution_kind,
  first_scan_run_id, last_scan_run_id, resolved_scan_run_id, confidence,
  created_at, updated_at`;

const toAlert = (row: AlertRow): Alert => ({
  id: row.id,
  detectorCode: row.detector_code,
  detectorVersion: row.detector_version,
  sourceType: row.source_type,
  subjectType: row.subject_type,
  subjectId: row.subject_id,
  tripId: row.trip_id,
  severity: row.severity,
  status: row.status,
  title: row.title,
  summary: row.summary,
  evidence: row.evidence,
  evidenceVersion: row.evidence_version,
  dedupeKey: row.dedupe_key,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  occurrenceCount: row.occurrence_count,
  acknowledgedAt: row.acknowledged_at,
  acknowledgedBy: row.acknowledged_by,
  dismissedAt: row.dismissed_at,
  dismissedBy: row.dismissed_by,
  dismissedReason: row.dismissed_reason,
  resolvedAt: row.resolved_at,
  resolvedBy: row.resolved_by,
  resolutionKind: row.resolution_kind,
  firstScanRunId: row.first_scan_run_id,
  lastScanRunId: row.last_scan_run_id,
  resolvedScanRunId: row.resolved_scan_run_id,
  // NUMERIC comes back as text from `pg`; the domain wants a number.
  confidence: row.confidence === null ? null : Number(row.confidence),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** The predicate of `uq_alert_live_dedupe`, spelled for `ON CONFLICT`. */
const quoted = (value: string): string => "'" + value + "'";
const LIVE_PREDICATE = 'status IN (' + LIVE_STATUSES.map(quoted).join(', ') + ')';

export interface AlertListQuery {
  statuses: readonly AlertStatus[];
  severities?: readonly AlertSeverity[];
  detectorCode?: string;
  tripId?: string;
  limit: number;
  cursor?: string;
}

export interface AlertSummary {
  open: number;
  acknowledged: number;
  dismissed: number;
  bySeverity: Record<AlertSeverity, number>;
}

export interface UpsertResult {
  alert: Alert;
  /** `true` when a new incident was opened; `false` when a live one was refreshed. */
  created: boolean;
}

@Injectable()
export class AlertRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Opens an incident for the signal, or refreshes the live one with the same
   * dedupe key — in one statement, so two workers cannot both open it.
   *
   * ★ ON CONFLICT NEVER TOUCHES `status`. A dismissed incident stays dismissed
   * (suppressed) while its evidence, severity and `last_seen_at` keep moving,
   * which is exactly what "suppress until the condition clears" means.
   *
   * ★ THIS STATEMENT NEVER TOUCHES `occurrence_count` ON CONFLICT. Counting
   * distinct scan runs is `observe()`'s job, against `alert_scan_observations`;
   * the two run in the caller's transaction, and the row lock this statement
   * takes is what serialises them. `last_scan_run_id` records the run that
   * saw the incident most recently; a NULL run (no identity) never overwrites it.
   */
  async upsert(
    signal: AlertSignal,
    scanRunId: string | null,
    executor: DatabaseQuery,
  ): Promise<UpsertResult> {
    const rows = await executor.query<AlertRow & { inserted: boolean }>(
      `INSERT INTO alerts (
         detector_code, detector_version, source_type, subject_type, subject_id, trip_id,
         severity, title, summary, evidence, evidence_version, dedupe_key, confidence,
         first_scan_run_id, last_scan_run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $14)
       ON CONFLICT (dedupe_key) WHERE ${LIVE_PREDICATE}
       DO UPDATE SET
         -- GREATEST, not now(): now() is the TRANSACTION start. A worker that
         -- began before the inserting one and then lost the race would write a
         -- last_seen_at EARLIER than first_seen_at and trip alerts_seen_order.
         -- Found by the concurrent-upsert test, not by reasoning.
         last_seen_at     = GREATEST(alerts.last_seen_at, now()),
         detector_version = EXCLUDED.detector_version,
         severity         = EXCLUDED.severity,
         title            = EXCLUDED.title,
         summary          = EXCLUDED.summary,
         evidence         = EXCLUDED.evidence,
         evidence_version = EXCLUDED.evidence_version,
         confidence       = EXCLUDED.confidence,
         last_scan_run_id = COALESCE(EXCLUDED.last_scan_run_id, alerts.last_scan_run_id)
       RETURNING ${COLUMNS}, (xmax = 0) AS inserted`,
      [
        signal.detectorCode,
        signal.detectorVersion,
        signal.sourceType,
        signal.subjectType,
        signal.subjectId,
        signal.tripId,
        signal.severity,
        signal.title,
        signal.summary,
        JSON.stringify(signal.evidence),
        EVIDENCE_VERSION,
        dedupeKeyOf(signal),
        signal.confidence ?? null,
        scanRunId,
      ],
    );

    const row = rows[0];
    if (!row) throw new Error('Upsert returned no row.');
    return { alert: toAlert(row), created: row.inserted };
  }

  /**
   * Records that `scanRunId` observed the alert, and counts the run if — and
   * only if — this is the first time that pair is seen.
   *
   * ★ EXACT DISTINCTNESS, ENFORCED BY THE PRIMARY KEY. `INSERT … ON CONFLICT
   * DO NOTHING` returns a row only when the observation actually landed; the
   * `UPDATE` in the same statement fires only on that row. A, B, A therefore
   * counts 2, A, A, A counts 1, and two workers in one run count it once —
   * decided by PostgreSQL, never by a read in the service.
   *
   * `created` is the upsert's own answer, from the same transaction: the row
   * that opened the incident already counts its opener (`DEFAULT 1`), so the
   * observation is recorded but not counted again.
   *
   * Returns whether the observation was new.
   */
  async observe(
    alertId: string,
    scanRunId: string,
    created: boolean,
    executor: DatabaseQuery,
  ): Promise<boolean> {
    const rows = await executor.query<{ observed: boolean }>(
      `WITH observed AS (
         INSERT INTO alert_scan_observations (alert_id, scan_run_id)
         VALUES ($1, $2)
         ON CONFLICT (alert_id, scan_run_id) DO NOTHING
         RETURNING alert_id
       ),
       counted AS (
         UPDATE alerts
            SET occurrence_count = occurrence_count + 1
          WHERE id = $1
            AND NOT $3::boolean
            AND EXISTS (SELECT 1 FROM observed)
          RETURNING id
       )
       SELECT EXISTS (SELECT 1 FROM observed) AS observed`,
      [alertId, scanRunId, created],
    );
    return rows[0]?.observed === true;
  }

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<Alert | null> {
    const rows = await executor.query<AlertRow>(`SELECT ${COLUMNS} FROM alerts WHERE id = $1`, [id]);
    return rows[0] ? toAlert(rows[0]) : null;
  }

  /** `FOR UPDATE`: the caller decides the transition while holding the row. */
  async lockById(id: string, tx: DatabaseQuery): Promise<Alert | null> {
    const rows = await tx.query<AlertRow>(`SELECT ${COLUMNS} FROM alerts WHERE id = $1 FOR UPDATE`, [
      id,
    ]);
    return rows[0] ? toAlert(rows[0]) : null;
  }

  /**
   * The three lifecycle writes. Each is guarded by `AND status = $from`, so a
   * row that moved between the lock and the update — impossible under the
   * lock, but the predicate costs nothing — changes nothing and returns null.
   */
  async acknowledge(id: string, from: AlertStatus, by: string, tx: DatabaseQuery): Promise<Alert | null> {
    const rows = await tx.query<AlertRow>(
      `UPDATE alerts
          SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $3
        WHERE id = $1 AND status = $2
        RETURNING ${COLUMNS}`,
      [id, from, by],
    );
    return rows[0] ? toAlert(rows[0]) : null;
  }

  async dismiss(
    id: string,
    from: AlertStatus,
    by: string,
    reason: string,
    tx: DatabaseQuery,
  ): Promise<Alert | null> {
    const rows = await tx.query<AlertRow>(
      `UPDATE alerts
          SET status = 'dismissed', dismissed_at = now(), dismissed_by = $3, dismissed_reason = $4
        WHERE id = $1 AND status = $2
        RETURNING ${COLUMNS}`,
      [id, from, by, reason],
    );
    return rows[0] ? toAlert(rows[0]) : null;
  }

  async resolve(
    id: string,
    from: AlertStatus,
    resolution: { by: string | null; kind: ResolutionKind; scanRunId: string | null },
    tx: DatabaseQuery,
  ): Promise<Alert | null> {
    const rows = await tx.query<AlertRow>(
      `UPDATE alerts
          SET status = 'resolved', resolved_at = now(), resolved_by = $3, resolution_kind = $4,
              resolved_scan_run_id = $5
        WHERE id = $1 AND status = $2
        RETURNING ${COLUMNS}`,
      [id, from, resolution.by, resolution.kind, resolution.scanRunId],
    );
    return rows[0] ? toAlert(rows[0]) : null;
  }

  /** Keyset on `(last_seen_at DESC, id DESC)`; the cursor carries `last_seen_at::text`. */
  async list(query: AlertListQuery): Promise<Page<Alert>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.db.query<AlertRow & { cursor_at: string }>(
      `SELECT ${COLUMNS}, last_seen_at::text AS cursor_at
         FROM alerts
        WHERE status = ANY($1::text[])
          AND ($2::text[] IS NULL OR severity = ANY($2::text[]))
          AND ($3::text IS NULL OR detector_code = $3)
          AND ($4::uuid IS NULL OR trip_id = $4::uuid)
          AND ($5::timestamptz IS NULL OR (last_seen_at, id) < ($5::timestamptz, $6::uuid))
        ORDER BY last_seen_at DESC, id DESC
        LIMIT $7`,
      [
        query.statuses,
        query.severities && query.severities.length > 0 ? query.severities : null,
        query.detectorCode ?? null,
        query.tripId ?? null,
        cursor?.t ?? null,
        cursor?.i ?? null,
        query.limit + 1,
      ],
    );

    return toPage(
      rows.map(({ cursor_at, ...row }) => ({ ...toAlert(row), cursorAt: cursor_at })),
      query.limit,
    );
  }

  /**
   * Every LIVE incident of one detector, as `(alertId, subjectId)`.
   *
   * ★ WHAT THE RESOLUTION PHASE STARTS FROM. Not a window, not a list the
   * backend chose — the alerts this service is currently asserting. Dismissed
   * ones are included: a dismissed incident is suppressed, not closed, and the
   * system still has to notice when its condition finally clears.
   */
  async liveSubjects(
    detectorCode: string,
    executor: DatabaseQuery = this.db,
  ): Promise<{ alertId: string; subjectId: string }[]> {
    const rows = await executor.query<{ alert_id: string; subject_id: string }>(
      `SELECT id AS alert_id, subject_id
         FROM alerts
        WHERE detector_code = $1
          AND ${LIVE_PREDICATE}
        ORDER BY first_seen_at ASC, id ASC`,
      [detectorCode],
    );
    return rows.map((row) => ({ alertId: row.alert_id, subjectId: row.subject_id }));
  }

  /** Counts over LIVE incidents only — resolved ones are history, not a queue. */
  async summary(): Promise<AlertSummary> {
    const rows = await this.db.query<{ status: AlertStatus; severity: AlertSeverity; count: number }>(
      `SELECT status, severity, count(*)::int AS count
         FROM alerts
        WHERE ${LIVE_PREDICATE}
        GROUP BY status, severity`,
    );

    const summary: AlertSummary = {
      open: 0,
      acknowledged: 0,
      dismissed: 0,
      bySeverity: { info: 0, warning: 0, high: 0, critical: 0 },
    };
    for (const row of rows) {
      if (row.status !== 'resolved') summary[row.status] += row.count;
      summary.bySeverity[row.severity] += row.count;
    }
    return summary;
  }
}
