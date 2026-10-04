import { ValidationError } from '../../../common/errors/domain.error';
import type { DatabaseQuery } from '../../../common/types/database.port';
import type { TripVehicle } from '../domain/trip-schedule';
import { dailyFuelDate, FUEL_DECLARATION_REQUIRED, needsDailyFuelCheck } from '../domain/vehicle-fuel';
import type { VehicleDailyFuelCheckRepository } from '../persistence/vehicle-fuel-check.repository';

/**
 * ★ THE DAILY FUEL GATE: a turn on a lorry whose fuel is declared daily may not
 * START until that lorry has answered today's check (0034).
 *
 * Only the START is held — the turn's first live milestone. A turn already on
 * the road is never stopped, so a run carrying on past midnight is not asked
 * again; the next turn that starts on the new day is. The day is
 * `dailyFuelDate(serverNow)` — the clock the declaration runs on too, never the
 * milestone's own timestamp.
 *
 * A 422 with `details.dailyFuelCheck`, the shape every refusal the handset
 * reads takes; the caller writes nothing — no event, no status move — so the
 * same milestone, retried with the same key after the declaration, is new.
 *
 * Called by `TripExecutionService.recordEvent` under its trip → assignment
 * locks, with the lorry read FOR SHARE (its policy holds until commit). The
 * check read takes no lock: a declaration committing a moment later only means
 * the driver is asked, declares, and is answered with that check.
 */
export async function requireDailyFuelCheck(
  checks: VehicleDailyFuelCheckRepository,
  input: { vehicle: TripVehicle | null; turnStarted: boolean; serverNow: Date },
  tx: DatabaseQuery,
): Promise<void> {
  if (input.turnStarted || !input.vehicle || !needsDailyFuelCheck(input.vehicle)) return;
  if (await checks.exists(input.vehicle.id, dailyFuelDate(input.serverNow), tx)) return;
  throw new ValidationError('This lorry needs its daily fuel check before the day’s first milestone.', {
    dailyFuelCheck: FUEL_DECLARATION_REQUIRED,
  });
}
