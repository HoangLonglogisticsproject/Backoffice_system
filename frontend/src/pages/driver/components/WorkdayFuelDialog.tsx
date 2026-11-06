import { useWorkdayFuel } from '@/hooks/driver';
import type { FuelAction } from '@/utils/driverFuel';
import { DailyFuelDialog } from './DailyFuelDialog';

/**
 * The fuel dialog for one lorry's action — the beginning-of-shift check or a
 * fill — written through the action's turn. The parent mounts a fresh one per
 * opening (`key`), so each carries its own request key.
 */
export function WorkdayFuelDialog({ action, onDone }: Readonly<{ action: FuelAction; onDone: () => void }>) {
  const { declareCheck, recordFill } = useWorkdayFuel();
  return (
    <DailyFuelDialog
      mode={action.kind}
      plate={action.lorry.vehicle.plate}
      saving={declareCheck.isPending || recordFill.isPending}
      onSubmit={(input) => {
        if (action.kind === 'check') return declareCheck.mutateAsync({ assignmentId: action.assignmentId, input });
        if (input.outcome !== 'fuel_added') throw new Error('A fill always adds fuel.');
        const { outcome: _outcome, ...fill } = input;
        return recordFill.mutateAsync({ assignmentId: action.assignmentId, input: fill });
      }}
      onDeclared={onDone}
      onClose={onDone}
    />
  );
}
