import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { pageQuerySchema, type PageQuery } from '../../../common/pagination/page-query.dto';
import type { Page } from '../../../common/pagination/cursor';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import {
  HeadOfRouteDepartmentGuard,
  PermissionGuard,
  RequireHeadOfRouteDepartment,
  RequirePermission,
} from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { MembershipRequestService } from '../application/membership-request.service';
import {
  MembershipChangeRequest,
  MembershipChangeRequestWithUsers,
  REQUEST_ACTIONS,
} from '../domain/membership-request';

/**
 * The two sides of the approval workflow, and they are guarded differently on
 * purpose:
 *
 *   raising    HeadOfRouteDepartmentGuard  — the head of THAT unit, or global
 *   deciding   unit.member.write           — global only, by definition
 *
 * A head therefore cannot decide anything, including their own request. Two
 * independent layers say so: this permission, and a database CHECK that refuses
 * `decided_by = requested_by`.
 *
 * THE ROUTE CARRIES THE SCOPE, THE BODY CARRIES THE SUBJECT. `:departmentId` is
 * the unit the caller leads; `targetDepartmentId` is where they want somebody
 * moved to, which is business data. The SOURCE appears in neither — it is read
 * from the target's membership, twice.
 */

const createRequestSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(REQUEST_ACTIONS),
  /** Required for a transfer, refused for an offboarding — checked in the service. */
  targetDepartmentId: z.string().uuid().optional(),
  reason: z.string().trim().max(1000).optional(),
});

type CreateRequestInput = z.infer<typeof createRequestSchema>;

@Controller()
export class MembershipRequestController {
  constructor(private readonly requests: MembershipRequestService) {}

  /**
   * THE HEAD OF THAT UNIT, AND NOT THE GLOBAL ADMINISTRATOR — same reason as
   * the invitation route: deciding is global-only and refuses a self-decision,
   * so a request the global administrator raised has nobody left to decide it.
   *
   * The direct routes remain: `POST /departments/:id/members` moves somebody,
   * and `PATCH /users/:userId/status` disables an account.
   */
  @Post('departments/:departmentId/membership-requests')
  @UseGuards(AuthGuard, CsrfGuard, HeadOfRouteDepartmentGuard)
  @RequireHeadOfRouteDepartment('departmentId', { allowGlobal: false })
  async create(
    @Param('departmentId', UuidParam) departmentId: string,
    @Body(new ZodValidationPipe(createRequestSchema)) body: CreateRequestInput,
    @CurrentUser() actor: SessionUser,
  ): Promise<MembershipChangeRequest> {
    return this.requests.create({
      routeDepartmentId: departmentId,
      requestedBy: actor.id,
      targetUserId: body.userId,
      action: body.action,
      targetDepartmentId: body.targetDepartmentId,
      reason: body.reason,
    });
  }

  /** What a head sees for their own unit. */
  @Get('departments/:departmentId/membership-requests')
  @UseGuards(AuthGuard, HeadOfRouteDepartmentGuard)
  async listForDepartment(
    @Param('departmentId', UuidParam) departmentId: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) page: PageQuery,
  ): Promise<Page<MembershipChangeRequestWithUsers>> {
    return this.requests.listForDepartment(departmentId, page);
  }

  /** The decision queue. Global only — there is one of these, not one per unit. */
  @Get('membership-requests')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('unit.member.write')
  async listPending(
    @Query(new ZodValidationPipe(pageQuerySchema)) page: PageQuery,
  ): Promise<Page<MembershipChangeRequestWithUsers>> {
    return this.requests.listPending(page);
  }

  /**
   * Approving performs the change, in the same transaction as the decision.
   *
   * The body is empty: everything needed is on the stored request, and
   * re-derived from the database before anything is written.
   */
  @Post('membership-requests/:requestId/approve')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('unit.member.write')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('requestId', UuidParam) requestId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<MembershipChangeRequest> {
    return this.requests.approve({ requestId, decidedBy: actor.id });
  }

  @Post('membership-requests/:requestId/reject')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('unit.member.write')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('requestId', UuidParam) requestId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<MembershipChangeRequest> {
    return this.requests.reject({ requestId, decidedBy: actor.id });
  }
}
