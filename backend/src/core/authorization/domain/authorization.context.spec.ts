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
      ] as PermissionKey[]) {
        expect(can(memberOfA(), permission, { departmentId: A })).toBe(false);
      }
    });
  });

  describe('fail-closed properties', () => {
    it('denies a scoped permission asked without a target', () => {
      // A caller bug, and answering "true" to it would grant every department
      // at once — the most expensive possible default.
      expect(can(headOfA(), 'unit.member.read')).toBe(false);
      expect(can(memberOfA(), 'unit.read')).toBe(false);
    });

    it('denies everything to a context with no relations at all', () => {
      for (const permission of PERMISSIONS) {
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

describe('grantedPermissions()', () => {
  it('lists everything for a SuperAdmin', () => {
    expect(grantedPermissions(superadmin()).sort()).toEqual([...PERMISSIONS].sort());
  });

  it('lists what a head holds somewhere, and nothing administrative', () => {
    expect(grantedPermissions(headOfA()).sort()).toEqual(['unit.member.read', 'unit.read']);
  });

  it('lists only unit.read for a member', () => {
    expect(grantedPermissions(memberOfA())).toEqual(['unit.read']);
  });

  it('lists nothing while a temporary credential is unchanged', () => {
    expect(grantedPermissions(context({ global: true, mustChangeSecret: true }))).toEqual([]);
  });
});
