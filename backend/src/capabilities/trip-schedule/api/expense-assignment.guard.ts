import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ForbiddenError } from '../../../common/errors/domain.error';
import { AuthorizationService } from '../../../core/authorization/application/authorization.service';
import { loadProvisionedContext } from '../../../core/authorization/api/permission.guard';
import { carriesDriverMoney } from '../domain/trip-execution';
import { DriverAssignmentRepository } from '../persistence/trip-execution.repository';
import { TripScheduleRepository } from '../persistence/trip-schedule.repository';

/**
 * May this caller write MONEY on the assignment on the route — declare a
 * figure, or correct one they declared? The guard on the two expense routes,
 * and on nothing else.
 *
 * ★ WIDER THAN `ActiveAssignmentGuard` IN EXACTLY ONE WAY. A turn recorded
 * after the run ("Nhập chuyến cũ") is ended from birth, and its driver may
 * still add what it cost — the office backfills old runs before anybody knows
 * the figures. So the turn must be active OR recorded (`carriesDriverMoney`);
 * a turn replaced or removed carries none. Reporting and completion keep the
 * active-only guard: nothing here reopens a lifecycle.
 *
 * ★ AN ARCHIVED TRIP TAKES NO MONEY FROM A DRIVER, whoever asks and whatever
 * the turn. It is off every driver list already; an old assignment id kept on
 * a handset must not reach it either. The service refuses it a second time —
 * `lockActive` skips archived rows.
 *
 * ★ THE TRIP'S LIFECYCLE IS THE SERVICE'S TO JUDGE, under its lock, through
 * the same `driverExpenseScope`: an active turn on a trip closed by approval is
 * refused there ("That trip is closed"), which is also what lets a phone's
 * retry of a figure declared moments before still be answered with it.
 *
 * One message for every refusal and no global bypass, as `ActiveAssignmentGuard`
 * gives them: an id teaches nothing about work that is not the caller's, and
 * nobody declares a driver's expenses on their behalf.
 */
@Injectable()
export class ExpenseAssignmentGuard implements CanActivate {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly assignments: DriverAssignmentRepository,
    private readonly trips: TripScheduleRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    // The provisioning gate, as on every driver route.
    const { user } = await loadProvisionedContext(request, this.authorization);

    // From the route, never the body — see `ActiveAssignmentGuard`.
    const assignmentId = (request.params as Record<string, string | undefined>)['assignmentId'];
    if (!assignmentId) throw new ForbiddenError('You are not allowed to do that.');

    const turn = await this.assignments.findById(assignmentId);
    if (turn?.driverUserId !== user.id || !carriesDriverMoney(turn)) {
      throw new ForbiddenError('You are not allowed to do that.');
    }
    // Archive-aware: an archived trip reads as no trip at all.
    if (!(await this.trips.findById(turn.tripId))) {
      throw new ForbiddenError('You are not allowed to do that.');
    }
    return true;
  }
}
