import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { Page } from '../../../common/pagination/cursor';
import { SYSTEM_ACTOR, type Actor } from '../domain/actor';
import type { Alert, AlertSignal } from '../domain/alert';
import { canTransition, normaliseReason, type TransitionTarget } from '../domain/alert-transition';
import { verifiesResolutionOf } from '../domain/scan-run';
import { AlertHistoryRepository, type AlertTransition } from '../persistence/alert-history.repository';
import { AlertRepository, type AlertListQuery, type AlertSummary, type UpsertResult } from '../persistence/alert.repository';
import { ScanRunRepository } from '../persistence/scan-run.repository';

export interface TransitionInput {
  alertId: string;
  to: TransitionTarget;
  actor: Actor;
  reason?: string | null;
  scanRunId?: string | null;
  correlationId?: string | null;
}

/**
 * The lifecycle, as the one place that owns a transaction.
 *
 * Persistence never opens a transaction (boundary rule A5); this service does,
 * so a status change and its history row are one unit of work. That is the
 * whole reason the service exists — the rules themselves are in `domain/`.
 */
@Injectable()
export class AlertService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly alerts: AlertRepository,
    private readonly history: AlertHistoryRepository,
    private readonly scanRuns: ScanRunRepository,
  ) {}

  /**
   * Discovery's write: open an incident for the signal or refresh the live one.
   *
   * A NEW incident gets its birth row in history (`null → open`, system actor);
   * a refreshed one gets no history row, because nothing about its status
   * changed. When the signal carries a run identity, the run is recorded as an
   * observation and counted once for the alert's lifetime — see
   * `AlertRepository.observe`. A signal with no run identity is seen
   * (`last_seen_at`) but never counted: a retry nobody can name is not a scan.
   */
  async recordSignal(
    signal: AlertSignal,
    context: { scanRunId?: string | null; correlationId?: string | null } = {},
  ): Promise<UpsertResult> {
    const scanRunId = context.scanRunId ?? null;

    return this.db.transaction(async (tx) => {
      const result = await this.alerts.upsert(signal, scanRunId, tx);

      if (result.created) {
        await this.history.record(
          {
            alertId: result.alert.id,
            from: null,
            to: 'open',
            actor: SYSTEM_ACTOR,
            reason: null,
            scanRunId,
            correlationId: context.correlationId ?? null,
          },
          tx,
        );
      }

      if (scanRunId === null) return result;

      await this.alerts.observe(result.alert.id, scanRunId, result.created, tx);
      const alert = await this.alerts.findById(result.alert.id, tx);
      return { alert: alert ?? result.alert, created: result.created };
    });
  }

  /**
   * A PERSON moves an alert, or is refused.
   *
   * The row is locked first, then the move is checked against the CURRENT
   * status, then the update is guarded by that status again. Two callers
   * racing to acknowledge the same alert therefore serialise on the lock, and
   * the second one finds `acknowledged → acknowledged`, which is not a move —
   * one winner, one 409, nothing written twice.
   *
   * ★ THE SYSTEM DOES NOT COME THROUGH HERE. Its only move is a resolution,
   * and a resolution needs a verified run — `resolveBySystem`. Refusing the
   * system actor at this door is what makes that the only path.
   */
  async transition(input: TransitionInput): Promise<Alert> {
    const reason = normaliseReason(input.to, input.reason);

    return this.db.transaction(async (tx) => {
      const current = await this.lockAndAdmit(input.alertId, input.to, input.actor, tx);

      if (input.actor.type === 'system') {
        throw new InvalidTransitionError(
          'A system resolution must go through resolveBySystem with the run that verified it.',
        );
      }

      return this.move(current, input, reason, tx);
    });
  }

  /**
   * Resolution's write — the system verified the condition has cleared.
   * Application-internal: there is deliberately no HTTP route for it.
   *
   * ★ THE RUN IS THE EVIDENCE, AND IT IS CHECKED HERE, NOT TRUSTED. Inside the
   * same transaction as the update, the run must exist, be a RESOLUTION run,
   * have SUCCEEDED, and belong to the alert's detector (invariant M: a failed
   * or partial scan never resolves anything). Anything less leaves the alert
   * and its history untouched. Phase 1b's engine cannot skip this by being
   * well-behaved; the door does not open without it.
   */
  async resolveBySystem(input: { alertId: string; scanRunId: string; correlationId?: string | null }): Promise<Alert> {
    if (typeof input.scanRunId !== 'string' || input.scanRunId.length === 0) {
      throw new ValidationError('A system resolution requires the resolution run that verified it.', {
        scanRunId: 'Required.',
      });
    }

    return this.db.transaction(async (tx) => {
      const current = await this.lockAndAdmit(input.alertId, 'resolved', SYSTEM_ACTOR, tx);

      const run = await this.scanRuns.findById(input.scanRunId, tx);
      if (!verifiesResolutionOf(run, current)) {
        throw new ConflictError(
          'A system resolution requires a SUCCEEDED resolution run of the alert\'s own detector; ' +
            'this run is missing, not a resolution run, not succeeded, or for another detector.',
        );
      }

      return this.move(
        current,
        { alertId: current.id, to: 'resolved', actor: SYSTEM_ACTOR, scanRunId: run!.id, correlationId: input.correlationId ?? null },
        null,
        tx,
      );
    });
  }

  async getById(alertId: string): Promise<Alert> {
    const alert = await this.alerts.findById(alertId);
    if (!alert) throw new NotFoundError('Alert not found.');
    return alert;
  }

  historyOf(alertId: string): Promise<AlertTransition[]> {
    return this.history.listByAlert(alertId);
  }

  list(query: AlertListQuery): Promise<Page<Alert>> {
    return this.alerts.list(query);
  }

  summary(): Promise<AlertSummary> {
    return this.alerts.summary();
  }

  /** Lock the row, then check the move against what is actually there. */
  private async lockAndAdmit(alertId: string, to: TransitionTarget, actor: Actor, tx: DatabaseQuery): Promise<Alert> {
    const current = await this.alerts.lockById(alertId, tx);
    if (!current) throw new NotFoundError('Alert not found.');

    if (!canTransition(current.status, to, actor.type)) {
      throw new InvalidTransitionError(
        `An alert that is ${current.status} cannot be ${to} by ${actor.type === 'system' ? 'the system' : 'a user'}.`,
      );
    }
    return current;
  }

  /** The guarded update and its history row — one unit, or nothing. */
  private async move(current: Alert, input: TransitionInput, reason: string | null, tx: DatabaseQuery): Promise<Alert> {
    const moved = await this.apply(current, input, reason, tx);
    if (!moved) {
      // Unreachable under the lock; kept so a broken lock surfaces as a
      // conflict rather than as a silently missing history row.
      throw new InvalidTransitionError('The alert changed while being updated.');
    }

    await this.history.record(
      {
        alertId: moved.id,
        from: current.status,
        to: moved.status,
        actor: input.actor,
        reason,
        scanRunId: input.scanRunId ?? null,
        correlationId: input.correlationId ?? null,
      },
      tx,
    );

    return moved;
  }

  private apply(current: Alert, input: TransitionInput, reason: string | null, tx: DatabaseQuery): Promise<Alert | null> {
    const userId = input.actor.type === 'user' ? input.actor.id : null;

    switch (input.to) {
      case 'acknowledged':
        // `canTransition` admits this move for users only, so `userId` is set.
        return this.alerts.acknowledge(current.id, current.status, userId as string, tx);
      case 'dismissed':
        // `normaliseReason` has already refused a missing reason.
        return this.alerts.dismiss(current.id, current.status, userId as string, reason as string, tx);
      case 'resolved':
        return this.alerts.resolve(
          current.id,
          current.status,
          {
            by: userId,
            kind: userId === null ? 'system_cleared' : 'user',
            scanRunId: input.scanRunId ?? null,
          },
          tx,
        );
    }
  }
}
