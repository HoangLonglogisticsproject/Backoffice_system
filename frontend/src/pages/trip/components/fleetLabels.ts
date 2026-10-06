import type { StatusTone } from '@/components/common/StatusPill';
import type { FuelObligation } from '@/types/driver';
import type { FleetDataIssue, FleetTurn, FleetVehicleState } from '@/types/fleet';
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

/** The turn a dispatcher asks about first: on the road, else the next to start, else the last done. */
export const turnInFocus = (turns: readonly FleetTurn[]): FleetTurn | null =>
  turns.find((turn) => turn.state === 'running') ??
  turns.find((turn) => turn.state === 'waiting') ??
  turns[turns.length - 1] ??
  null;
