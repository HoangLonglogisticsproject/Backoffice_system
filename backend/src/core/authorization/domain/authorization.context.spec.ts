import { AuthorizationContext, can, grantedPermissions, roleOf } from './authorization.context';
import { PERMISSIONS, PermissionKey } from './permission';

/**
 * The rule itself, with nothing around it.
 *
 * `can()` is a pure function, so this file needs no database, no Nest and no
 * request — which is exactly why the rule was written as a pure function. If a
 * decision here needs mocking to test, the decision has drifted somewhere it
 * does not belong.
 */

const A = 'dept-a';
const B = 'dept-b';

const context = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
  userId: 'user-1',
  global: false,
  headOf: [],
  memberOf: [],
  mustChangeSecret: false,
  ...over,
});

const superadmin = () => context({ global: true });
const headOfA = () => context({ headOf: [A], memberOf: [A] });
const memberOfA = () => context({ memberOf: [A] });

/**
 * Permissions whose requirement is 'any' — held by every authenticated caller,
 * with or without a department. Listed once here so the fail-closed suites can
 * say "everything EXCEPT these" and stay true when a key is added.
 */
const UNRESTRICTED: PermissionKey[] = ['trip.read', 'trip.create'];
const RESTRICTED = PERMISSIONS.filter((p) => !UNRESTRICTED.includes(p));

describe('can()', () => {
  describe('SUPERADMIN', () => {
    it('holds every permission, in every department', () => {
      for (const permission of PERMISSIONS) {
        expect(can(superadmin(), permission, { departmentId: A })).toBe(true);
        expect(can(superadmin(), permission, { departmentId: B })).toBe(true);
      }
    });

    it('holds global permissions with no target at all', () => {
      expect(can(superadmin(), 'user.write')).toBe(true);
      expect(can(superadmin(), 'role.assign')).toBe(true);
    });

    it('covers a department it has never seen — GLOBAL means global', () => {
      expect(can(superadmin(), 'unit.read', { departmentId: 'brand-new' })).toBe(true);
    });
  });

  describe('DEPARTMENT_HEAD', () => {
    it('reads its own unit and the people in it', () => {
      expect(can(headOfA(), 'unit.read', { departmentId: A })).toBe(true);
      expect(can(headOfA(), 'unit.member.read', { departmentId: A })).toBe(true);
    });

    it('is denied everything about another unit', () => {
      expect(can(headOfA(), 'unit.read', { departmentId: B })).toBe(false);
      expect(can(headOfA(), 'unit.member.read', { departmentId: B })).toBe(false);
    });

    it('cannot mutate membership, assign roles, or write users — anywhere', () => {
      for (const permission of [
        'unit.member.write',
        'unit.write',
        'role.assign',
        'user.write',
      ] as PermissionKey[]) {
        expect(can(headOfA(), permission, { departmentId: A })).toBe(false);
        expect(can(headOfA(), permission)).toBe(false);
      }
    });
  });

  describe('MEMBER', () => {
    it('reads only its own unit', () => {
      expect(can(memberOfA(), 'unit.read', { departmentId: A })).toBe(true);
      expect(can(memberOfA(), 'unit.read', { departmentId: B })).toBe(false);
    });

    it('cannot see who else is in its unit — the decided default', () => {
      expect(can(memberOfA(), 'unit.member.read', { departmentId: A })).toBe(false);
    });

    it('holds no administrative permission', () => {
      for (const permission of [
        'unit.write',
        'unit.member.write',
        'role.assign',
        'user.write',
        'trip.write',
      ] as PermissionKey[]) {
        expect(can(memberOfA(), permission, { departmentId: A })).toBe(false);
      }
    });
  });

  describe("'any' permissions — the trip schedule", () => {
    it('lets every authenticated caller read and add rows, with no target at all', () => {
      // No `{ departmentId }` argument: that is the point. The trip schedule
      // belongs to no department, so there is nothing to scope it to.
      for (const caller of [memberOfA(), headOfA(), superadmin(), context()]) {
        expect(can(caller, 'trip.read')).toBe(true);
        expect(can(caller, 'trip.create')).toBe(true);
      }
    });

    it('is unaffected by which department is named, when one is named anyway', () => {
      expect(can(memberOfA(), 'trip.read', { departmentId: B })).toBe(true);
    });

    it('★ lets a head correct a row, and still refuses an ordinary member', () => {
      // 'head-anywhere'. Correcting a row changes what a past trip appears to
      // say, so it stays administration — but administration the shift senior
      // performs, rather than one that waits for a GLOBAL administrator.
      expect(can(memberOfA(), 'trip.write')).toBe(false);
      expect(can(headOfA(), 'trip.write')).toBe(true);
      expect(can(superadmin(), 'trip.write')).toBe(true);
    });

    it('★ asks a head for no department, because the trip schedule has none', () => {
      // The trap this tier exists to avoid: were `trip.write` marked 'head',
      // `can()` would fail closed here — no target — while grantedPermissions
      // listed it anyway, so the client would draw a button the server refuses.
      expect(can(headOfA(), 'trip.write')).toBe(true);
      // Naming a department the caller does NOT head changes nothing either:
      // the requirement is about the caller's seniority, not about this target.
      expect(can(headOfA(), 'trip.write', { departmentId: B })).toBe(true);
      expect(grantedPermissions(headOfA())).toContain('trip.write');
    });

    it('refuses a head whose only assignment is a membership', () => {
      expect(can(context({ memberOf: [A, B] }), 'trip.write')).toBe(false);
    });

    it('is refused while a temporary credential is unchanged — the gate runs first', () => {
      const gated = context({ memberOf: [A], mustChangeSecret: true });
      expect(can(gated, 'trip.read')).toBe(false);
      expect(can(gated, 'trip.create')).toBe(false);
    });
  });

  describe('fail-closed properties', () => {
    it('denies a scoped permission asked without a target', () => {
      // A caller bug, and answering "true" to it would grant every department
      // at once — the most expensive possible default.
      expect(can(headOfA(), 'unit.member.read')).toBe(false);
      expect(can(memberOfA(), 'unit.read')).toBe(false);
    });

    it('denies every RESTRICTED permission to a context with no relations at all', () => {
      for (const permission of RESTRICTED) {
        expect(can(context(), permission, { departmentId: A })).toBe(false);
      }
    });

    it('denies EVERYTHING while a temporary credential is unchanged — even to a SuperAdmin', () => {
      const gated = context({ global: true, mustChangeSecret: true });
      for (const permission of PERMISSIONS) {
        expect(can(gated, permission, { departmentId: A })).toBe(false);
      }
    });

    it('is not fooled by a department id that merely looks similar', () => {
      expect(can(headOfA(), 'unit.read', { departmentId: `${A} ` })).toBe(false);
      expect(can(headOfA(), 'unit.read', { departmentId: A.toUpperCase() })).toBe(false);
    });
  });
});

