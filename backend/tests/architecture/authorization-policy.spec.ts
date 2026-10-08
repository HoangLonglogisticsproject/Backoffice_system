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

/**
 * ★ THE EXPORT'S COST KEY IS ACCOUNTING'S AS WELL — AND ONLY THE EXPORT'S (DL-117).
 *
 * The CEO decision lets accounting take the cost breakdown out in Excel while
 * the board's cost column and the cost dialog stay the SuperAdmin's. Both
 * halves are one word in a table apart: `orFunction` on `cost.read` would open
 * all three surfaces, and `cost.export` read by a second route would open the
 * board. This block is what objects to either.
 */
describe('★ cost.export is the SuperAdmin’s and accounting’s — for the export alone', () => {
  it('is global or the accounting function, and nobody else', () => {
    expect(PERMISSION_REQUIREMENT['cost.export']).toEqual({ tier: 'global', orFunction: ['accounting'] });
  });

  it('is read by the export route alone — the board route still asks cost.read', async () => {
    const api = join(__dirname, '..', '..', 'src', 'capabilities', 'trip-schedule', 'api');
    const schedule = await readFile(join(api, 'trip-schedule.controller.ts'), 'utf8');
    const exportRoute = schedule.slice(schedule.indexOf("@Get('trip-schedules/export')"));
    const exportHandler = exportRoute.slice(0, exportRoute.indexOf('@Get(', 1));

    expect(exportHandler).toContain('canExportTripCosts(');
    expect(schedule.split('canExportTripCosts(').length - 1).toBe(1);
    expect(schedule).toContain('canSeeTripCosts(authorizationOf(request))');
  });
});

/**
 * ★ FUEL EVIDENCE IS ACCOUNTING'S TO BACKFILL — AND THAT OPENS NO LEDGER (0037).
 *
 * `cost.import` lets the office that holds the receipts attach them to a
 * fill. It is pinned to the two fuel controllers so it cannot quietly become
 * the key a ledger route asks, and the void that corrects evidence stays
 * `cost.void` — the SuperAdmin's.
 */
describe('★ cost.import is the SuperAdmin’s and accounting’s — for fuel evidence alone', () => {
  const api = join(__dirname, '..', '..', 'src', 'capabilities', 'trip-schedule', 'api');

  it('is global or the accounting function, and nobody else', () => {
    expect(PERMISSION_REQUIREMENT['cost.import']).toEqual({ tier: 'global', orFunction: ['accounting'] });
  });

  it('is asked by the fuel transaction and fuel evidence routes, and the ledger read still asks cost.read', async () => {
    const source = (file: string) => readFile(join(api, file), 'utf8');
    const transactions = await source('fuel-transaction.controller.ts');
    const evidence = await source('fuel-evidence.controller.ts');
    const ledger = await source('vehicle-cost.controller.ts');
    expect(transactions.split("@RequirePermission('cost.import')").length - 1).toBe(5);
    expect(evidence.split("@RequirePermission('cost.import')").length - 1).toBe(4);
    expect(evidence.split("@RequirePermission('cost.void')").length - 1).toBe(1);
    expect(ledger).toContain("@RequirePermission('cost.read')");
    expect(ledger).not.toContain('cost.import');
  });
});

describe('★ cost.import attaches to costs that exist — it never creates one (PR-2)', () => {
  it('opens exactly the search, and a read and a write on ONE named cost per ledger — no create route', async () => {
    const api = join(__dirname, '..', '..', 'src', 'capabilities', 'trip-schedule', 'api');
    const controller = await readFile(join(api, 'fuel-transaction.controller.ts'), 'utf8');
    const routes = [...controller.matchAll(/@(Get|Post|Patch|Put|Delete)\('([^']+)'\)/g)].map(([, verb, path]) => `${verb} ${path}`);
    expect(routes).toEqual([
      'Get trip-vehicles/:vehicleId/fuel-matches',
      'Get trip-vehicles/:vehicleId/costs/:costId/fuel-transaction',
      'Post trip-vehicles/:vehicleId/costs/:costId/fuel-transaction',
      'Get trip-schedules/:tripId/costs/:costId/fuel-transaction',
      'Post trip-schedules/:tripId/costs/:costId/fuel-transaction',
    ]);
    // The one route that creates a trip cost stays the SuperAdmin's `cost.create`.
    const costs = await readFile(join(api, 'trip-cost.controller.ts'), 'utf8');
    expect(costs).toMatch(/@Post\('trip-schedules\/:tripId\/costs'\)\s*@UseGuards\([^)]*\)\s*@RequirePermission\('cost\.create'\)/);
    expect(costs).not.toContain('cost.import');
  });
});

describe('★ drivers have their own fuel door; Accounting keeps cost.import (0038)', () => {
  const api = join(__dirname, '..', '..', 'src', 'capabilities', 'trip-schedule', 'api');
  const guardsOf = (source: string) => [...source.matchAll(/@UseGuards\(([^)]*)\)/g)].map(([, guards]) => guards ?? '');

  it('never hands a driver cost.import — every driver fuel route is a driver account’s, and asks no permission key', async () => {
    const driver = await readFile(join(api, 'driver-fuel.controller.ts'), 'utf8');
    expect(driver).not.toContain('RequirePermission');
    expect(driver).not.toMatch(/['"]cost\./); // no permission key in code — the doc comment may say what it is not
    const guards = guardsOf(driver);
    expect(guards.length).toBeGreaterThanOrEqual(7);
    for (const route of guards) expect(route).toMatch(/AuthGuard.*DriverOnlyGuard.*ProvisionedAccountGuard/);
  });

  it('keeps every review decision Accounting’s: cost.import, an office account, on every route', async () => {
    const review = await readFile(join(api, 'fuel-review.controller.ts'), 'utf8');
    const guards = guardsOf(review);
    expect(guards).toHaveLength(3);
    for (const route of guards) expect(route).toMatch(/BackofficeOnlyGuard.*PermissionGuard/);
    expect(review.split("@RequirePermission('cost.import')").length - 1).toBe(3);
  });
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
