import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import {
  dailyFuelDate,
  needsDailyFuelCheck,
  type DailyFuelCheck,
  type DailyFuelDeclaration,
} from '../domain/vehicle-fuel';
import { TripVehicleRepository } from '../persistence/trip-catalogue.repository';
import { DriverAssignmentRepository } from '../persistence/trip-execution.repository';
import { TripScheduleRepository } from '../persistence/trip-schedule.repository';
import { VehicleCostRepository } from '../persistence/vehicle-cost.repository';
import { KEY_REUSED, VehicleDailyFuelCheckRepository } from '../persistence/vehicle-fuel-check.repository';

/**
 * A driver answers their lorry's daily fuel check (0034).
 *
 * ★ OWNERSHIP BEFORE ANYTHING IS ANSWERED. The turn must be the caller's before
 * even a retry is looked up — `ActiveAssignmentGuard` asks the same at the HTTP
 * door, and this service asks again so no caller can be handed somebody else's
 * check by knowing their assignment id and key. A turn's driver never changes
 * (a swap ends the turn and opens another), so the unlocked answer holds; the
 * locked read re-checks it with the turn's state.
 *
 * ★ THE LORRY, THE DAY AND THE PROVENANCE ARE THE SERVER'S. The lorry is the
 * locked assignment's; the day is `dailyFuelDate(serverNow)`; the source trip
 * and assignment are that same assignment's; the author is the session. That
 * `vehicle_costs.vehicle_id` equals the assignment's lorry is THIS service's
 * invariant — no foreign key says it.
 *
 * ★ LOCK ORDER: trip → assignment → lorry (FOR SHARE, so the policy read
 * cannot change before commit) → the check's primary key. Nothing locks a lorry
 * and then a trip, so the order has no reverse.
 *
 * ★ THE KEY ANSWERS ONLY THE DECLARATION IT MADE (`answer`): its own turn gets
 * that check back — on any day, a late retry included; another turn reusing it
 * is a 409. A day already taken under a DIFFERENT key is the obligation met by
 * somebody else: the loser writes nothing and is told that check stands.
 */
@Injectable()
export class VehicleFuelService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly trips: TripScheduleRepository,
    private readonly assignments: DriverAssignmentRepository,
    private readonly vehicles: TripVehicleRepository,
    private readonly checks: VehicleDailyFuelCheckRepository,
    private readonly costs: VehicleCostRepository,
  ) {}

  /** `serverNow` is the server's clock at the request; tests pin it, nothing else passes one. */
  async declare(
    input: { assignmentId: string; declaration: DailyFuelDeclaration; clientRequestId: string; declaredBy: string },
    serverNow = new Date(),
  ): Promise<DailyFuelCheck> {
    const named = await this.assignments.findById(input.assignmentId);
    if (!named) throw new NotFoundError('Assignment not found.');
    if (named.driverUserId !== input.declaredBy) throw notTheirs();
    const lorry = named.vehicleId;
    if (!lorry) throw new ConflictError('That assignment names no lorry.');

    // Unlocked: the ordinary retry, answered without a transaction.
    const already = await this.checks.findByClientRequest(lorry, input.clientRequestId);
    if (already) return answer(already, input);

    return this.db.transaction(async (tx) => {
      const trip = await this.trips.lockActive(named.tripId, tx);
      if (!trip) throw new NotFoundError('Trip not found.');

      // Again under the trip lock: a twin that beat us here has committed.
      const twin = await this.checks.findByClientRequest(lorry, input.clientRequestId, tx);
      if (twin) return answer(twin, input);

      if (trip.status === 'finished') throw new ConflictError('That trip is closed.');
      const assignment = await this.assignments.lockActiveById(input.assignmentId, tx);
      if (!assignment?.vehicleId) throw new ConflictError('That assignment is no longer active.');
      if (assignment.driverUserId !== input.declaredBy) throw notTheirs();
      if (!needsDailyFuelCheck(await this.vehicles.findForShare(assignment.vehicleId, tx))) {
        throw new ConflictError('That lorry has no daily fuel check.');
      }

      return this.claim(input, { trip: trip.id, assignment: assignment.id, vehicle: assignment.vehicleId }, serverNow, tx);
    });
  }

  /** Takes the lorry's day, writing the fill after the check that names it — or reads the winner. */
  private async claim(
    input: { assignmentId: string; declaration: DailyFuelDeclaration; clientRequestId: string; declaredBy: string },
    turn: { trip: string; assignment: string; vehicle: string },
    serverNow: Date,
    tx: DatabaseQuery,
  ): Promise<DailyFuelCheck> {
    const { declaration } = input;
    const costId = declaration.outcome === 'fuel_added' ? randomUUID() : null;
    const provenance = {
      vehicleId: turn.vehicle,
      businessDate: dailyFuelDate(serverNow),
      sourceTripId: turn.trip,
      sourceAssignmentId: turn.assignment,
      clientRequestId: input.clientRequestId,
      createdBy: input.declaredBy,
    };

    const claimed = await this.checks.claim({ ...provenance, outcome: declaration.outcome, vehicleCostId: costId }, tx);
    if (!claimed) {
      // The primary key waited for the winner to commit, so it is visible now.
      const winner = await this.checks.find(provenance.vehicleId, provenance.businessDate, tx);
      if (!winner) throw new Error('A daily fuel check conflicted but cannot be read.');
      return answer(winner, input);
    }

    if (costId && declaration.outcome === 'fuel_added') {
      await this.costs.insert(
        {
          ...provenance,
          id: costId,
          category: 'fuel',
          amount: declaration.amount,
          liters: declaration.liters,
          odometerKm: declaration.odometerKm,
          note: declaration.note,
          source: 'driver_portal',
        },
        tx,
      );
    }
    return claimed;
  }
}

/** One refusal for "not your turn", as the guards give it: nothing about the turn is told. */
const notTheirs = () => new ForbiddenError('Only the driver on an assignment may declare its lorry’s fuel.');

/**
 * What a stored check means for THIS request. Its own key on its own turn: the
 * retry, answered with the original. Its own key on another turn: a reused key,
 * refused — never somebody else's declaration handed back. Another key: the day
 * was taken by another declaration, and that check stands.
 */
const answer = (check: DailyFuelCheck, input: { assignmentId: string; clientRequestId: string }): DailyFuelCheck => {
  if (check.clientRequestId !== input.clientRequestId) return check;
  if (check.sourceAssignmentId === input.assignmentId) return check;
  throw new ConflictError(KEY_REUSED);
};
