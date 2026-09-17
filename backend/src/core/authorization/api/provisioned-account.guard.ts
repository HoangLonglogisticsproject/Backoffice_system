import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PasswordChangeRequiredError, UnauthorizedError } from '../../../common/errors/domain.error';
import { REQUEST_USER } from '../../identity/api/current-user.decorator';
import type { SessionUser } from '../../identity/application/session.service';
import { AuthorizationService } from '../application/authorization.service';
import { REQUEST_AUTHORIZATION } from './permission.guard';

/**
 * Refuses a caller who has not replaced their temporary credential — and
 * decides nothing else.
 *
 * ★ WHY A FOURTH GUARD REPEATS A CHECK THREE OTHERS ALREADY MAKE. Every guard
 * that loads an authorization context applies the provisioning gate, because a
 * half-provisioned account may authenticate and must do nothing more. A route
 * that declares NO permission and names NO resource — `GET /driver/assignments`,
 * whose scope is the session itself — reached none of those guards, and so
 * answered a driver still holding their temporary password with the customer,
 * the addresses and the cargo of every trip they were on. The contract says
 * such a caller "làm được bất cứ việc gì" only after changing it.
 *
 * So the gate is available on its own, for routes whose only authorization
 * question is "is this account finished". It loads the context the way the
 * others do — fresh, never cached — and attaches it, so a handler behind it
 * reads the same object a permission-guarded handler would.
 */
@Injectable()
export class ProvisionedAccountGuard implements CanActivate {
  constructor(private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as Record<string, unknown>)[REQUEST_USER] as
      | SessionUser
      | undefined;

    if (!user) throw new UnauthorizedError('Authentication required.');

    const authorization = await this.authorization.loadContext(user.id);
    (request as unknown as Record<string, unknown>)[REQUEST_AUTHORIZATION] = authorization;

    if (authorization.mustChangeSecret) {
      throw new PasswordChangeRequiredError('Password change required before using this deployment.');
    }

    return true;
  }
}
