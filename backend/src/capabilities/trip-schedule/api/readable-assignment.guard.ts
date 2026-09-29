import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ForbiddenError } from '../../../common/errors/domain.error';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import { loadProvisionedContext } from '../../../core/authorization/api/permission.guard';
import { DriverTripReadModelRepository } from '../persistence/driver-read-model.repository';

/**
 * May this caller OPEN the assignment on the route? The read-only twin of
 * `ActiveAssignmentGuard`, and the only route it sits on is the detail GET.
 *
 * ★ READING AND ACTING ARE TWO QUESTIONS. A driver acts on a turn that is
 * still active; they may read that, and also every turn of theirs on a trip
 * that has FINISHED — the rows "Đã chạy xong" lists, whether the turn was
 * approved, replaced before the end, or recorded after the run. One guard for
 * both made the history list link to a detail that refused it.
 *
 * ★ THE SAME STATEMENT THE SERVICE READS WITH (`findForDriver`), so the route
 * and the page cannot disagree about who may open what. Every write route
 * keeps `ActiveAssignmentGuard`; nothing here widens what may be ACTED on.
 *
 * ★ ONE MESSAGE FOR EVERY REFUSAL, exactly as `ActiveAssignmentGuard` gives it:
 * a missing id, somebody else's turn and an unreadable one of one's own all
 * answer 403 alike, so an id teaches nothing about work that is not the
 * caller's. No global bypass, for the reason that guard gives.
 */
@Injectable()
export class ReadableAssignmentGuard implements CanActivate {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly trips: DriverTripReadModelRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    // The provisioning gate, as on every driver route: a temporary password
    // reads no address and no cargo, past trips included.
    const { user } = await loadProvisionedContext(request, this.authorization);

    // From the route, never the body — see `ActiveAssignmentGuard`.
    const assignmentId = (request.params as Record<string, string | undefined>)['assignmentId'];
    if (!assignmentId) throw new ForbiddenError('You are not allowed to do that.');

    if (!(await this.trips.findForDriver(assignmentId, user.id))) {
      throw new ForbiddenError('You are not allowed to do that.');
    }
    return true;
  }
}
