import { Controller, Get, UseGuards } from '@nestjs/common';
import { PasswordChangeRequiredError } from '../../../common/errors/domain.error';
import { AuthGuard } from '../../identity/api/auth.guard';
import { CurrentUser } from '../../identity/api/current-user.decorator';
import type { SessionUser } from '../../identity/application/session.service';
import { AuthorizationService } from '../application/authorization.service';
import { grantedPermissions, roleOf } from '../domain/authorization.context';
import { localPartOf } from '../domain/username';
import type { PermissionKey, RoleKey } from '../domain/permission';

export interface AuthorizationMeResponse {
  userId: string;
  /** Local part of the login email. Display only — never an authorization input. */
  username: string | null;
  role: RoleKey;
  /** At most one, by invariant; empty for a SuperAdmin, who sits above units. */
  departmentIds: string[];
  permissions: PermissionKey[];
}

/**
 * What the caller may do, as the server sees it.
 *
 * Everything here is DERIVED SERVER-SIDE from the database on this request. The
 * client never sends a role, a scope or a permission, and nothing it could send
 * would change this answer — the same values are recomputed for the next
 * request, with the target in hand.
 *
 * This is a rendering aid, not an authorization decision. The decision happens
 * per endpoint in `PermissionGuard`, which is why hiding a button is a
 * convenience and never a control.
 */
@Controller('authorization')
export class AuthorizationController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: SessionUser): Promise<AuthorizationMeResponse> {
    const context = await this.authorization.loadContext(user.id);

    // A caller still holding a temporary credential has finished authentication
    // but not provisioning. They may look at `/auth/me` and change their
    // password; they may not learn what authority they will have until they do.
    if (context.mustChangeSecret) {
      throw new PasswordChangeRequiredError('Password change required before using this deployment.');
    }

    const subject = await this.authorization.findLocalSubject(user.id);

    return {
      userId: context.userId,
      username: subject ? localPartOf(subject) : null,
      role: roleOf(context),
      departmentIds: [...context.memberOf],
      permissions: grantedPermissions(context),
    };
  }
}
