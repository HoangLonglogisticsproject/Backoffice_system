import { Inject, Injectable } from '@nestjs/common';
import {
  InvalidTransitionError,
  NotFoundError,
} from '../../../common/errors/domain.error';
import { DATABASE, type Database } from '../../../common/types/database.port';
import type { Page } from '../../../common/pagination/cursor';
import { SYSTEM_ACTOR, type Actor } from '../domain/actor';
import type { Alert, AlertSignal } from '../domain/alert';
import { canTransition, normaliseReason, type TransitionTarget } from '../domain/alert-transition';
import { AlertHistoryRepository, type AlertTransition } from '../persistence/alert-history.repository';
import { AlertRepository, type AlertListQuery, type AlertSummary, type UpsertResult } from '../persistence/alert.repository';

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
  ) {}

  /**
   * Discovery's write: open an incident for the signal or refresh the live one.
   * A NEW incident gets its birth row in history (`null → open`, system actor);
   * a refreshed one gets no history row, because nothing about its status
   * changed — `last_seen_at` and `occurrence_count` on the alert say it was
   * seen again.
   */
  async recordSignal(
    signal: AlertSignal,
    context: { scanRunId?: string | null; correlationId?: string | null } = {},
  ): Promise<UpsertResult> {
    return this.db.transaction(async (tx) => {
      const result = await this.alerts.upsert(signal, context.scanRunId ?? null, tx);

      if (result.created) {
        await this.history.record(
          {
            alertId: result.alert.id,
            from: null,
            to: 'open',
            actor: SYSTEM_ACTOR,
            reason: null,
            scanRunId: context.scanRunId ?? null,
            correlationId: context.correlationId ?? null,
          },
          tx,
        );
      }

      return result;
    });
  }

  /**
   * Moves an alert, or refuses.
   *
   * The row is locked first, then the move is checked against the CURRENT
   * status, then the update is guarded by that status again. Two callers
   * racing to acknowledge the same alert therefore serialise on the lock, and
   * the second one finds `acknowledged → acknowledged`, which is not a move —
   * one winner, one 409, nothing written twice.
   */
  async transition(input: TransitionInput): Promise<Alert> {
    const reason = normaliseReason(input.to, input.reason);

    return this.db.transaction(async (tx) => {
      const current = await this.alerts.lockById(input.alertId, tx);
      if (!current) throw new NotFoundError('Alert not found.');

      if (!canTransition(current.status, input.to, input.actor.type)) {
        throw new InvalidTransitionError(
          `An alert that is ${current.status} cannot be ${input.to} by ${input.actor.type === 'system' ? 'the system' : 'a user'}.`,
        );
      }

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
    });
  }

  /**
   * Resolution's write — the system verified the condition has cleared.
   * Application-internal: there is deliberately no HTTP route for it.
   */
  resolveBySystem(input: { alertId: string; scanRunId: string | null; correlationId?: string | null }): Promise<Alert> {
    return this.transition({
      alertId: input.alertId,
      to: 'resolved',
      actor: SYSTEM_ACTOR,
      scanRunId: input.scanRunId,
      correlationId: input.correlationId ?? null,
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

  private apply(
    current: Alert,
    input: TransitionInput,
    reason: string | null,
    tx: Parameters<AlertRepository['acknowledge']>[3],
  ): Promise<Alert | null> {
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
