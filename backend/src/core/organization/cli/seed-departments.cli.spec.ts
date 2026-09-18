import type { Department } from '../domain/department.entity';
import { DEV_DEPARTMENTS, plan } from './seed-departments.cli';

/**
 * The idempotency rule of the development fixture, without a database: run it
 * twice and the second run changes nothing; run it against a unit somebody
 * declassified and it puts the function back; never anything else.
 */
const unit = (over: Partial<Department> = {}): Department => ({
  id: 'dep-1',
  slug: 'sales',
  name: 'Sales',
  status: 'active',
  function: 'sales',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
});

describe('dev:seed-departments', () => {
  it('names exactly one unit per department function, and nothing else', () => {
    expect(DEV_DEPARTMENTS.map((d) => d.function).sort()).toEqual([
      'accounting',
      'customer_service',
      'dispatch',
      'sales',
    ]);
    expect(new Set(DEV_DEPARTMENTS.map((d) => d.slug)).size).toBe(4);
  });

  it('creates a missing unit, leaves a matching one alone, and brings a drifted one back', () => {
    const wanted = DEV_DEPARTMENTS[0]!;
    expect(plan(null, wanted)).toBe('create');
    expect(plan(unit(), wanted)).toBe('keep');
    expect(plan(unit({ function: null }), wanted)).toBe('update');
    // The fixture owns its rows' names too — business terminology, not a
    // local edit — so a stale name is corrected on the next run.
    expect(plan(unit({ name: 'Kinh doanh' }), wanted)).toBe('update');
  });

  it('uses the business terms: Sales, Kế toán, Điều phối, Customer Service', () => {
    expect(DEV_DEPARTMENTS.map((d) => [d.slug, d.name])).toEqual([
      ['sales', 'Sales'],
      ['accounting', 'Kế toán'],
      ['dispatch', 'Điều phối'],
      ['customer-service', 'Customer Service'],
    ]);
  });
});
