import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { AssignmentRequestReviewService } from '../application/assignment-request-review.service';
import type { DispatchAssignmentRequest, TripAssignmentRequest } from '../domain/trip-assignment-request';

/**
 * Dispatch reviewing drivers' asks for open bookings (0035).
 *
 * ★ `dispatch.write` ON EVERY ROUTE, READS INCLUDED. Deciding who runs a trip
 * is dispatch's job (global, or the dispatch function); a seller, customer
 * service or accounting can book a run but is not offered the review — not the
 * buttons, and not the queue behind them.
 */
const approveSchema = z.object({ vehicleId: z.string().uuid() });
const rejectSchema = z.object({ reason: z.string().trim().max(2000).nullable().optional() });

@Controller()
export class AssignmentRequestController {
  constructor(private readonly review: AssignmentRequestReviewService) {}

  /** Every pending ask — bounded without a range: a pending ask means an open booking. */
  @Get('assignment-request-queue')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('dispatch.write')
  queue(): Promise<DispatchAssignmentRequest[]> {
    return this.review.listPending();
  }

  /** Every ask on one trip, decided ones included. */
  @Get('trip-schedules/:tripId/assignment-requests')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('dispatch.write')
  listForTrip(@Param('tripId', UuidParam) tripId: string): Promise<DispatchAssignmentRequest[]> {
    return this.review.listForTrip(tripId);
  }

  /** ★ THE LORRY IS REQUIRED: an assignment is a driver AND a vehicle, chosen here. */
  @Post('trip-schedules/:tripId/assignment-requests/:requestId/approve')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('dispatch.write')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('tripId', UuidParam) tripId: string,
    @Param('requestId', UuidParam) requestId: string,
    @Body(new ZodValidationPipe(approveSchema)) body: z.infer<typeof approveSchema>,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripAssignmentRequest> {
    return this.review.approve(tripId, requestId, body.vehicleId, actor.id);
  }

  @Post('trip-schedules/:tripId/assignment-requests/:requestId/reject')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('dispatch.write')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('tripId', UuidParam) tripId: string,
    @Param('requestId', UuidParam) requestId: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripAssignmentRequest> {
    return this.review.reject(tripId, requestId, body.reason ?? null, actor.id);
  }
}
