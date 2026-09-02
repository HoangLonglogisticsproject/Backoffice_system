import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenError } from '../../../common/errors/domain.error';
import { REQUEST_USER } from './current-user.decorator';
import type { SessionUser } from '../application/session.service';

/**
 * Keeps driver accounts out of the Backoffice.
 *
 * ★ WHY A GUARD AND NOT A PERMISSION TIER.
 *
 * `trip.read` is `'any'`, which means "any authenticated caller" — company-wide
 * dispatch information with no departmental owner. That was a safe reading
 * while every account belonged to a department. Driver accounts break the
 * assumption: they authenticate, they hold no membership, and `'any'` would
 * hand them the entire board — every customer, address, contact and cargo note
 * on every trip, which is exactly what the business contract forbids (§5, L-1).
 *
 * Tightening the tier was the obvious alternative and it is the wrong one. It
 * would refuse the same routes to any employee who happens to sit outside a
 * department, changing authorization for people this feature has nothing to do
 * with. The rule is not "narrow the audience"; it is "this ONE kind of account
 * does not belong here", so the guard says that and nothing else.
 *
 * ★ WHAT IT IS NOT. It grants nothing. A caller who passes it still faces
 * `PermissionGuard` and still needs the permission the route asks for. This
 * only removes drivers from the set of callers who get that far.
 *
 * ★ AND IT IS NOT A SUBSTITUTE FOR THE DRIVER PORTAL'S OWN RULE. Drivers read
 * trips through `/driver`, where `ActiveAssignmentGuard` narrows them further
 * to the trip they are actually assigned to. This guard closes the Backoffice
 * door; that one decides which single trip is theirs.
 */
@Injectable()
export class BackofficeOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const user = request[REQUEST_USER] as SessionUser | undefined;

    // No user means `AuthGuard` has not run or has already refused. Deciding
    // "not a driver, therefore allowed" on an absent session would turn a
    // missing guard into an open door, so absence is refused here too.
    if (!user || user.accountType === 'driver') {
      // ★ THE SAME SENTENCE FOR BOTH CASES, deliberately. A driver holding a
      // Backoffice URL learns only that it is not for them — never whether the
      // route exists, and never that a different account type would have been
      // answered differently.
      throw new ForbiddenError('This area is not available to driver accounts.');
    }

    return true;
  }
}
