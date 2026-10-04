import { forDriver, fuelDeclaredOnVehicle, isRecordableLiters, needsDailyFuelCheck } from './vehicle-fuel';

describe('vehicle fuel — the policy, said once', () => {
  const managed = { dailyFuelCheckRequired: true };
  const unmanaged = { dailyFuelCheckRequired: false };

  it('reads the flag and nothing else; no lorry is no check', () => {
    expect(needsDailyFuelCheck(managed)).toBe(true);
    expect(needsDailyFuelCheck(unmanaged)).toBe(false);
    expect(needsDailyFuelCheck(null)).toBe(false);
  });

  it('★ puts fuel on the lorry for live work only — a recorded run keeps its trip line', () => {
    expect(fuelDeclaredOnVehicle('operational', managed)).toBe(true);
    expect(fuelDeclaredOnVehicle('historical', managed)).toBe(false);
    expect(fuelDeclaredOnVehicle(null, managed)).toBe(false);
    expect(fuelDeclaredOnVehicle('operational', unmanaged)).toBe(false);
  });

  it('accepts liters NUMERIC(10,2) holds exactly, and more than zero', () => {
    expect(['45', '45.5', '45.50', '0.01', '99999999.99'].every(isRecordableLiters)).toBe(true);
    expect(['0', '0.00', '-1', '45.555', '1e3', '', '123456789'].some(isRecordableLiters)).toBe(false);
  });

  it('★ tells a driver the day and the outcome — never whose turn answered', () => {
    const check = {
      vehicleId: 'v',
      businessDate: '2026-10-04',
      outcome: 'no_fuel' as const,
      vehicleCostId: null,
      sourceTripId: 't',
      sourceAssignmentId: 'a',
      clientRequestId: 'their-key',
      createdBy: 'someone-else',
      createdAt: new Date(),
    };
    expect(forDriver(check)).toEqual({ businessDate: '2026-10-04', outcome: 'no_fuel' });
  });
});
