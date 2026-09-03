import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { DriverAccountService, type ProvisionedDriver } from '../application/driver-account.service';
import type { DriverAccount } from '../domain/driver-account';
import type {
  DriverAccountRequest,
  DriverAccountRequestWithUsers,
} from '../domain/driver-account-request';

/**
 * ★ THE DTOs SAY WHO MAY SUPPLY WHAT, AND THEY DIFFER ON PURPOSE.
 *
 * The direct-create body carries a password because a global administrator
 * chose it and it is used at once. The request body does NOT, and must not: a
 * pending request can wait days, and a secret stored for days is a secret with
 * a window. The password for an approved request is generated at approval.
 */
const createDriverSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  email: z.string().trim().min(3).max(320),
  initialPassword: z.string().min(1).max(200),
});

const requestDriverSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  email: z.string().trim().min(3).max(320),
});

const rejectSchema = z.object({
  // ★ `min(1)` AFTER TRIM. Whitespace is not a reason, and the database agrees.
  reason: z.string().trim().min(1).max(1000),
});

/**
 * Both directions, on a DRIVER. The employee route (`PATCH /users/:id/status`)
 * still accepts `disabled` only, because re-enabling an employee asks "into
 * which department" and that is undecided; a driver has no department, so
 * for them the way back is one status flip and this schema says so.
 */
const setDriverStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});

type CreateDriverInput = z.infer<typeof createDriverSchema>;
type SetDriverStatusInput = z.infer<typeof setDriverStatusSchema>;
type RequestDriverInput = z.infer<typeof requestDriverSchema>;
type RejectInput = z.infer<typeof rejectSchema>;

/**
 * Driver accounts over HTTP.
 *
 * ★ THE PERMISSION ON EACH ROUTE IS THE POLICY, and the two are not the same
 * key by design:
 *
 *   POST   /driver-accounts                    user.write             'global'
 *   GET    /driver-accounts                    user.write             'global'
 *   GET    /driver-accounts/:userId            user.write             'global'
 *   PATCH  /driver-accounts/:userId/status     user.write             'global'
 *   POST   /driver-account-requests            driver.account.request 'head-anywhere'
 *   GET    /driver-account-requests            user.write             'global'
 *   GET    /driver-account-requests/mine       driver.account.request 'head-anywhere'
 *   POST   /driver-account-requests/:id/approve  user.write           'global'
 *   POST   /driver-account-requests/:id/reject   user.write           'global'
 *
 * A head can reach the second and fourth and nothing else. There is no route
 * they hold that creates an account, so "propose" cannot be escalated into
 * "create" by calling a different endpoint — which is what makes this
 * server-side enforcement rather than a hidden button.
 */
@Controller()
export class DriverAccountController {
  constructor(private readonly drivers: DriverAccountService) {}

  /** A global administrator creates a driver outright. */
  @Post('driver-accounts')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('user.write')
  async create(
    @Body(new ZodValidationPipe(createDriverSchema)) body: CreateDriverInput,
  ): Promise<ProvisionedDriver> {
    return this.drivers.createDirectly(body);
  }

  /**
   * Driver Management's list: every driver account, with its status.
   *
   * ★ `user.write` FOR A READ, ON PURPOSE. This is account administration —
   * the same screen that creates and disables — and the list of who can sign
   * in as a driver is administration data, not dispatch data. Dispatch has its
   * own list (`GET /trip-drivers`, `trip.write`) of ACTIVE drivers by id and
   * name, and that one stays the source of assignment eligibility.
   */
  @Get('driver-accounts')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('user.write')
  async list(): Promise<DriverAccount[]> {
    return this.drivers.list();
  }

  /** One driver. An employee's id — or a made-up one — is 404 here. */
  @Get('driver-accounts/:userId')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('user.write')
  async get(@Param('userId', UuidParam) userId: string): Promise<DriverAccount> {
    return this.drivers.get(userId);
  }

  /**
   * Disable or re-enable a driver. Account status only; see the service for
   * what it deliberately leaves alone.
   */
  @Patch('driver-accounts/:userId/status')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('user.write')
  async setStatus(
    @Param('userId', UuidParam) userId: string,
    @Body(new ZodValidationPipe(setDriverStatusSchema)) body: SetDriverStatusInput,
    @CurrentUser() actor: SessionUser,
  ): Promise<{ id: string; status: string }> {
    const user = await this.drivers.setStatus({ userId, status: body.status, actingUserId: actor.id });
    return { id: user.id, status: user.status };
  }

  /** A department head proposes one. Nothing is created. */
  @Post('driver-account-requests')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('driver.account.request')
  async request(
    @Body(new ZodValidationPipe(requestDriverSchema)) body: RequestDriverInput,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverAccountRequest> {
    return this.drivers.request({ ...body, requestedBy: actor.id });
  }

  /** The reviewer's queue. */
  @Get('driver-account-requests')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('user.write')
  async listPending(): Promise<DriverAccountRequestWithUsers[]> {
    return this.drivers.listPending();
  }

  /**
   * What this caller proposed.
   *
   * ★ SCOPED TO THE SESSION, NOT TO A PARAMETER. There is no `?requestedBy=`,
   * so one head cannot read another's proposals by editing a query string.
   */
  @Get('driver-account-requests/mine')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('driver.account.request')
  async listMine(@CurrentUser() actor: SessionUser): Promise<DriverAccountRequestWithUsers[]> {
    return this.drivers.listMine(actor.id);
  }

  @Post('driver-account-requests/:requestId/approve')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('user.write')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('requestId', UuidParam) requestId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<{ request: DriverAccountRequest; driver: ProvisionedDriver }> {
    return this.drivers.approve({ requestId, decidedBy: actor.id });
  }

  @Post('driver-account-requests/:requestId/reject')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('user.write')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('requestId', UuidParam) requestId: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: RejectInput,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverAccountRequest> {
    return this.drivers.reject({ requestId, decidedBy: actor.id, reason: body.reason });
  }
}
