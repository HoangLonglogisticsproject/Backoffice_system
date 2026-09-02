import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  ForbiddenError,
  PasswordChangeRequiredError,
  UnauthorizedError,
} from '../../../common/errors/domain.error';
import { REQUEST_USER } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import { REQUEST_AUTHORIZATION } from '../../../core/authorization/api/permission.guard';
import { DriverAssignmentRepository } from '../persistence/trip-execution.repository';

/**
 * Is this caller the driver currently assigned to the trip on the route?
 *
 * ★ WHY THIS IS A GUARD AND NOT A NEW PERMISSION TIER.
 *
 * Every tier `can()` understands — `any`, `member`, `head`, `head-anywhere`,
 * `global` — answers one shape of question: what is this caller's relation to a
 * DEPARTMENT. A driver's authority has no department in it at all. It comes from
 * a row in `trip_driver_assignments`, and whether that row exists is knowable
 * only after a query.
 *
 * Teaching `can()` to answer it would mean teaching a PURE FUNCTION to read the
 * database, and `permission.guard.ts` already rejects that in as many words:
 * putting a data-access strategy inside the one guard every route depends on is
 * "the God Guard this codebase deliberately does not have". A sixth tier would
 * be exactly that, so there is no sixth tier and no new permission key.
 *
 * ★ THE PRECEDENT IS ALREADY HERE, TWICE. `HeadOfRouteDepartmentGuard` decides
 * from the context directly, without calling `can()` at all;
 * `HeadOfTargetUserDepartmentGuard` resolves a target with a query first. This
 * guard is the same shape as both: a small, single-purpose check that names what
 * it needs from the ROUTE and answers one question.
 *
 * ★ NO GLOBAL BYPASS, AND THAT IS A BUSINESS RULE RATHER THAN AN OVERSIGHT.
 * The contract says an execution event is raised by the driver and by nobody on
 * their behalf — there is no agreed workflow for Operations reporting an arrival
 * they did not witness. So a global administrator fails here like anybody else.
 * They are not under-privileged; they are the wrong actor, and the services
 * refuse them a second time for the same reason.
 *
 * ⚠ IT AUTHORIZES, IT DOES NOT VALIDATE. Whether the trip is closed, whether a
 * figure is still editable, whether a completion is already pending — all of
 * that stays in the services, where it is decided under a row lock inside the
 * transaction that acts on it. This guard's answer would be stale by then
 * anyway.
 */
@Injectable()
export class ActiveAssignmentGuard implements CanActivate {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly assignments: DriverAssignmentRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as Record<string, unknown>)[REQUEST_USER] as
      | SessionUser
      | undefined;

    // Runs after AuthGuard, always. A missing user is what a route that forgot
    // AuthGuard looks like from here, and the safe reading of that is "no".
    if (!user) throw new UnauthorizedError('Authentication required.');

    const authorization = await this.authorization.loadContext(user.id);
    (request as unknown as Record<string, unknown>)[REQUEST_AUTHORIZATION] = authorization;

    // The same gate the other three guards apply: provisioning is not finished
    // until the temporary credential is replaced. Repeated here because this
    // guard may be the only one on a route, and forgetting it would let a
    // half-provisioned account report deliveries.
    if (authorization.mustChangeSecret) {
      throw new PasswordChangeRequiredError(
        'Password change required before using this deployment.',
      );
    }

    // ★ FROM THE ROUTE, NEVER FROM THE BODY. A body that named its own trip
    // would let a caller assigned to one trip act on any other by sending a
    // different id — the whole class of bug the permission guard's route-scope
    // rule exists to prevent, arriving through a different door.
    const tripId = (request.params as Record<string, string | undefined>)['tripId'];
    if (!tripId) throw new ForbiddenError('You are not allowed to do that.');

    const assignment = await this.assignments.findActive(tripId);

    // ★ ONE MESSAGE FOR THREE CASES: no such trip, a trip with no driver, and
    // somebody else's trip. Distinguishing them would let a caller holding only
    // a trip id learn whether it exists and whether it is crewed — which is
    // information about work that is not theirs.
    if (assignment?.driverUserId !== user.id) {
      throw new ForbiddenError('You are not allowed to do that.');
    }

    return true;
  }
}
