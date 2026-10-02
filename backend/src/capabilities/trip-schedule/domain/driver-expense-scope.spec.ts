import { carriesDriverMoney, driverExpenseScope, driverExpensesOpen } from './trip-execution';

/**
 * ★ THE ONE RULE FOR A DRIVER'S OWN MONEY — what the expense guard, the cost
 * service (under its lock) and the driver read model's `expensesOpen` all ask.
 */
describe('driverExpenseScope — which of a driver’s turns may still take money', () => {
  const active = { state: 'active' as const, endReason: null };
  const recorded = { state: 'ended' as const, endReason: 'historical_entry' };
  const replaced = { state: 'ended' as const, endReason: 'xe hỏng' };
  const open = { status: 'executing' as const, archived: false };
  const finished = { status: 'finished' as const, archived: false };

  it('★ an active turn on a trip still running is operational', () => {
    expect(driverExpenseScope(active, open)).toBe('operational');
    expect(driverExpenseScope(active, { status: 'pending', archived: false })).toBe('operational');
  });

  it('★ a turn recorded after the run, on its finished trip, is historical', () => {
    expect(driverExpenseScope(recorded, finished)).toBe('historical');
  });

  it('★ a normal finished trip takes no money — an active turn closed by approval or by hand', () => {
    expect(driverExpenseScope(active, finished)).toBeNull();
  });

  it('a turn replaced or removed carries no money, open trip or not', () => {
    expect(driverExpenseScope(replaced, open)).toBeNull();
    expect(driverExpenseScope(replaced, finished)).toBeNull();
  });

  it('★ an archived trip takes no money from anybody, whatever the turn', () => {
    expect(driverExpenseScope(active, { ...open, archived: true })).toBeNull();
    expect(driverExpenseScope(recorded, { ...finished, archived: true })).toBeNull();
  });

  it('a recorded turn on a trip that is somehow not finished is not historical', () => {
    expect(driverExpenseScope(recorded, open)).toBeNull();
  });

  it('the guard’s half — whether a turn can carry money at all — is the same rule, before the trip is asked', () => {
    expect(carriesDriverMoney(active)).toBe(true);
    expect(carriesDriverMoney(recorded)).toBe(true);
    expect(carriesDriverMoney(replaced)).toBe(false);
  });
});

describe('driverExpensesOpen — what the handset is told', () => {
  it('★ opens on a scope with a lorry and nothing holding the money', () => {
    expect(driverExpensesOpen('operational', true, [])).toBe(true);
    expect(driverExpensesOpen('historical', true, [])).toBe(true);
    expect(driverExpensesOpen('operational', true, [{ state: 'rejected' }])).toBe(true);
  });

  it('closes with no scope, no lorry, a request under review, or an approved turn', () => {
    expect(driverExpensesOpen(null, true, [])).toBe(false);
    expect(driverExpensesOpen('operational', false, [])).toBe(false);
    expect(driverExpensesOpen('operational', true, [{ state: 'pending' }])).toBe(false);
    expect(driverExpensesOpen('operational', true, [{ state: 'approved' }, { state: 'rejected' }])).toBe(false);
  });
});
