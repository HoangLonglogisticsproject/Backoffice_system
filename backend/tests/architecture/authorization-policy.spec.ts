import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PERMISSION_REQUIREMENT,
  PERMISSIONS,
} from '../../src/core/authorization/domain/permission';
import { DEPARTMENT_FUNCTIONS } from '../../src/core/organization/domain/department.entity';

/**
 * The permission table, held to the business rules it encodes (0032).
 *
 * ★ WHY A TEST AND NOT A COMMENT. `orFunction` is one line in a table, and a
 * table is edited by adding a word to a line. The day somebody adds
 * `orFunction: ['dispatch']` to `trip.complete.review` because "dispatch
 * should be able to close their own trips", nothing in the type checker
 * objects, the unit tests for `can()` still pass, and the SuperAdmin stops
 * being the final reviewer. This file is what objects.
 */
describe('★ trip.complete.review is the SuperAdmin’s, and nobody’s by function', () => {
  it('is global-only', () => {
    expect(PERMISSION_REQUIREMENT['trip.complete.review'].tier).toBe('global');
  });

  it('★ names no department function — dispatch is not its own final reviewer', () => {
    expect(PERMISSION_REQUIREMENT['trip.complete.review'].orFunction).toBeUndefined();
  });

  it('is decided by the completion controller alone, with no second route', async () => {
    // Belt over braces: the key is read by exactly one controller, so a
    // second route granting the decision to somebody else cannot appear
    // without this failing.
    const api = join(__dirname, '..', '..', 'src', 'capabilities', 'trip-schedule', 'api');
    const completion = await readFile(join(api, 'trip-completion.controller.ts'), 'utf8');
    const schedule = await readFile(join(api, 'trip-schedule.controller.ts'), 'utf8');

    expect(completion).toContain("@RequirePermission('trip.complete.review')");
    expect(schedule).not.toContain("'trip.complete.review'");
  });
});

describe('the money and the org chart stay global', () => {
  it.each(['cost.read', 'cost.create', 'cost.void', 'unit.write', 'unit.member.write', 'role.assign', 'user.write'] as const)(
    '%s is global-only with no function grant',
    (permission) => {
      expect(PERMISSION_REQUIREMENT[permission]).toEqual({ tier: 'global' });
    },
  );
});

describe('★ the two price keys agree with each other', () => {
  it('everybody who may WRITE a price may READ it back', () => {
    // A holder who could type a figure and not see it saved would have a form
    // that refuses to show them what they just did.
    const write = PERMISSION_REQUIREMENT['trip.price.write'];
    const read = PERMISSION_REQUIREMENT['trip.price.read'];

    for (const fn of write.orFunction ?? []) expect(read.orFunction).toContain(fn);
    // And the write tier is no looser than the read tier.
    expect(write.tier).toBe('global');
  });

  it('★ the prices are accounting’s, read and write — and nobody who books sees them (DL-111)', () => {
    expect(PERMISSION_REQUIREMENT['trip.price.read']).toEqual({ tier: 'global', orFunction: ['accounting'] });
    expect(PERMISSION_REQUIREMENT['trip.price.write']).toEqual({ tier: 'global', orFunction: ['accounting'] });
    for (const fn of ['sales', 'dispatch', 'customer_service'] as const) {
      expect(PERMISSION_REQUIREMENT['trip.price.read'].orFunction).not.toContain(fn);
      expect(PERMISSION_REQUIREMENT['trip.price.write'].orFunction).not.toContain(fn);
    }
  });

  it('dispatch dispatches lorries and proposes drivers — the same function, both keys', () => {
    expect(PERMISSION_REQUIREMENT['dispatch.write']).toEqual({ tier: 'global', orFunction: ['dispatch'] });
    expect(PERMISSION_REQUIREMENT['driver.account.request']).toEqual({ tier: 'global', orFunction: ['dispatch'] });
  });
});

describe('★ booking a trip belongs to the four functions, and to no seniority', () => {
  const BOOKING = ['sales', 'accounting', 'dispatch', 'customer_service'];

  // Booking, reading the board, filing a customer or a place: the same four
  // functions, never head-anywhere, never member, never "any".
  it.each(['trip.create', 'trip.read', 'customer.create', 'location.create'] as const)(
    '★ %s is global or one of sales / accounting / dispatch / customer service — no seniority reads or books',
    (key) => {
      expect(PERMISSION_REQUIREMENT[key]).toEqual({ tier: 'global', orFunction: BOOKING });
    },
  );

  it('★ the fleet is dispatch’s: vehicle.create names dispatch and nobody who merely books (DL-112)', () => {
    expect(PERMISSION_REQUIREMENT['vehicle.create']).toEqual({ tier: 'global', orFunction: ['dispatch'] });
  });

  it('★ customer service corrects nothing — trip.write did not widen with the fourth function', () => {
    expect(PERMISSION_REQUIREMENT['trip.write'].withinFunction).not.toContain('customer_service');
  });

  it('★ trip.write is a head WITHIN a booking function — a head elsewhere corrects nothing', () => {
    expect(PERMISSION_REQUIREMENT['trip.write']).toEqual({
      tier: 'head-anywhere',
      withinFunction: ['sales', 'accounting', 'dispatch'],
    });
  });

  it('no permission is left at tier "any" — every trip read is function-gated', () => {
    for (const key of PERMISSIONS) {
      expect([key, PERMISSION_REQUIREMENT[key].tier]).not.toEqual([key, 'any']);
    }
  });
});

describe('every function named in the table exists', () => {
  it('names only functions the department column can hold', () => {
    for (const key of PERMISSIONS) {
      for (const fn of PERMISSION_REQUIREMENT[key].orFunction ?? []) {
        expect(DEPARTMENT_FUNCTIONS).toContain(fn);
      }
    }
  });
});
