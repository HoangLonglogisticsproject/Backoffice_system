import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import {
  PermissionGuard,
  RequirePermission,
} from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { TripCompletionService } from '../application/trip-completion.service';
import type { CompletionRequest } from '../domain/trip-execution';

/**
 * The office side of completion: reading the attempts, and deciding one.
 *
 * ★ THE DRIVER'S HALF OF THIS FLOW LIVES IN `driver-portal.controller.ts`, and
 * the split is the authorization question, not tidiness. A driver may act on
 * the trip they are ASSIGNED to — a relation to a row, which no permission tier
 * can express, so it takes a guard. A reviewer may act on ANY trip and is
 * identified by what they hold, which is exactly what a permission tier is for.
 * Two different questions, two controllers.
 *
 * ★ READ AND DECIDE ARE GUARDED DIFFERENTLY, ON PURPOSE.
 *
 *   listing       trip.read              — dispatch information, no money in it
 *   deciding      trip.complete.review   — 'global', see the permission table
 *
 * The list carries an expense DECLARATION (`none` / `expenses`) and never an
 * AMOUNT, so it is no more sensitive than the board it hangs off. Deciding is
 * the act that closes a trip permanently, and it is reserved.
 */

/**
 * ★ REJECTING ALWAYS SAYS WHY, AND THIS IS THE THIRD PLACE IT IS ENFORCED.
 *
 * The DTO refuses a blank one here, the service refuses it again, and 0017 has
 * a CHECK constraint the row cannot exist without. Three, because two existing
 * approval flows in this codebase collect a reason in the UI and drop it in the
 * API — the driver is then told "rejected" with nothing to act on, and has to
 * guess what to correct.
 */
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(500) });

type RejectBody = z.infer<typeof rejectSchema>;

@Controller()
export class TripCompletionController {
  constructor(private readonly completion: TripCompletionService) {}

  /**
   * Every attempt on this trip, newest first.
   *
   * Rejected attempts are included WITH their reasons — that history is the
   * point. Three rejections and an approval leave four rows, and "how many
   * times was this sent back, and why" has an answer.
   */
  @Get('trip-schedules/:tripId/completion-requests')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async list(@Param('tripId', UuidParam) tripId: string): Promise<CompletionRequest[]> {
    return this.completion.listRequests(tripId);
  }

  /**
   * Confirms the trip is finished.
   *
   * ★ ONE TRANSACTION DOES FOUR THINGS, AND THE ORDER MATTERS:
   *
   *   1. the request becomes `approved`
   *   2. every live cost line becomes `immutable`
   *   3. the trip's status becomes `done` — which 0017's trigger makes final
   *   4. the move is recorded, and the trip stamped with who closed it
   *
   * The money is frozen BEFORE the trip closes, so there is no instant in which
   * a closed trip still carries an editable figure. There is no compensating
   * action afterwards: `done` cannot be undone by anything.
   *
   * POST rather than PATCH, 200 rather than 201: this decides an existing
   * request rather than creating a resource, and the decided record comes back.
   */
  @Post('trip-schedules/:tripId/completion-requests/approve')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('trip.complete.review')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('tripId', UuidParam) tripId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<CompletionRequest> {
    // The decider comes from the session, never the body. A body that named its
    // own approver is a body that can name somebody else's.
    return this.completion.approve(tripId, actor.id);
  }

  /**
   * Sends it back for correction.
   *
   * ★ REJECTION REOPENS THE MONEY AND LEAVES THE TRIP WHERE IT WAS. The lines
   * were frozen FOR the review, not BY it — the driver has to be able to
   * correct whatever caused the rejection. The trip's status is untouched
   * because it never moved: a trip awaiting review was never `done`, so there
   * is nothing to reopen.
   */
  @Post('trip-schedules/:tripId/completion-requests/reject')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('trip.complete.review')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('tripId', UuidParam) tripId: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: RejectBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<CompletionRequest> {
    return this.completion.reject(tripId, { by: actor.id, reason: body.reason });
  }
}
