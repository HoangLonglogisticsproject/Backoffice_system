import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { JsonValue } from '../domain/alert';
import type { ScanOutcome, ScanPhase, ScanRun } from '../domain/scan-run';

interface ScanRunRow {
  id: string;
  detector_code: string;
  detector_version: number;
  phase: ScanPhase;
  started_at: Date;
  finished_at: Date | null;
  outcome: ScanOutcome;
  candidates: number;
  signals: number;
  created: number;
  updated: number;
  resolved: number;
  config_snapshot: { [key: string]: JsonValue };
  error: string | null;
  correlation_id: string | null;
}

const COLUMNS = `id, detector_code, detector_version, phase, started_at, finished_at, outcome,
  candidates, signals, created, updated, resolved, config_snapshot, error, correlation_id`;

const toScanRun = (row: ScanRunRow): ScanRun => ({
  id: row.id,
  detectorCode: row.detector_code,
  detectorVersion: row.detector_version,
  phase: row.phase,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  outcome: row.outcome,
  candidates: row.candidates,
  signals: row.signals,
  created: row.created,
  updated: row.updated,
  resolved: row.resolved,
  configSnapshot: row.config_snapshot,
  error: row.error,
  correlationId: row.correlation_id,
});

export interface FinishScanRun {
  outcome: Exclude<ScanOutcome, 'running'>;
  candidates?: number;
  signals?: number;
  created?: number;
  updated?: number;
  resolved?: number;
  error?: string | null;
}

/**
 * The run ledger. Foundation only: `start` and `finish` are what the Phase 1b
 * engine will call; nothing calls them in Phase 1a except the tests that pin
 * the table's invariants.
 */
@Injectable()
export class ScanRunRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async start(
    input: {
      detectorCode: string;
      detectorVersion: number;
      phase: ScanPhase;
      configSnapshot?: { [key: string]: JsonValue };
      correlationId?: string | null;
    },
    executor: DatabaseQuery = this.db,
  ): Promise<ScanRun> {
    const rows = await executor.query<ScanRunRow>(
      `INSERT INTO scan_runs (detector_code, detector_version, phase, config_snapshot, correlation_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING ${COLUMNS}`,
      [
        input.detectorCode,
        input.detectorVersion,
        input.phase,
        JSON.stringify(input.configSnapshot ?? {}),
        input.correlationId ?? null,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error('scan_runs insert returned no row.');
    return toScanRun(row);
  }

  /** Closes a RUNNING run. A run already closed is left alone and `null` is returned. */
  async finish(id: string, patch: FinishScanRun, executor: DatabaseQuery = this.db): Promise<ScanRun | null> {
    const rows = await executor.query<ScanRunRow>(
      `UPDATE scan_runs
          SET outcome = $2, finished_at = now(),
              candidates = COALESCE($3, candidates), signals = COALESCE($4, signals),
              created = COALESCE($5, created), updated = COALESCE($6, updated),
              resolved = COALESCE($7, resolved), error = $8
        WHERE id = $1 AND outcome = 'running'
        RETURNING ${COLUMNS}`,
      [
        id,
        patch.outcome,
        patch.candidates ?? null,
        patch.signals ?? null,
        patch.created ?? null,
        patch.updated ?? null,
        patch.resolved ?? null,
        patch.error ?? null,
      ],
    );
    return rows[0] ? toScanRun(rows[0]) : null;
  }

  /**
   * Records how many alerts a finished resolution run closed.
   *
   * Separate from `finish` because the resolutions happen AFTER the run is
   * marked `succeeded` — `resolveBySystem` will not accept a run that is
   * still `running`, so the count cannot be known before the run closes.
   */
  async recordResolved(id: string, resolved: number, executor: DatabaseQuery = this.db): Promise<void> {
    await executor.query('UPDATE scan_runs SET resolved = $2 WHERE id = $1', [id, resolved]);
  }

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<ScanRun | null> {
    const rows = await executor.query<ScanRunRow>(`SELECT ${COLUMNS} FROM scan_runs WHERE id = $1`, [id]);
    return rows[0] ? toScanRun(rows[0]) : null;
  }
}
