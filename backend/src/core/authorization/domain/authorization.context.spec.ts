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
  functions: [],
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
const UNRESTRICTED: PermissionKey[] = [];
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

  describe('function-granted permissions — the trip schedule', () => {
    // No `{ departmentId }` argument: the trip schedule belongs to no
    // department. What decides is the FUNCTION of the caller's own unit —
    // seniority elsewhere buys nothing, and a head of an ordinary department
    // neither reads the board nor books on it (0032).
    it.each(['trip.read', 'trip.create'] as const)(
      '★ grants %s to the three booking functions and the superadmin — and to nobody else',
      (key) => {
        for (const caller of [memberOfA(), headOfA(), context()]) {
          expect(can(caller, key)).toBe(false);
        }
        for (const fn of ['sales', 'accounting', 'dispatch'] as const) {
          expect(can(context({ memberOf: [A], functions: [fn] }), key)).toBe(true);
          expect(can(context({ headOf: [A], memberOf: [A], functions: [fn] }), key)).toBe(true);
        }
        expect(can(superadmin(), key)).toBe(true);
      },
    );

    it('is unaffected by which department is named, when one is named anyway', () => {
      const dispatcher = context({ memberOf: [A], functions: ['dispatch'] });
      expect(can(dispatcher, 'trip.read', { departmentId: B })).toBe(true);
      expect(can(memberOfA(), 'trip.read', { departmentId: A })).toBe(false);
    });

    it('★ lets a head WITHIN a booking function correct a row, and nobody else', () => {
      // 'head-anywhere' AND `withinFunction`. Correcting a row is still
      // seniority — a member of dispatch holds none of it — but seniority in
      // HR or Marketing is seniority over a board that unit may not even read.
      const salesHead = context({ headOf: [A], memberOf: [A], functions: ['sales'] });
      const salesMember = context({ memberOf: [A], functions: ['sales'] });
      expect(can(salesHead, 'trip.write')).toBe(true);
      expect(can(salesMember, 'trip.write')).toBe(false);
      expect(can(headOfA(), 'trip.write')).toBe(false);
      expect(can(memberOfA(), 'trip.write')).toBe(false);
      expect(can(superadmin(), 'trip.write')).toBe(true);
    });

    it('★ asks a head for no department, because the trip schedule has none', () => {
      // The trap this tier exists to avoid: were `trip.write` marked 'head',
      // `can()` would fail closed here — no target — while grantedPermissions
      // listed it anyway, so the client would draw a button the server refuses.
      const dispatchHead = context({ headOf: [A], memberOf: [A], functions: ['dispatch'] });
      expect(can(dispatchHead, 'trip.write')).toBe(true);
      // Naming a department the caller does NOT head changes nothing either:
      // the requirement is about the caller's seniority, not about this target.
      expect(can(dispatchHead, 'trip.write', { departmentId: B })).toBe(true);
      expect(grantedPermissions(dispatchHead)).toContain('trip.write');
      // And the head of an ordinary unit is not advertised it either.
      expect(grantedPermissions(headOfA())).not.toContain('trip.write');
    });

    it('refuses a head whose only assignment is a membership', () => {
      expect(can(context({ memberOf: [A, B], functions: ['sales'] }), 'trip.write')).toBe(false);
    });

    /**
     * ★ THE TWO PRICES ON A TRIP ROW, WHICH ARE NOT 'any' LIKE THE ROW AROUND
     * THEM.
     *
     * 0024 put the quoted price on `trip_schedules` and accepted in writing
     * that `trip.read` = 'any' meant every finished account could read it.
     * 0026 takes that back for both figures. The board is still company-wide;
     * what the run is sold and bought for is not.
     */
    it('★ shows a trip price to the booking functions and the superadmin — never to a head elsewhere', () => {
      expect(can(memberOfA(), 'trip.price.read')).toBe(false);
      expect(can(context(), 'trip.price.read')).toBe(false);
      // The head of an ordinary unit used to see them; the 2026-09-17
      // clarification closed that. Seniority is not price visibility.
      expect(can(headOfA(), 'trip.price.read')).toBe(false);
      expect(can(context({ memberOf: [A], functions: ['sales'] }), 'trip.price.read')).toBe(true);
      expect(can(superadmin(), 'trip.price.read')).toBe(true);
    });

    it('★ asks for no department either — a trip belongs to none', () => {
      const accountant = context({ memberOf: [A], functions: ['accounting'] });
      expect(can(accountant, 'trip.price.read', { departmentId: B })).toBe(true);
      expect(grantedPermissions(accountant)).toContain('trip.price.read');
      expect(grantedPermissions(headOfA())).not.toContain('trip.price.read');
      expect(grantedPermissions(memberOfA())).not.toContain('trip.price.read');
    });

    it('is refused while a temporary credential is unchanged, like everything else', () => {
      expect(
        can(context({ memberOf: [A], functions: ['sales'], mustChangeSecret: true }), 'trip.price.read'),
      ).toBe(false);
    });

    it('is refused while a temporary credential is unchanged — the gate runs first', () => {
      const gated = context({ memberOf: [A], functions: ['sales'], mustChangeSecret: true });
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
      // ★ NOTHING OF THE BOARD: not `trip.read`, not `trip.price.read`, not
      // `trip.write`. A head of an ordinary unit sees no trip and corrects
      // none (business clarification 2026-09-17).
      'unit.member.read',
      'unit.read',
    ]);
  });

  it('lists only unit.read for a member of an ordinary unit', () => {
    expect(grantedPermissions(memberOfA()).sort()).toEqual(['unit.read']);
  });

  it('lists nothing for somebody in no department', () => {
    // A person between transfers holds nothing until they sit somewhere; the
    // board is a function's, and no function is a membership away.
    expect(grantedPermissions(context())).toEqual([]);
  });

  it('★ lists the board, and correcting it, for a head of a booking function', () => {
    expect(grantedPermissions(context({ headOf: [A], memberOf: [A], functions: ['sales'] })).sort()).toEqual([
      'driver.account.request',
      'trip.create',
      'trip.price.read',
      'trip.read',
      'trip.write',
      'unit.member.read',
      'unit.read',
    ]);
  });

  it('lists nothing while a temporary credential is unchanged', () => {
    expect(grantedPermissions(context({ global: true, mustChangeSecret: true }))).toEqual([]);
  });
});

