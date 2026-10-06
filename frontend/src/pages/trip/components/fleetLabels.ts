import type { StatusTone } from '@/components/common/StatusPill';
import type { FuelObligation } from '@/types/driver';
import type { FleetDataIssue, FleetTurn, FleetVehicleDay, FleetVehicleState } from '@/types/fleet';
import type { TranslationKey } from '@/types/translate';

/** The words and tones "Điều hành xe" and its lorry detail share. */

export const STATE_LABEL: Record<FleetVehicleState, TranslationKey> = {
  running: 'fleetStateRunning',
  waiting: 'fleetStateWaiting',
  done: 'fleetStateDone',
  unassigned: 'fleetStateUnassigned',
};

export const STATE_TONE: Record<FleetVehicleState, StatusTone> = {
  running: 'blue',
  waiting: 'amber',
  done: 'green',
  unassigned: 'gray',
};

export const FUEL_LABEL: Record<FuelObligation, TranslationKey> = {
  NOT_REQUIRED: 'fuelObligationNotRequired',
  REQUIRED_MISSING: 'fuelObligationMissing',
  FUEL_ADDED: 'fuelObligationAdded',
  NO_FUEL: 'fuelObligationNone',
};

export const FUEL_TONE: Record<FuelObligation, StatusTone> = {
  NOT_REQUIRED: 'gray',
  REQUIRED_MISSING: 'red',
  FUEL_ADDED: 'green',
  NO_FUEL: 'green',
};

export const ISSUE_LABEL: Record<FleetDataIssue, TranslationKey> = {
  FUEL_UNDECLARED: 'fleetIssueUndeclared',
  LITERS_MISSING: 'fleetIssueLiters',
  ODOMETER_MISSING: 'fleetIssueOdometer',
};

/** The turns the server chose for the row: the one it speaks for, and the next. */
export const focusOf = (row: FleetVehicleDay): { current: FleetTurn | null; next: FleetTurn | null } => ({
  current: row.turns.find((turn) => turn.assignmentId === row.currentAssignmentId) ?? null,
  next: row.turns.find((turn) => turn.assignmentId === row.nextAssignmentId) ?? null,
});
