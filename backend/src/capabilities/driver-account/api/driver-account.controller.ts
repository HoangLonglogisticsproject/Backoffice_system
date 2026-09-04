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
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import type { Page } from '../../../common/pagination/cursor';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { DriverAccountService, type ProvisionedDriver } from '../application/driver-account.service';
import type { DriverAccountRow } from '../domain/driver-account';
import type {
  DriverAccountRequest,
  DriverAccountRequestWithUsers,
} from '../domain/driver-account-request';
import {
  driverAccountQuerySchema,
  type DriverAccountQuery,
} from './driver-account-query.dto';

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

type CreateDriverInput = z.infer<typeof createDriverSchema>;
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
   * Every driver account, newest first.
   *
   * ★ THE ONLY SCREEN THAT CAN CONFIRM A DRIVER EXISTS. A driver has no
   * department membership by design, so `GET /memberships` — a list of
   * MEMBERSHIPS — can never show one; and `GET /trip-drivers` answers "who may I
   * put on this trip", which is live accounts only and a different question. An
   * administrator who created an account had nowhere to see it.
   *
   * ★ `user.write`, THE SAME KEY THAT CREATES ONE. There is no `user.read` in
   * the permission set, and `unit.member.read` is a question about a department
   * — the one thing a driver does not have. The honest reading is that whoever
   * administers accounts may list them, which is exactly what this key means.
   *
   * ⚠ IT DECIDES NOTHING. Disabling is `PATCH /users/:userId/status`, which
   * already exists and already ends the memberships and revokes the roles that a
   * driver happens not to have. A second route here would be a second lifecycle.
   */
  @Get('driver-accounts')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('user.write')
  async listAccounts(
    @Query(new ZodValidationPipe(driverAccountQuerySchema)) query: DriverAccountQuery,
  ): Promise<Page<DriverAccountRow>> {
    return this.drivers.listAccounts({ accountStatus: query.status }, query);
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
