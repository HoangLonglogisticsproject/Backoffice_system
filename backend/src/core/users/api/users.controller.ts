import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { PermissionGuard, RequirePermission } from '../../authorization/api/permission.guard';
import { AuthGuard } from '../../identity/api/auth.guard';
import { CsrfGuard } from '../../identity/api/csrf.guard';
import { CurrentUser } from '../../identity/api/current-user.decorator';
import type { SessionUser } from '../../identity/application/session.service';
import { AccountLifecycleService } from '../application/account-lifecycle.service';
import { AccountProvisioningService } from '../application/account-provisioning.service';

/**
 * Account administration. GLOBAL only, on every route.
 *
 * `user.write` has no departmental scope, so `can()` grants it to a global
 * caller and to nobody else — a head cannot reach any of this, which is the
 * point: a head who could create accounts could create one for themselves.
 *
 * NOTHING IN A BODY BELOW DECIDES AUTHORITY. No route accepts a role, a
 * permission, a scope or a caller id; `departmentId` names where the new person
 * lands, which is business data, and the guard has already decided the caller
 * may act anywhere.
 */

const createUserSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  // Shape is checked properly in `domain/email.ts`, together with the domain
  // allowlist. Here it is only bounded, so a 10 MB string never reaches it.
  email: z.string().trim().min(3).max(320),
  initialPassword: z.string().min(1).max(1024),
  departmentId: z.string().uuid(),
});

/**
 * Only `disabled` is accepted in this phase.
 *
 * Re-enabling asks "into which department", because an active user with none is
 * forbidden — and that answer has not been decided. A schema that accepted
 * `active` would promise behaviour nobody specified.
 */
const setStatusSchema = z.object({
  status: z.literal('disabled'),
});

type CreateUserInput = z.infer<typeof createUserSchema>;
type SetStatusInput = z.infer<typeof setStatusSchema>;

export interface CreateUserResponse {
  id: string;
  displayName: string;
  username: string;
  status: string;
  departmentId: string;
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly provisioning: AccountProvisioningService,
    private readonly lifecycle: AccountLifecycleService,
  ) {}

  /**
   * CreateAccount — user, credential and membership in one transaction.
   *
   * The response carries no secret. The caller supplied `initialPassword`, so
   * echoing it back would add a place for it to leak while telling them nothing
   * they do not already know.
   */
  @Post()
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('user.write')
  async create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
  ): Promise<CreateUserResponse> {
    const provisioned = await this.provisioning.provision({
      displayName: body.displayName,
      email: body.email,
      departmentId: body.departmentId,
      initialPassword: body.initialPassword,
    });

    return {
      id: provisioned.user.id,
      displayName: provisioned.user.displayName,
      username: provisioned.username,
      status: provisioned.user.status,
      departmentId: body.departmentId,
    };
  }

  /**
   * DisableUser — remove somebody from the deployment.
   *
   * Five writes in one transaction; see `AccountLifecycleService` for why the
   * order is forced rather than chosen. Refuses for the last SuperAdmin.
   */
  @Patch(':userId/status')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('user.write')
  async setStatus(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setStatusSchema)) _body: SetStatusInput,
    @CurrentUser() actor: SessionUser,
  ): Promise<{ id: string; status: string }> {
    const disabled = await this.lifecycle.disable({ userId, actingUserId: actor.id });
    return { id: disabled.id, status: disabled.status };
  }
}
