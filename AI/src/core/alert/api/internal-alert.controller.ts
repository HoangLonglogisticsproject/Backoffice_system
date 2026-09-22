import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import type { Page } from '../../../common/pagination/cursor';
import { ServiceAuthGuard } from '../../../infrastructure/service-auth/service-auth.guard';
import { TrustedContextVerifier } from '../../../infrastructure/service-auth/trusted-context.verifier';
import { AlertService } from '../application/alert.service';
import type { Alert } from '../domain/alert';
import type { AlertTransition } from '../persistence/alert-history.repository';
import type { AlertSummary } from '../persistence/alert.repository';
import { alertQuerySchema, type AlertQuery } from './alert-query.dto';
import { transitionBodySchema, type TransitionBody } from './transition.dto';

export interface AlertDetail {
  alert: Alert;
  history: AlertTransition[];
}

/**
 * The internal Alert API — what the BACKEND calls, and nothing else.
 *
 * ★ `ServiceAuthGuard` ON THE CLASS, so no handler can be added without it.
 * There is no human session here and no permission check: the backend has
 * already decided the caller may do this (its `PermissionGuard`), and it
 * proves who the caller was with a signed trusted context on every write.
 *
 * ★ NO CREATE ROUTE. Incidents are opened by the engine from detector signals
 * (`AlertService.recordSignal`), never by an HTTP caller. And no system
 * resolution route either — that path is application-internal on purpose.
 *
 * Reached only over the compose network; the reverse proxy answers 404 for
 * `/api/internal/` on every public host.
 */
@Controller('internal/v1/alerts')
@UseGuards(ServiceAuthGuard)
export class InternalAlertController {
  constructor(
    private readonly alerts: AlertService,
    private readonly contexts: TrustedContextVerifier,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(alertQuerySchema)) query: AlertQuery): Promise<Page<Alert>> {
    return this.alerts.list({
      statuses: query.status,
      severities: query.severity,
      detectorCode: query.detectorCode,
      tripId: query.tripId,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  // Declared before `:alertId` so "summary" is never read as an id.
  @Get('summary')
  summary(): Promise<AlertSummary> {
    return this.alerts.summary();
  }

  @Get(':alertId')
  async detail(@Param('alertId', UuidParam) alertId: string): Promise<AlertDetail> {
    const alert = await this.alerts.getById(alertId);
    return { alert, history: await this.alerts.historyOf(alertId) };
  }

  /**
   * A user's lifecycle action. The context is verified BEFORE the alert is
   * even looked up: an unverifiable context tells us nothing about who is
   * asking, so it learns nothing about what exists.
   */
  @Post(':alertId/transitions')
  @HttpCode(200)
  async transition(
    @Param('alertId', UuidParam) alertId: string,
    @Body(new ZodValidationPipe(transitionBodySchema)) body: TransitionBody,
    @Headers('x-correlation-id') correlationHeader?: string,
  ): Promise<AlertDetail> {
    const context = this.contexts.verify(body.context);

    const alert = await this.alerts.transition({
      alertId,
      to: body.to,
      actor: { type: 'user', id: context.sub },
      reason: body.reason ?? null,
      correlationId: correlationHeader?.trim() || context.cid,
    });

    return { alert, history: await this.alerts.historyOf(alertId) };
  }
}