/**
 * ★ ROLE AND FUNCTION ARE TWO AXES (business rule 2026-09-17). Booking a trip,
 * reading the board and reading its prices are the FUNCTION's; head-or-member
 * never enters the decision. One table, every cell, so that a future edit that
 * sneaks a `head` or `member` tier back onto one of these keys fails here by
 * name rather than in a corner of the HTTP suite.
 */
describe('★ head and member of one function hold the same trip.create / trip.read / trip.price.read', () => {
  const KEYS = ['trip.create', 'trip.read', 'trip.price.read'] as const;

  it.each(['sales', 'accounting', 'dispatch'] as const)('%s: head === member, and both are granted', (fn) => {
    const member = context({ memberOf: [A], functions: [fn] });
    const head = context({ headOf: [A], memberOf: [A], functions: [fn] });
    for (const key of KEYS) {
      expect(can(member, key)).toBe(true);
      expect(can(head, key)).toBe(can(member, key));
    }
  });

  it('any other unit: head === member, and both are refused', () => {
    for (const key of KEYS) {
      expect(can(memberOfA(), key)).toBe(false);
      expect(can(headOfA(), key)).toBe(can(memberOfA(), key));
    }
  });

  it('the superadmin is always granted', () => {
    for (const key of KEYS) expect(can(superadmin(), key)).toBe(true);
  });
});

/**
 * ★ WHAT A DEPARTMENT IS FOR, AS A GRANT (0032).
 *
 * `orFunction` is the one addition to the model: a permission may name the
 * department functions that hold it, and `can()` grants it to a member of such
 * a department whatever their tier. These cases pin the four properties that
 * make that safe — it is an OR and not a tier, it needs no target, an empty
 * function list grants nothing, and neither of the two gates above it moved.
 */
