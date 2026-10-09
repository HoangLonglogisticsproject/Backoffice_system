import type { DriverWorkday } from '@/types/driver';
import { currentAndNext } from './driverSchedule';

type Lorry = DriverWorkday['vehicles'][number];

/** What a lorry's fuel button does today, and through which of the driver's turns. */
export type FuelAction = { kind: 'check' | 'fill'; lorry: Lorry; assignmentId: string };

/**
 * ★ THE ONE RULE FOR "WHICH FUEL BUTTON", used by the day's board and by
 * "Nhiên liệu": the beginning-of-shift check while the lorry still owes it
 * (through a turn whose trip is open — the server's rule too), otherwise a fill
 * through the turn in hand, or the day's last. The lorry is the turn's, never chosen.
 */
export function fuelActionOf(lorry: Lorry): FuelAction | null {
  const { current } = currentAndNext(lorry.turns);
  const checkThrough = lorry.turns.find((turn) => !turn.closed) ?? null;
  if (lorry.fuel === 'REQUIRED_MISSING' && checkThrough) return { kind: 'check', lorry, assignmentId: checkThrough.assignment.id };
  const fillThrough = current ?? lorry.turns[lorry.turns.length - 1] ?? null;
  if (lorry.fuelOnVehicle && fillThrough) return { kind: 'fill', lorry, assignmentId: fillThrough.assignment.id };
  return null;
}
