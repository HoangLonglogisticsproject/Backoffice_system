import {
  dataIssuesOf,
  focusOf,
  fuelObligationOf,
  progressOf,
  turnStateOf,
  vehicleStateOf,
} from './fleet-operations';
import { sameFill } from './vehicle-fuel';

describe('fleet operations — derived, never stored', () => {
  it('counts the milestones reached, in any order, and names the first still owed', () => {
    expect(progressOf([])).toEqual({ reached: 0, next: 'ARRIVED_PICKUP' });
    expect(progressOf(['PICKUP_CONFIRMED', 'ARRIVED_PICKUP'])).toEqual({ reached: 2, next: 'ARRIVED_DELIVERY' });
    // A withdrawn arrival leaves a gap: the gap is what is owed.
    expect(progressOf(['PICKUP_CONFIRMED'])).toEqual({ reached: 1, next: 'ARRIVED_PICKUP' });
    expect(progressOf(['ARRIVED_PICKUP', 'PICKUP_CONFIRMED', 'ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED'])).toEqual({
      reached: 4,
      next: null,
    });
  });

  it('a turn is waiting before its first milestone, running until all four, done after — or when its trip closed', () => {
    expect(turnStateOf({ closed: false, progress: progressOf([]) })).toBe('waiting');
    expect(turnStateOf({ closed: false, progress: progressOf(['ARRIVED_PICKUP']) })).toBe('running');
    expect(
      turnStateOf({
        closed: false,
        progress: progressOf(['ARRIVED_PICKUP', 'PICKUP_CONFIRMED', 'ARRIVED_DELIVERY', 'DELIVERY_CONFIRMED']),
      }),
    ).toBe('done');
    expect(turnStateOf({ closed: true, progress: progressOf([]) })).toBe('done');
  });

  it('a lorry takes its busiest turn: running over waiting over done; no turn is unassigned', () => {
    expect(vehicleStateOf([{ state: 'done' }, { state: 'waiting' }, { state: 'running' }])).toBe('running');
    expect(vehicleStateOf([{ state: 'done' }, { state: 'waiting' }])).toBe('waiting');
    expect(vehicleStateOf([{ state: 'done' }])).toBe('done');
    expect(vehicleStateOf([])).toBe('unassigned');
  });

  it('★ the row speaks for ONE turn: the first running, else the first waiting, else the last done', () => {
    const t = (id: string, state: 'running' | 'waiting' | 'done') => ({ id, state });
    // A finished, B waiting → B, nothing after it.
    expect(focusOf([t('A', 'done'), t('B', 'waiting')])).toEqual({ current: t('B', 'waiting'), next: null });
    // A finished, B running, C waiting → B, then C.
    expect(focusOf([t('A', 'done'), t('B', 'running'), t('C', 'waiting')])).toEqual({
      current: t('B', 'running'),
      next: t('C', 'waiting'),
    });
    // A running AFTER a waiting turn in the day's order still wins; the waiting one is next.
    expect(focusOf([t('A', 'waiting'), t('B', 'running')])).toEqual({ current: t('B', 'running'), next: t('A', 'waiting') });
    // Two waiting: the first is current, the second is next — the order decides, never chance.
    expect(focusOf([t('A', 'waiting'), t('B', 'waiting')])).toEqual({ current: t('A', 'waiting'), next: t('B', 'waiting') });
    // All done → the last of the day; nothing next.
    expect(focusOf([t('A', 'done'), t('B', 'done')])).toEqual({ current: t('B', 'done'), next: null });
    expect(focusOf([])).toEqual({ current: null, next: null });
  });

  it('the obligation is the check when answered, owed only with work and the flag', () => {
    const base = { dailyFuelCheckRequired: true, checkOutcome: null, hasWork: true };
    expect(fuelObligationOf(base)).toBe('REQUIRED_MISSING');
    expect(fuelObligationOf({ ...base, hasWork: false })).toBe('NOT_REQUIRED');
    expect(fuelObligationOf({ ...base, dailyFuelCheckRequired: false })).toBe('NOT_REQUIRED');
    expect(fuelObligationOf({ ...base, checkOutcome: 'fuel_added' })).toBe('FUEL_ADDED');
    // A recorded answer stands even if the flag was switched off since.
    expect(fuelObligationOf({ ...base, dailyFuelCheckRequired: false, checkOutcome: 'no_fuel' })).toBe('NO_FUEL');
  });

  it('flags only what the rows prove', () => {
    expect(dataIssuesOf({ obligation: 'NO_FUEL', fillsWithoutLiters: 0, fillsWithoutOdometer: 0 })).toEqual([]);
    expect(dataIssuesOf({ obligation: 'REQUIRED_MISSING', fillsWithoutLiters: 1, fillsWithoutOdometer: 2 })).toEqual([
      'FUEL_UNDECLARED',
      'LITERS_MISSING',
      'ODOMETER_MISSING',
    ]);
  });

  it('a retried fill is the same fill when its numbers are equal, however written', () => {
    const stored = { amount: '700000.00', liters: '30.50', odometerKm: 120500, note: null };
    expect(sameFill(stored, { amount: '700000', liters: '30.5', odometerKm: 120500, note: null })).toBe(true);
    expect(sameFill(stored, { ...stored, amount: '700000.01' })).toBe(false);
    expect(sameFill(stored, { ...stored, liters: null })).toBe(false);
    expect(sameFill(stored, { ...stored, odometerKm: 120501 })).toBe(false);
    expect(sameFill(stored, { ...stored, note: 'khác' })).toBe(false);
    expect(sameFill({ ...stored, amount: '999999999999.99' }, { ...stored, amount: '999999999999.98' })).toBe(false);
  });
});
