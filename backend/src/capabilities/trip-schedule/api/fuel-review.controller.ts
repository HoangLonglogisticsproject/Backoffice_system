import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { OffsetPage } from '../../../common/pagination/offset-page';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { FuelReviewService, type FuelReviewDetail } from '../application/fuel-review.service';
import { ACCOUNTING_ACTIONS, FUEL_REVIEW_STATUSES, type AccountingAction, type FuelSubmission } from '../domain/fuel-review';

const listSchema = z.object({
  status: z.enum(FUEL_REVIEW_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type ListQuery = z.infer<typeof listSchema>;

const ACTIONS = Object.keys(ACCOUNTING_ACTIONS) as [AccountingAction, ...AccountingAction[]];
const decisionSchema = z.object({ note: z.string().max(1000).optional() });
type DecisionBody = z.infer<typeof decisionSchema>;

/**
 * "Kế toán → Nhiên liệu" (0038): the drivers' fills, by review state, and the
 * four decisions on one — ask for more, approve, refuse, mark paid.
 *
 * ★ `cost.import` — the SuperAdmin and the ACCOUNTING function, the same
 * holders as the receipt work of #113 — and never a driver account
 * (`BackofficeOnlyGuard`). Every decision is behind CSRF and is one more
 * append-only step; paying is never done here, only recorded.
 */
@Controller('fuel-reviews')
export class FuelReviewController {
  constructor(private readonly reviews: FuelReviewService) {}

  @Get()
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.import')
  async list(@Query(new ZodValidationPipe(listSchema)) query: ListQuery): Promise<OffsetPage<FuelSubmission>> {
    return this.reviews.list(query.status, query.page, query.limit);
  }

  @Get(':fuelTransactionId')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.import')
  async detail(@Param('fuelTransactionId', UuidParam) fuelTransactionId: string): Promise<FuelReviewDetail> {
    return this.reviews.detail(fuelTransactionId);
  }

  /** `request-info` and `reject` need a `note`; `approve` and `mark-paid` may carry one (a transfer reference). */
  @Post(':fuelTransactionId/:action')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.import')
  @HttpCode(HttpStatus.OK)
  async decide(
    @Param('fuelTransactionId', UuidParam) fuelTransactionId: string,
    @Param('action', new ZodValidationPipe(z.enum(ACTIONS))) action: AccountingAction,
    @Body(new ZodValidationPipe(decisionSchema)) body: DecisionBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<FuelReviewDetail> {
    return this.reviews.act(fuelTransactionId, action, body.note, actor.id);
  }
}
