import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import type { DatabaseQuery } from '../../../common/types/database.port';
import type { UserRepository } from '../../../core/users/persistence/user.repository';
import type { TripVehicleRepository } from '../persistence/trip-catalogue.repository';

/**
 * Who and what may be put on a trip — one rule for every path that crews one:
 * dispatch (`TripExecutionService`) and the crew of a trip recorded after it
 * ran (`TripEntryCrew`).
 */

/** The lorry exists and is still in the fleet. Whether it is free on THIS trip is the caller's. */
export async function requireDispatchableVehicle(
  vehicles: TripVehicleRepository,
  vehicleId: string,
  tx: DatabaseQuery,
): Promise<void> {
  const vehicle = await vehicles.findById(vehicleId, tx);
  if (!vehicle) throw new NotFoundError('Vehicle not found.');
  if (vehicle.status !== 'active') {
    throw new ConflictError('That vehicle has been retired from the catalogue.');
  }
}

/**
 * ★ ELIGIBILITY IS THREE FACTS ABOUT THE ACCOUNT, AND NOTHING SPECULATIVE.
 * The person exists, they are a driver account, and the account is live.
 * There is no rule about how many trips a driver may hold or when — the
 * business has not defined one, and inventing it here would block real
 * dispatch on a guess.
 */
export async function requireEligibleDriver(
  users: UserRepository,
  driverUserId: string,
  tx: DatabaseQuery,
): Promise<void> {
  const user = await users.findById(driverUserId, tx);
  if (!user) throw new NotFoundError('Driver not found.');
  if (user.accountType !== 'driver') {
    throw new ValidationError('Only a driver account can be assigned to a trip.', {
      driverUserId: 'This account is not a driver account.',
    });
  }
  if (user.status !== 'active') {
    throw new ConflictError('That driver account is disabled and cannot be assigned.');
  }
}
