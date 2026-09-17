import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenError } from '../../../common/errors/domain.error';
import { REQUEST_USER } from './current-user.decorator';
import type { SessionUser } from '../application/session.service';

/**
 * Keeps employee accounts out of the Driver Portal — the mirror of
 * `BackofficeOnlyGuard`.
 *
 * ★ WHY IT EXISTS WHEN THE ROUTES BEHIND IT ALREADY ANSWER NOTHING. An employee
 * calling `GET /driver/assignments` got `[]`, because the query starts from
 * assignments and an employee has none; every scoped route refused them because
 * they hold no active assignment. No data leaked. What was missing was the
 * SYMMETRY: one door said "not for drivers" in so many words, the other said
 * nothing and relied on the queries coming up empty. A guard that names the
 * rule is a guard review can see on the line above the handler.
 *
 * ★ WHAT IT IS NOT. It grants nothing. A caller who passes it still faces
 * `ActiveAssignmentGuard` on every route that names an assignment, and that
 * guard is still what decides which assignment is theirs.
 */
@Injectable()
export class DriverOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const user = request[REQUEST_USER] as SessionUser | undefined;

    // Absence is refused, for the reason `BackofficeOnlyGuard` gives: deciding
    // on a missing session would turn a forgotten `AuthGuard` into an open door.
    if (!user || user.accountType !== 'driver') {
      // One sentence for every case, so an employee holding a driver URL learns
      // only that it is not for them.
      throw new ForbiddenError('This area is only available to driver accounts.');
    }

    return true;
  }
}
