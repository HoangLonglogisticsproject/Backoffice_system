import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  ForbiddenError,
  PasswordChangeRequiredError,
  UnauthorizedError,
} from '../../../common/errors/domain.error';
import { REQUEST_USER } from '../../identity/api/current-user.decorator';
import type { SessionUser } from '../../identity/application/session.service';
import { AuthorizationService } from '../application/authorization.service';
import { can, type AuthorizationContext } from '../domain/authorization.context';
import type { PermissionKey } from '../domain/permission';

export const REQUIRED_PERMISSION = 'boRequiredPermission';
export const SCOPE_PARAM = 'boScopeParam';

/** Set by PermissionGuard so a handler can read the context it was judged by. */
export const REQUEST_AUTHORIZATION = 'boAuthorizationContext';

/**
 * `@RequirePermission('unit.member.read', 'departmentId')`
 *
 * The second argument names the ROUTE PARAMETER holding the target department.
 * A route parameter, never a body field: the body is what the caller wants to
 * do, and letting it also declare what the caller may do is the whole class of
 * bug this project exists to avoid. Omit it for permissions that are global by
 * nature — `can()` refuses a scoped permission with no target anyway.
 */
export const RequirePermission = (permission: PermissionKey, scopeParam?: string) =>
  SetMetadata(REQUIRED_PERMISSION, { permission, scopeParam });

interface PermissionMetadata {
  permission: PermissionKey;
  scopeParam?: string;
}

/**
 * Turns an authenticated caller into an authorized one, or refuses.
 *
 * Runs AFTER `AuthGuard`, always — it reads the user that guard attached, and
 * refuses outright if it is missing, which is what a handler that forgot
 * `AuthGuard` looks like from here.
 *
 * The context is loaded from the database on EVERY request. Not cached, not
 * carried in the session: a revoked role must stop working immediately, and any
 * cache is a window in which it does not.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<PermissionMetadata | undefined>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()],
    );

    // A handler behind this guard with no declared permission is a mistake, and
    // the safe reading of a mistake is "no".
    if (!metadata) throw new ForbiddenError('No permission declared for this route.');

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as Record<string, unknown>)[REQUEST_USER] as
      | SessionUser
      | undefined;

    if (!user) throw new UnauthorizedError('Authentication required.');

    const authorization = await this.authorization.loadContext(user.id);
    (request as unknown as Record<string, unknown>)[REQUEST_AUTHORIZATION] = authorization;

    // Provisioning is not finished until the temporary credential is replaced.
    // Refused here rather than at each call site so it cannot be forgotten at
    // one of them; the four identity endpoints that such a caller MAY use
    // declare no permission and therefore never reach this guard.
    if (authorization.mustChangeSecret) {
      throw new PasswordChangeRequiredError('Password change required before using this deployment.');
    }

    const departmentId = metadata.scopeParam
      ? (request.params as Record<string, string | undefined>)[metadata.scopeParam]
      : undefined;

    if (!can(authorization, metadata.permission, { departmentId })) {
      throw new ForbiddenError('You are not allowed to do that.');
    }

    return true;
  }
}

/** Reads the context PermissionGuard attached. Undefined without the guard. */
export const authorizationOf = (request: Request): AuthorizationContext | undefined =>
  (request as unknown as Record<string, unknown>)[REQUEST_AUTHORIZATION] as
    | AuthorizationContext
    | undefined;

/** Names the route parameter holding the department a head must lead. */
export const HEAD_SCOPE_PARAM = 'boHeadScopeParam';
export const RequireHeadOfRouteDepartment = (routeParam = 'departmentId') =>
  SetMetadata(HEAD_SCOPE_PARAM, routeParam);

/**
 * Refuses anybody who is not the active head of the department named on the
 * route — or a global administrator, who is above departments.
 *
 * GENERIC ON PURPOSE, which is why it lives in core rather than in a capability.
 * "Is this caller the head of that unit" is an access decision; the permission
 * keys that ride on it (`membership.request.create`,
 * `account.invitation.create`) name capability artifacts and stay in the
 * capabilities that own them. Two capabilities need this same check, which is
 * what makes it worth having once.
 *
 * Reads the department from the ROUTE. A body that named it could name any of
 * them.
 */
@Injectable()
export class HeadOfRouteDepartmentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const routeParam =
      this.reflector.getAllAndOverride<string | undefined>(HEAD_SCOPE_PARAM, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'departmentId';

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as Record<string, unknown>)[REQUEST_USER] as
      | SessionUser
      | undefined;

    if (!user) throw new UnauthorizedError('Authentication required.');

    const authorization = await this.authorization.loadContext(user.id);
    (request as unknown as Record<string, unknown>)[REQUEST_AUTHORIZATION] = authorization;

    // Provisioning is not finished until the temporary credential is replaced;
    // such a caller may do nothing but change it.
    if (authorization.mustChangeSecret) {
      throw new PasswordChangeRequiredError('Password change required before using this deployment.');
    }

    const departmentId = (request.params as Record<string, string | undefined>)[routeParam];
    if (!departmentId) throw new ForbiddenError('You are not allowed to do that.');

    const allowed =
      authorization.global || authorization.headOf.includes(departmentId);

    if (!allowed) throw new ForbiddenError('You are not allowed to do that.');

    return true;
  }
}