describe('★ orFunction — permissions a department FUNCTION grants', () => {
  const dispatcher = () => context({ memberOf: [A], functions: ['dispatch'] });
  const dispatchHead = () => context({ headOf: [A], memberOf: [A], functions: ['dispatch'] });
  const accountant = () => context({ memberOf: [B], functions: ['accounting'] });
  const accountingHead = () => context({ headOf: [B], memberOf: [B], functions: ['accounting'] });
  const salesperson = () => context({ memberOf: [B], functions: ['sales'] });
  const salesHead = () => context({ headOf: [B], memberOf: [B], functions: ['sales'] });

  it('grants dispatch to a member whose department is the dispatch unit', () => {
    expect(can(dispatcher(), 'dispatch.write')).toBe(true);
    expect(can(dispatcher(), 'trip.price.write')).toBe(true);
    expect(can(dispatcher(), 'trip.price.read')).toBe(true);
  });

  it('★ grants it as an OR — the head of the dispatch unit holds it, and heads elsewhere do not', () => {
    expect(can(dispatchHead(), 'dispatch.write')).toBe(true);
    expect(can(salesHead(), 'dispatch.write')).toBe(false);
    expect(can(accountingHead(), 'dispatch.write')).toBe(false);
  });

  it('★ refuses everything function-granted to a context with no functions at all', () => {
    // A driver: no membership, so nothing to read a function off. This is the
    // whole reason drivers need no special case anywhere in the model.
    for (const permission of ['dispatch.write', 'trip.price.write', 'trip.price.read'] as const) {
      expect(can(context(), permission)).toBe(false);
      expect(can(memberOfA(), permission)).toBe(false);
    }
  });

  it('refuses a permission whose function list names a DIFFERENT function', () => {
    expect(can(salesperson(), 'dispatch.write')).toBe(false);
    expect(can(salesperson(), 'trip.price.write')).toBe(false);
    expect(can(accountant(), 'dispatch.write')).toBe(false);
    expect(can(accountant(), 'trip.price.write')).toBe(false);
  });

  it('★ grants a permission whose function list names the caller’s function among others', () => {
    // `trip.price.read` lists three functions; each one alone is enough.
    expect(can(salesperson(), 'trip.price.read')).toBe(true);
    expect(can(accountant(), 'trip.price.read')).toBe(true);
    expect(can(dispatcher(), 'trip.price.read')).toBe(true);
  });

  it('★ lets accounting READ the prices without letting it WRITE them', () => {
    expect(can(accountant(), 'trip.price.read')).toBe(true);
    expect(can(accountant(), 'trip.price.write')).toBe(false);
    expect(can(accountingHead(), 'trip.price.read')).toBe(true);
    expect(can(accountingHead(), 'trip.price.write')).toBe(false);
  });

  it('★ lets sales READ the prices — member and head alike — and never write them', () => {
    expect(can(salesperson(), 'trip.price.read')).toBe(true);
    expect(can(salesHead(), 'trip.price.read')).toBe(true);
    expect(can(salesperson(), 'trip.price.write')).toBe(false);
    expect(can(salesHead(), 'trip.price.write')).toBe(false);
  });

  it('★ shows the prices to every named function and to nobody with none', () => {
    for (const caller of [salesperson(), salesHead(), accountant(), accountingHead(), dispatcher(), dispatchHead(), superadmin()]) {
      expect(can(caller, 'trip.price.read')).toBe(true);
    }
    // A driver, and a member of an ordinary unit: no function, no head, no price.
    expect(can(context(), 'trip.price.read')).toBe(false);
    expect(can(memberOfA(), 'trip.price.read')).toBe(false);
  });

  it('★ never reaches trip.complete.review by function — dispatch is not its own reviewer', () => {
    for (const caller of [dispatcher(), dispatchHead(), accountant(), accountingHead(), salesperson(), salesHead()]) {
      expect(can(caller, 'trip.complete.review')).toBe(false);
    }
  });

  it('still passes a global administrator, who needs no function', () => {
    expect(can(superadmin(), 'dispatch.write')).toBe(true);
    expect(can(superadmin(), 'trip.price.write')).toBe(true);
    expect(can(superadmin(), 'trip.complete.review')).toBe(true);
  });

  it('★ does not make a function-holder global — a dispatcher holds none of the global keys', () => {
    for (const permission of ['user.write', 'role.assign', 'unit.write', 'cost.read', 'trip.complete.review'] as const) {
      expect(can(dispatcher(), permission)).toBe(false);
      expect(can(dispatchHead(), permission)).toBe(false);
    }
  });

  it('★ is refused while a temporary credential is unchanged — the gate runs before the function is read', () => {
    const gated = context({ memberOf: [A], functions: ['dispatch'], mustChangeSecret: true });
    expect(can(gated, 'dispatch.write')).toBe(false);
    expect(can(gated, 'trip.price.read')).toBe(false);
    expect(grantedPermissions(gated)).toEqual([]);
  });

  it('is unaffected by a target department, like every company-wide permission', () => {
    expect(can(dispatcher(), 'dispatch.write', { departmentId: B })).toBe(true);
    expect(can(salesperson(), 'dispatch.write', { departmentId: A })).toBe(false);
  });

  it('★ withinFunction is an AND: the tier alone is not enough, and the function alone is not enough', () => {
    // `trip.write` = head-anywhere WITHIN sales/accounting/dispatch.
    expect(can(dispatchHead(), 'trip.write')).toBe(true);
    expect(can(salesHead(), 'trip.write')).toBe(true);
    expect(can(accountingHead(), 'trip.write')).toBe(true);
    expect(can(dispatcher(), 'trip.write')).toBe(false);
    expect(can(headOfA(), 'trip.write')).toBe(false);
    expect(can(context({ headOf: [A], memberOf: [A], functions: ['dispatch'], mustChangeSecret: true }), 'trip.write')).toBe(false);
  });

  it('★ advertises exactly what it grants, so the client draws what the server accepts', () => {
    expect(grantedPermissions(dispatcher()).sort()).toEqual([
      'dispatch.write',
      'trip.create',
      'trip.price.read',
      'trip.price.write',
      'trip.read',
      'unit.read',
    ]);
    expect(grantedPermissions(accountant()).sort()).toEqual([
      'trip.create',
      'trip.price.read',
      'trip.read',
      'unit.read',
    ]);
    // A salesperson advertises the price READ and nothing else beyond an
    // ordinary member.
    expect(grantedPermissions(salesperson()).sort()).toEqual([
      'trip.create',
      'trip.price.read',
      'trip.read',
      'unit.read',
    ]);
  });
});
