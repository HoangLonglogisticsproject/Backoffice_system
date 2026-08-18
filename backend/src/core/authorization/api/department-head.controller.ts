import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { NotFoundError } from '../../../common/errors/domain.error';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { AuthGuard } from '../../identity/api/auth.guard';
import { CsrfGuard } from '../../identity/api/csrf.guard';
import { CurrentUser } from '../../identity/api/current-user.decorator';
import type { SessionUser } from '../../identity/application/session.service';
import { AuthorizationService } from '../application/authorization.service';
import type { RoleAssignment } from '../persistence/authorization.repository';
import { PermissionGuard, RequirePermission } from './permission.guard';

/**
 * Who leads a unit.
 *
 * Separate from `AuthorizationController` because that one answers a question
 * about the CALLER and needs no permission beyond being logged in, while these
 * three change who holds authority and are global-only. One controller with
 * two guard stories is how a route ends up on the wrong one.
 *
 * `role.assign` on every route, so a head cannot appoint their successor, name
 * a co-head, or step down on their own — leadership is granted from outside the
 * unit, which is the point of having the permission at all.
 *
 * ADDRESSED BY DEPARTMENT, not by assignment id. An administrator knows which
 * unit should have which head; making them look up an assignment id first would
 * add a round trip whose only purpose is to name a row.
 */

const assignHeadSchema = z.object({
  userId: z.string().uuid(),
});

type AssignHeadInput = z.infer<typeof assignHeadSchema>;

/** The shape the client sees. `membershipId` is the entitlement, not an input. */
interface DepartmentHeadResponse {
  assignmentId: string;
  departmentId: string;
  userId: string;
  membershipId: string | null;
  grantedAt: string;
}

const asResponse = (assignment: RoleAssignment): DepartmentHeadResponse => ({
  assignmentId: assignment.id,
  departmentId: assignment.scopeId as string,
  userId: assignment.userId,
  membershipId: assignment.membershipId,
  grantedAt: assignment.grantedAt.toISOString(),
});

@Controller('departments/:departmentId/head')
export class DepartmentHeadController {
  constructor(private readonly authorization: AuthorizationService) {}

  /**
   * Who leads this unit, or 404 when nobody does.
   *
   * 404 rather than `200 null`: "this unit has no head" is the absence of the
   * resource this route names, and a client that has to distinguish `null` from
   * a missing body ends up with two ways to say the same thing.
   */
  @Get()
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('role.assign')
  async current(@Param('departmentId') departmentId: string): Promise<DepartmentHeadResponse> {
    const assignment = await this.authorization.findActiveHeadOfDepartment(departmentId);
    if (!assignment) throw new NotFoundError('That department has no active head.');

    return asResponse(assignment);
  }

  /**
   * AssignHead — the person must already be an active member of this unit.
   *
   * That requirement is invariant #6 and it is held by a foreign key, so the
   * service checks it under a lock and the database refuses it anyway. Only the
   * USER comes from the body; the unit comes from the route, and the membership
   * that entitles them is read, never supplied.
   */
  @Post()
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('role.assign')
  async assign(
    @Param('departmentId') departmentId: string,
    @Body(new ZodValidationPipe(assignHeadSchema)) body: AssignHeadInput,
    @CurrentUser() actor: SessionUser,
  ): Promise<DepartmentHeadResponse> {
    const assignment = await this.authorization.assignDepartmentHead({
      userId: body.userId,
      departmentId,
      grantedBy: actor.id,
    });

    return asResponse(assignment);
  }

  /**
   * RevokeHead — the unit is left with no head; the person stays a member.
   *
   * Replacing a head is therefore DELETE then POST. Not one call: a single
   * "set the head" would have to decide silently whether an existing head is
   * being replaced, and the unique index means the two orders are not
   * interchangeable.
   */
  @Delete()
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('role.assign')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('departmentId') departmentId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<DepartmentHeadResponse> {
    const assignment = await this.authorization.revokeHeadOfDepartment({
      departmentId,
      revokedBy: actor.id,
    });

    return asResponse(assignment);
  }
}
