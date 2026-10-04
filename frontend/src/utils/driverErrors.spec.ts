import { describe, expect, it } from 'vitest';
import { driverErrorKey, needsDailyFuelCheck } from './driverErrors';
import { ApiError } from './errors';

describe('driverErrors — the lorry’s daily fuel check', () => {
  const held = new ApiError(422, 'VALIDATION_FAILED', 'x', { dailyFuelCheck: 'FUEL_DECLARATION_REQUIRED' });

  it('★ recognises the held first milestone, and nothing else', () => {
    expect(needsDailyFuelCheck(held)).toBe(true);
    expect(needsDailyFuelCheck(new ApiError(422, 'VALIDATION_FAILED', 'x', { location: 'LOCATION_STALE' }))).toBe(false);
    expect(needsDailyFuelCheck(new ApiError(409, 'CONFLICT', 'x'))).toBe(false);
    expect(needsDailyFuelCheck(new Error('x'))).toBe(false);
  });

  it('words the refused `fuel` trip line for a driver', () => {
    const refused = new ApiError(422, 'VALIDATION_FAILED', 'x', { category: 'FUEL_DECLARED_ON_VEHICLE' });
    expect(driverErrorKey(refused)).toBe('driverErrFuelOnVehicle');
  });
});
