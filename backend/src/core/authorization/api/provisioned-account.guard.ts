import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthorizationService } from '../application/authorization.service';
import { loadProvisionedContext } from './permission.guard';

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
    await loadProvisionedContext(context.switchToHttp().getRequest<Request>(), this.authorization);
    return true;
  }
}