describe('roleOf()', () => {
  it('derives the three labels the frontend union already knows', () => {
    expect(roleOf(superadmin())).toBe('SUPERADMIN');
    expect(roleOf(headOfA())).toBe('DEPARTMENT_HEAD');
    expect(roleOf(memberOfA())).toBe('MEMBER');
    expect(roleOf(context())).toBe('MEMBER');
  });

  it('prefers global authority over a head assignment held at the same time', () => {
    expect(roleOf(context({ global: true, headOf: [A], memberOf: [A] }))).toBe('SUPERADMIN');
  });
});

/**
 * ★ THE MONEY PERMISSIONS, VERIFIED PER CALLER SHAPE.
 *
 * The requirement on record is that price visibility is RESTRICTED. `cost.*` is
 * marked 'global', which is the most restrictive tier this model has — and
 * 'global' is satisfied by exactly one thing: an active SUPERADMIN assignment.
 *
 * ⚠ SO IT IS NOT "GRANTED TO NOBODY". A SuperAdmin reaches cost automatically,
 * because `can()` short-circuits on `global` before it ever reads the
 * requirement table. That is the deliberate meaning of GLOBAL here ("full
 * authority, everywhere"), and it is what makes SuperAdmin able to grant the
 * capability onward later — but it is worth stating out loud rather than
 * discovering.
 */
describe('★ cost.* is refused to everybody except a global administrator', () => {
  const MONEY = ['cost.read', 'cost.create', 'cost.void'] as const;

  it.each(MONEY)('refuses %s to somebody in no department at all', (permission) => {
    expect(can(context(), permission)).toBe(false);
  });

  it.each(MONEY)('refuses %s to an ordinary member', (permission) => {
    expect(can(memberOfA(), permission)).toBe(false);
  });

  it.each(MONEY)('★ refuses %s to a DEPARTMENT HEAD', (permission) => {
    // The tier that lets a head correct the board ('head-anywhere') is
    // deliberately NOT the tier that shows them the company's cost base.
    expect(can(headOfA(), permission)).toBe(false);
  });

  it.each(MONEY)('refuses %s to a head even when a department is named', (permission) => {
    expect(can(headOfA(), permission, { departmentId: A })).toBe(false);
  });

  it.each(MONEY)('allows %s to a global administrator', (permission) => {
    expect(can(superadmin(), permission)).toBe(true);
  });

  it.each(MONEY)('★ refuses %s while a temporary credential is unchanged', (permission) => {
    // The provisioning gate runs first, so it beats even global.
    expect(can(context({ global: true, mustChangeSecret: true }), permission)).toBe(false);
  });

  it('★ does not even ADVERTISE cost to a head or a member', () => {
    // `grantedPermissions` is what the client renders from. Listing cost here
    // would draw a panel that the server then answers 403 to — and would read
    // to the user as though they had access.
    for (const caller of [context(), memberOfA(), headOfA()]) {
      const granted = grantedPermissions(caller);
      expect(granted).not.toContain('cost.read');
      expect(granted).not.toContain('cost.create');
      expect(granted).not.toContain('cost.void');
    }
  });
});

describe('grantedPermissions()', () => {
  it('lists everything for a SuperAdmin', () => {
    expect(grantedPermissions(superadmin()).sort()).toEqual([...PERMISSIONS].sort());
  });

  it('lists what a head holds somewhere, including correcting the board', () => {
    expect(grantedPermissions(headOfA()).sort()).toEqual([
      // ★ PROPOSING A DRIVER, BUT NOT CREATING ONE. `driver.account.request` is
      // `head-anywhere`, so every head holds it; `user.write` is `global` and
      // stays absent from this list, which is what keeps the proposal separate
      // from the decision.
      'driver.account.request',
      'trip.create',
      'trip.read',
      'trip.write',
      'unit.member.read',
      'unit.read',
    ]);
  });

  it('lists unit.read plus the unrestricted trip permissions for a member', () => {
    expect(grantedPermissions(memberOfA()).sort()).toEqual([
      'trip.create',
      'trip.read',
      'unit.read',
    ]);
  });

  it('lists the unrestricted permissions even for somebody in no department', () => {
    // A person between transfers still reads the trip schedule; nothing about
    // it depends on a membership.
    expect(grantedPermissions(context()).sort()).toEqual(['trip.create', 'trip.read']);
  });

  it('lists nothing while a temporary credential is unchanged', () => {
    expect(grantedPermissions(context({ global: true, mustChangeSecret: true }))).toEqual([]);
  });
});
