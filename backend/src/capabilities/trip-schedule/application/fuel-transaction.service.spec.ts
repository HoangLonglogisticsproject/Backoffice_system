import type { Database } from '../../../common/types/database.port';
import type { FuelEvidenceRepository } from '../persistence/fuel-evidence.repository';
import type { FuelTransactionRepository } from '../persistence/fuel-transaction.repository';
import type { FuelTransactionViewRepository, FuelViewRecord } from '../persistence/fuel-transaction-view.repository';
import type { FuelTransactionWriter } from './fuel-transaction-writer';
import { FuelTransactionService } from './fuel-transaction.service';

/**
 * ★ `cost.import` opens fills, not ledgers. The lorry ledger holds only fuel
 * today (0034's CHECK), so the database cannot produce a non-fuel row to test
 * against; this pins the rule for the day it gains a second heading.
 */
describe('FuelTransactionService — the fuel views', () => {
  const record = (over: Partial<FuelViewRecord>): FuelViewRecord =>
    ({ fuelTransactionId: null, category: 'fuel', amount: '100.00', ...over }) as FuelViewRecord;

  const serviceReading = (found: FuelViewRecord | null) => {
    const views = { ofVehicleCost: jest.fn().mockResolvedValue(found), ofTripCost: jest.fn().mockResolvedValue(found) };
    const evidence = { listByTransaction: jest.fn().mockResolvedValue([]) };
    return new FuelTransactionService(
      {} as Database,
      {} as FuelTransactionRepository,
      views as unknown as FuelTransactionViewRepository,
      evidence as unknown as FuelEvidenceRepository,
      {} as FuelTransactionWriter,
    );
  };
  const viewOn = (ledger: 'vehicle' | 'trip', found: FuelViewRecord | null) =>
    ledger === 'vehicle' ? serviceReading(found).viewOfVehicleCost('v', 'c') : serviceReading(found).viewOfTripCost('t', 'c');

  it.each(['vehicle', 'trip'] as const)('★ answers 404 for a %s cost that is not fuel and was never wrapped', async (ledger) => {
    await expect(viewOn(ledger, record({ category: 'repair' }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['vehicle', 'trip'] as const)('answers 404 for a %s cost that does not exist', async (ledger) => {
    await expect(viewOn(ledger, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['vehicle', 'trip'] as const)('reads a %s fuel cost, and a wrapped one later re-headed', async (ledger) => {
    await expect(viewOn(ledger, record({}))).resolves.toMatchObject({ amount: '100.00', evidence: [] });
    await expect(viewOn(ledger, record({ fuelTransactionId: 'f', category: 'toll' }))).resolves.toMatchObject({
      fuelTransactionId: 'f',
    });
  });

  it('never leaks the internal category into the view', async () => {
    expect(await viewOn('vehicle', record({}))).not.toHaveProperty('category');
  });
});
