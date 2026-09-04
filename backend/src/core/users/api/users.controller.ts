import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import type { Request } from 'express';
import {
  HeadOfTargetUserDepartmentGuard,
  PermissionGuard,
  RequirePermission,
  authorizationOf,
} from '../../authorization/api/permission.guard';
import { AuthGuard } from '../../identity/api/auth.guard';
import { CsrfGuard } from '../../identity/api/csrf.guard';
import { CurrentUser } from '../../identity/api/current-user.decorator';
import type { SessionUser } from '../../identity/application/session.service';
import { AccountLifecycleService } from '../application/account-lifecycle.service';
import { AccountProvisioningService } from '../application/account-provisioning.service';
import { UserService } from '../application/user.service';
import { MembershipService } from '../../organization/application/membership.service';
import type { EmployeeRosterRow } from '../../organization/domain/department.entity';
import type { AccountStatus } from '../../../common/types/user-summary';
import type { AccountType } from '../domain/user.entity';

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

/**
 * `GET /users/:userId/memberships`.
 *
 * ★ TWO STATUSES, NEVER MERGED. `accountStatus` is `users.status` — may this
 * account operate. Each membership carries its own `membershipStatus` — is this
 * person still in that unit. Nothing here derives one from the other.
 */
export interface EmployeeDetailResponse {
  user: { id: string; displayName: string };
  accountStatus: AccountStatus;
  /**
   * ★ WHAT KIND OF ACCOUNT THIS IS, AND WHY IT HAD TO BE SAID OUT LOUD.
   *
   * `memberships: []` has two entirely different meanings. For an employee it
   * says "no employment period this caller may see" — a head reading somebody
   * from another unit, or a record still being set up. For a DRIVER it is the
   * permanent, correct answer: a driver belongs to no unit and never will, which
   * is exactly why 0018 stores this column rather than deriving it from "has no
   * active membership" (every offboarded employee looks the same by that test).
   *
   * Without this field a screen has to guess which of the two it is looking at,
   * and an empty table with no explanation reads as a fault.
   */
  accountType: AccountType;
  memberships: EmployeeRosterRow[];
}

const createUserSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  // Shape is checked properly in `domain/email.ts`, together with the domain
  // allowlist. Here it is only bounded, so a 10 MB string never reaches it.
  email: z.string().trim().min(3).max(320),
  initialPassword: z.string().min(1).max(1024),
  departmentId: z.string().uuid(),
});

/**
 * Only `disabled` is accepted here.
 *
 * ★ RE-ENABLING HAS ITS OWN ROUTE, ON ITS OWN RESOURCE. It is a driver-only
 * operation — an employee's would have to say which department they return to,
 * and that is undecided — so it lives at `PATCH /driver-accounts/:userId/status`
 * where the resource already means "a driver". Accepting `active` here too
 * would be a second door onto one operation, and the two would drift.
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
    private readonly users: UserService,
    private readonly employment: MembershipService,
  ) {}

  /**
   * EMPLOYEE DETAIL — one person, their account state, and their employment
   * history. READ ONLY: nothing here decides, edits, disables or moves anybody.
   *
   * ★ KEYED BY THE PERSON, NOT BY A MEMBERSHIP. `users.id` is the canonical
   * identity and does not change for any lifecycle event, so it is the only key
   * under which several employment periods can be shown as ONE employee. A
   * membership id would scope this to a single period and make history
   * impossible to render.
   *
   * ★ AUTHORIZATION IS THE GUARD'S, NOT THIS METHOD'S. There is no `if` below
   * that asks who is calling. `HeadOfTargetUserDepartmentGuard` decided access
   * against the target's ACTIVE membership; what remains here is the second,
   * different question — which periods this caller may be SHOWN — and even that
   * is expressed as a scope handed to the query, never as a filter applied to
   * rows already loaded.
   *
   * ⚠ THE HEAD'S HISTORY IS DELIBERATELY PARTIAL. `headOf` narrows it to the
   * units they lead, so a filtered view cannot even name a unit they have no
   * authority over. The screen says so rather than implying it is complete.
   */
  @Get(':userId/memberships')
  @UseGuards(AuthGuard, HeadOfTargetUserDepartmentGuard)
  async employeeDetail(
    @Param('userId', UuidParam) userId: string,
    @Req() request: Request,
  ): Promise<EmployeeDetailResponse> {
    // 404 rather than an empty shell: "no such person" and "a person with no
    // employment history" are different answers and a screen renders them
    // differently.
    const user = await this.users.requireById(userId);

    const authorization = authorizationOf(request);
    // Global sees every period; a head sees the units they lead. `undefined`
    // means unfiltered, which is why the global case passes nothing rather than
    // passing a list that would have to be complete.
    const visible = authorization?.global ? undefined : (authorization?.headOf ?? []);

    return {
      user: { id: user.id, displayName: user.displayName },
      accountStatus: user.status,
      accountType: user.accountType,
      memberships: await this.employment.listEmployeeHistory(userId, visible),
    };
  }

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
   *
   * ⚠ ONE DIRECTION ONLY. Putting an account back is `PATCH
   * /driver-accounts/:userId/status`, and only a driver can be — an employee's
   * would have to name the department they return to.
   */
  @Patch(':userId/status')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('user.write')
  async setStatus(
    @Param('userId', UuidParam) userId: string,
    @Body(new ZodValidationPipe(setStatusSchema)) _body: SetStatusInput,
    @CurrentUser() actor: SessionUser,
  ): Promise<{ id: string; status: string }> {
    const disabled = await this.lifecycle.disable({ userId, actingUserId: actor.id });
    return { id: disabled.id, status: disabled.status };
  }
}
