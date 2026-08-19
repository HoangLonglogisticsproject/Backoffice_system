import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import {
  HeadOfRouteDepartmentGuard,
  PermissionGuard,
  RequirePermission,
} from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { AccountInvitationService, ApprovedInvitation } from '../application/account-invitation.service';
import { AccountInvitation } from '../domain/account-invitation';

/**
 * Inviting somebody who has no account yet.
 *
 *   inviting   HeadOfRouteDepartmentGuard  — the head of THAT unit, or global
 *   deciding   user.write                  — global only: approving creates an
 *                                            account, which is account
 *                                            administration by definition
 *
 * THE APPROVE RESPONSE CARRIES THE ONLY COPY of the generated password. There is
 * no email adapter here, so the approver is the delivery channel — see the
 * service and the capability README for what that costs and why it is accepted.
 */

const createInvitationSchema = z.object({
  email: z.string().trim().min(3).max(320),
  reason: z.string().trim().max(1000).optional(),
});

/**
 * Approving may name the person. Nothing else: the address and the unit come
 * from the stored invitation, so neither can be swapped at decision time.
 */
const approveInvitationSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
  })
  // Every field is optional, so a body-less approve is a legal request. Without
  // this the pipe would see `undefined` and answer 422 to the most obvious call
  // the client can make.
  .default({});

type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
type ApproveInvitationInput = z.infer<typeof approveInvitationSchema>;

@Controller()
export class AccountInvitationController {
  constructor(private readonly invitations: AccountInvitationService) {}

  @Post('departments/:departmentId/account-invitations')
  @UseGuards(AuthGuard, CsrfGuard, HeadOfRouteDepartmentGuard)
  async create(
    @Param('departmentId', UuidParam) departmentId: string,
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationInput,
    @CurrentUser() actor: SessionUser,
  ): Promise<AccountInvitation> {
    return this.invitations.create({
      departmentId,
      requestedBy: actor.id,
      email: body.email,
      reason: body.reason,
    });
  }

  @Get('departments/:departmentId/account-invitations')
  @UseGuards(AuthGuard, HeadOfRouteDepartmentGuard)
  async listForDepartment(
    @Param('departmentId', UuidParam) departmentId: string,
  ): Promise<AccountInvitation[]> {
    return this.invitations.listForDepartment(departmentId);
  }

  @Get('account-invitations')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('user.write')
  async listPending(): Promise<AccountInvitation[]> {
    return this.invitations.listPending();
  }

  @Post('account-invitations/:invitationId/approve')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('user.write')
  @HttpCode(HttpStatus.CREATED)
  async approve(
    @Param('invitationId', UuidParam) invitationId: string,
    @Body(new ZodValidationPipe(approveInvitationSchema)) body: ApproveInvitationInput,
    @CurrentUser() actor: SessionUser,
  ): Promise<ApprovedInvitation> {
    return this.invitations.approve({
      invitationId,
      decidedBy: actor.id,
      displayName: body.displayName,
    });
  }

  @Post('account-invitations/:invitationId/reject')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('user.write')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('invitationId', UuidParam) invitationId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<AccountInvitation> {
    return this.invitations.reject({ invitationId, decidedBy: actor.id });
  }
}
