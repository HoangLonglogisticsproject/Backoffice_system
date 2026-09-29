import { Injectable } from '@nestjs/common';
import { ValidationError } from '../../../common/errors/domain.error';
import type { DatabaseQuery } from '../../../common/types/database.port';
import { UserRepository } from '../../../core/users/persistence/user.repository';
import { TripVehicleRepository } from '../persistence/trip-catalogue.repository';
import { DriverAssignmentRepository } from '../persistence/trip-execution.repository';
import { requireDispatchableVehicle, requireEligibleDriver } from './dispatch-eligibility';

/** One lorry and its driver — the pair the dispatch routes take. */
export interface CrewPair {
  vehicleId: string;
  driverUserId: string;
}

/**
 * The crew a trip is CREATED with, when it is created closed — the lorries and
 * drivers a recorded run went out with.
 *
 * ★ THE SAME RULES DISPATCH HOLDS, NOT A SECOND SET. Each pair passes the
 * dispatch eligibility checks and is written by the dispatch repository's own
 * statements. What differs is only that the run is over: each turn is ENDED in
 * the same transaction, marked with the trip's reason, so no driver portal and
 * no operational board ever sees it as work — and no completion request,
 * execution event or notification is invented for a drive nobody reported.
 */
@Injectable()
export class TripEntryCrew {
  constructor(
    private readonly assignments: DriverAssignmentRepository,
    private readonly vehicles: TripVehicleRepository,
    private readonly users: UserRepository,
  ) {}

  async recordEnded(
    tripId: string,
    crew: readonly CrewPair[],
    entry: { by: string; reason: string; now: Date },
    tx: DatabaseQuery,
  ): Promise<void> {
    requireDistinctLorries(crew);
    for (const [ordinal, pair] of crew.entries()) {
      await requireDispatchableVehicle(this.vehicles, pair.vehicleId, tx);
      await requireEligibleDriver(this.users, pair.driverUserId, tx);
      // Each pair stamped `now()` + its input index (µs), so the crew reads back
      // `assigned_at, id` in EXACTLY the order it was entered, the pair whole.
      const turn = await this.assignments.assign({ tripId, ...pair, assignedBy: entry.by }, tx, ordinal);
      await this.assignments.end({ id: turn.id, endedBy: entry.by, reason: entry.reason, now: entry.now }, tx);
    }
  }
}

/**
 * One lorry once. Dispatch leans on a partial unique index over ACTIVE turns;
 * these are never active, so the rule is said here instead.
 */
const requireDistinctLorries = (crew: readonly CrewPair[]): void => {
  if (new Set(crew.map((pair) => pair.vehicleId)).size === crew.length) return;
  throw new ValidationError('The same vehicle is listed twice on this trip.', { crew: 'DUPLICATE_VEHICLE' });
};
