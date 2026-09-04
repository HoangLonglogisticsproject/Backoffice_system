import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthorizationService } from '../../authorization/application/authorization.service';
import { AuthorizationContext } from '../../authorization/domain/authorization.context';
import {
  HeadOfTargetUserDepartmentGuard,
  PermissionGuard,
} from '../../authorization/api/permission.guard';
import { AuthGuard } from '../../identity/api/auth.guard';
import { CsrfGuard } from '../../identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../identity/api/session.cookie';
import { SessionService } from '../../identity/application/session.service';
import { AccountLifecycleService } from '../application/account-lifecycle.service';
import { AccountProvisioningService } from '../application/account-provisioning.service';
import { UserService } from '../application/user.service';
import { MembershipService } from '../../organization/application/membership.service';
import { UsersController } from './users.controller';

/**
 * Account administration over HTTP.
 *
 * `user.write` has no departmental scope, so only a GLOBAL caller passes the
 * guard. Everything below asserts that from the outside: which status comes
 * back, and whether the service was reached at all.
 */
describe('users HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const A = '11111111-1111-1111-1111-111111111111';
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const TARGET = '44444444-4444-4444-4444-444444444444';

  let app: INestApplication;
  let provisioning: { provision: jest.Mock };
  let lifecycle: { disable: jest.Mock; enable: jest.Mock };
  let users: { requireById: jest.Mock };
  let employment: { listEmployeeHistory: jest.Mock };
  let activeMembership: { departmentId: string } | null;
  let context: AuthorizationContext;

  const asContext = (over: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
    userId: ACTOR,
    global: false,
    headOf: [],
    memberOf: [],
    mustChangeSecret: false,
    ...over,
  });

  beforeEach(async () => {
    context = asContext();
    provisioning = {
      provision: jest.fn().mockResolvedValue({
        user: { id: TARGET, displayName: 'A Person', status: 'active' },
        username: 'a.person',
      }),
    };
    lifecycle = {
      disable: jest.fn().mockResolvedValue({ id: TARGET, status: 'disabled' }),
      enable: jest.fn().mockResolvedValue({ id: TARGET, status: 'active' }),
    };
    users = {
      requireById: jest
        .fn()
        .mockResolvedValue({ id: TARGET, displayName: 'A Person', status: 'active' }),
    };
    employment = { listEmployeeHistory: jest.fn().mockResolvedValue([]) };
    // What the guard resolves for the TARGET. Null means "no active membership".
    activeMembership = { departmentId: A };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        Reflector,
        PermissionGuard,
        AuthGuard,
        CsrfGuard,
        { provide: AccountProvisioningService, useValue: provisioning },
        { provide: AccountLifecycleService, useValue: lifecycle },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest
              .fn()
              .mockResolvedValue({ id: ACTOR, displayName: 'Actor', status: 'active' }),
          },
        },
        HeadOfTargetUserDepartmentGuard,
        { provide: UserService, useValue: users },
        { provide: MembershipService, useValue: employment },
        {
          provide: AuthorizationService,
          useValue: {
            loadContext: jest.fn().mockImplementation(async () => context),
            findActiveMembershipOf: jest.fn().mockImplementation(async () => activeMembership),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  const authed = (method: 'get' | 'post' | 'patch', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('X-Requested-With', 'XMLHttpRequest');

  const validBody = {
    displayName: 'A Person',
    email: 'a.person@example.com',
    initialPassword: 'a valid passphrase',
    departmentId: A,
  };

  describe('without authentication', () => {
    it('refuses both routes with 401', async () => {
      const created = await request(app.getHttpServer())
        .post('/users')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send(validBody);
      const disabled = await request(app.getHttpServer())
        .patch(`/users/${TARGET}/status`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ status: 'disabled' });

      expect([created.status, disabled.status]).toEqual([401, 401]);
      expect(created.body.error.code).toBe('UNAUTHORIZED');
      expect(provisioning.provision).not.toHaveBeenCalled();
      expect(lifecycle.disable).not.toHaveBeenCalled();
    });
  });

  describe('a department head', () => {
    beforeEach(() => {
      context = asContext({ headOf: [A], memberOf: [A] });
    });

    it('cannot create an account — not even in the department it leads', async () => {
      await authed('post', '/users').send(validBody).expect(403);
      expect(provisioning.provision).not.toHaveBeenCalled();
    });

    it('cannot disable anybody', async () => {
      await authed('patch', `/users/${TARGET}/status`).send({ status: 'disabled' }).expect(403);
      expect(lifecycle.disable).not.toHaveBeenCalled();
    });
  });

  describe('a plain member', () => {
    beforeEach(() => {
      context = asContext({ memberOf: [A] });
    });

    it('cannot reach either route', async () => {
      const created = await authed('post', '/users').send(validBody);
      const disabled = await authed('patch', `/users/${TARGET}/status`).send({ status: 'disabled' });

      expect([created.status, disabled.status]).toEqual([403, 403]);
      expect(created.body.error.code).toBe('FORBIDDEN');
      expect(provisioning.provision).not.toHaveBeenCalled();
      expect(lifecycle.disable).not.toHaveBeenCalled();
    });
  });

  describe('a SuperAdmin', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('creates an account and gets back no secret', async () => {
      const response = await authed('post', '/users').send(validBody).expect(201);

      expect(response.body).toEqual({
        id: TARGET,
        displayName: 'A Person',
        username: 'a.person',
        status: 'active',
        departmentId: A,
      });
      const serialised = JSON.stringify(response.body).toLowerCase();
      expect(serialised).not.toContain('password');
      expect(serialised).not.toContain('secret');
    });

    it('requires a department — an account with none is forbidden by the model', async () => {
      const { departmentId: _omitted, ...withoutDepartment } = validBody;
      await authed('post', '/users').send(withoutDepartment).expect(422);
      expect(provisioning.provision).not.toHaveBeenCalled();
    });

    it('disables an account', async () => {
      await authed('patch', `/users/${TARGET}/status`).send({ status: 'disabled' }).expect(200);
      expect(lifecycle.disable).toHaveBeenCalledWith({ userId: TARGET, actingUserId: ACTOR });
    });

    /**
     * ★ THIS ROUTE ONLY TAKES SOMEBODY OUT.
     *
     * Putting an account back is `PATCH /driver-accounts/:userId/status`, on the
     * resource that already means "a driver" — and only a driver can be
     * re-enabled, because an employee's would have to name the department they
     * return to. Accepting `active` here as well would be a second door onto one
     * operation, and the two would drift.
     */
    it('★ refuses to re-enable — that belongs to the driver resource', async () => {
      await authed('patch', `/users/${TARGET}/status`).send({ status: 'active' }).expect(422);

      expect(lifecycle.disable).not.toHaveBeenCalled();
      expect(lifecycle.enable).not.toHaveBeenCalled();
    });

    it('refuses a status that is neither, and reaches no service', async () => {
      await authed('patch', `/users/${TARGET}/status`).send({ status: 'archived' }).expect(422);

      expect(lifecycle.disable).not.toHaveBeenCalled();
    });
  });

  describe('a client that lies in the body', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('cannot name the actor — the session decides who is acting', async () => {
      await authed('patch', `/users/${TARGET}/status`)
        .send({ status: 'disabled', userId: 'someone-else', actingUserId: 'someone-else' })
        .expect(200);

      expect(lifecycle.disable).toHaveBeenCalledWith({ userId: TARGET, actingUserId: ACTOR });
    });

    it('cannot grant a role or a permission while creating an account', async () => {
      await authed('post', '/users')
        .send({ ...validBody, role: 'SUPERADMIN', permissions: ['role.assign'], global: true })
        .expect(201);

      // The extra fields never reach the service: the schema strips them.
      expect(provisioning.provision).toHaveBeenCalledWith({
        displayName: validBody.displayName,
        email: validBody.email,
        departmentId: A,
        initialPassword: validBody.initialPassword,
      });
    });
  });

  describe('a caller whose temporary credential is unchanged', () => {
    beforeEach(() => {
      context = asContext({ global: true, mustChangeSecret: true });
    });

    it('is refused account administration despite holding global authority', async () => {
      await authed('post', '/users').send(validBody).expect(403);
      await authed('patch', `/users/${TARGET}/status`).send({ status: 'disabled' }).expect(403);
      expect(provisioning.provision).not.toHaveBeenCalled();
      expect(lifecycle.disable).not.toHaveBeenCalled();
    });
  });

  /**
   * EMPLOYEE DETAIL - `GET /users/:userId/memberships`.
   *
   * The security property under test is NOT "a head can read their people". It
   * is that a head's reach is decided by the target's ACTIVE membership and by
   * nothing else - so history never opens a door, and a person who has moved on
   * is out of reach even for the head they used to report to.
   */
  describe('employee detail', () => {
    const detail = () => authed('get', `/users/${TARGET}/memberships`);
    const B = '22222222-2222-2222-2222-222222222222';

    it('1. lets a SuperAdmin read any employee, with the full history', async () => {
      context = asContext({ global: true });
      activeMembership = { departmentId: B };
      employment.listEmployeeHistory.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);

      const response = await detail().expect(200);

      expect(response.body.memberships).toHaveLength(2);
      // `undefined` - unfiltered. A global caller sees every period, and the
      // absence of a scope is what says so.
      expect(employment.listEmployeeHistory).toHaveBeenCalledWith(TARGET, undefined);
    });

    it('2. lets a head read somebody currently in the unit they lead', async () => {
      context = asContext({ headOf: [A], memberOf: [A] });
      activeMembership = { departmentId: A };

      await detail().expect(200);

      // SCOPED DISCLOSURE: the history they are shown is narrowed to their own
      // units, so it cannot even name one they have no authority over.
      expect(employment.listEmployeeHistory).toHaveBeenCalledWith(TARGET, [A]);
    });

    it('3. refuses a head whose target currently belongs to another unit', async () => {
      context = asContext({ headOf: [A], memberOf: [A] });
      activeMembership = { departmentId: B };

      await detail().expect(403);

      // Refused BEFORE any history is read - not filtered afterwards.
      expect(employment.listEmployeeHistory).not.toHaveBeenCalled();
      expect(users.requireById).not.toHaveBeenCalled();
    });

    /**
     * THE CORE RULE. The target once belonged to this head's unit and has since
     * moved. `findActiveMembershipOf` returns the CURRENT membership, so the old
     * one is not a key to anything.
     */
    it('4. refuses a head when the shared department is only in the past', async () => {
      context = asContext({ headOf: [A], memberOf: [A] });
      activeMembership = { departmentId: B };

      await detail().expect(403);
      expect(employment.listEmployeeHistory).not.toHaveBeenCalled();
    });

    it('5. refuses a head when the target has no active membership at all', async () => {
      context = asContext({ headOf: [A], memberOf: [A] });
      activeMembership = null;

      await detail().expect(403);
      expect(employment.listEmployeeHistory).not.toHaveBeenCalled();
    });

    it('6. refuses a plain member', async () => {
      context = asContext({ memberOf: [A] });
      activeMembership = { departmentId: A };

      await detail().expect(403);
      expect(employment.listEmployeeHistory).not.toHaveBeenCalled();
    });

    it('7. refuses an unauthenticated caller with 401', async () => {
      const response = await request(app.getHttpServer())
        .get(`/users/${TARGET}/memberships`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(employment.listEmployeeHistory).not.toHaveBeenCalled();
    });

    /** Disabled is not deleted. The person, and their history, remain readable. */
    it('8. still shows a disabled employee to a SuperAdmin', async () => {
      context = asContext({ global: true });
      users.requireById.mockResolvedValue({
        id: TARGET,
        displayName: 'Left The Company',
        status: 'disabled',
      });
      employment.listEmployeeHistory.mockResolvedValue([{ id: 'm1' }]);

      const response = await detail().expect(200);

      expect(response.body.accountStatus).toBe('disabled');
      expect(response.body.memberships).toHaveLength(1);
    });

    it('9. answers 404 for a user that does not exist, once authorized', async () => {
      context = asContext({ global: true });
      const { NotFoundError } = await import('../../../common/errors/domain.error');
      users.requireById.mockRejectedValue(new NotFoundError('User not found.'));

      // The status is asserted EXPLICITLY rather than only through supertest's
      // `.expect(404)`. Both refuse a wrong status; only this one is visible to
      // a static analyser, which otherwise reads the test as assertion-free.
      const response = await detail();
      expect(response.status).toBe(404);
    });

    it('10. hands the scope to the query rather than filtering rows afterwards', async () => {
      context = asContext({ headOf: [A, B], memberOf: [A] });
      activeMembership = { departmentId: A };

      await detail().expect(200);

      // Both units the caller leads, passed as a SCOPE - the query does the
      // narrowing, so periods outside it are never read into this process.
      expect(employment.listEmployeeHistory).toHaveBeenCalledWith(TARGET, [A, B]);
    });

    it('11. never lets a historical membership authorize the caller', async () => {
      // The caller leads A. The target's history includes A, but their ACTIVE
      // membership is B - the only thing authorization consults.
      context = asContext({ headOf: [A], memberOf: [A] });
      activeMembership = { departmentId: B };

      // The status is asserted EXPLICITLY rather than only through supertest's
      // `.expect(403)`. Both refuse a wrong status; only this one is visible to
      // a static analyser, which otherwise reads the test as assertion-free.
      const response = await detail();

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      // ★ AND THE REFUSAL CAME FIRST. The shared department is only in the
      // target's past, so nothing was read on their behalf: history is what a
      // caller may be shown AFTER they are authorized, never the reason they
      // are. A guard that consulted it would have reached these services.
      expect(employment.listEmployeeHistory).not.toHaveBeenCalled();
      expect(users.requireById).not.toHaveBeenCalled();
    });

    /**
     * The caller's OWN history grants nothing either. `headOf` and `memberOf`
     * are built from ACTIVE rows in `loadContext`, so an ex-head arrives with an
     * empty `headOf` and is refused like any member.
     */
    it('12. refuses a caller whose own headship has ended', async () => {
      context = asContext({ headOf: [], memberOf: [A] });
      activeMembership = { departmentId: A };

      await detail().expect(403);
      expect(employment.listEmployeeHistory).not.toHaveBeenCalled();
    });

    it('14. reads accountStatus from the user record, not from any membership', async () => {
      context = asContext({ global: true });
      users.requireById.mockResolvedValue({
        id: TARGET,
        displayName: 'A Person',
        status: 'active',
      });
      // Every period ended, yet the ACCOUNT is still active - the two are
      // independent, and the response must say so.
      employment.listEmployeeHistory.mockResolvedValue([{ id: 'm1', membershipStatus: 'ended' }]);

      const response = await detail().expect(200);

      expect(response.body.accountStatus).toBe('active');
      expect(response.body.memberships[0].membershipStatus).toBe('ended');
    });

    it('15. keeps membershipStatus independent of accountStatus', async () => {
      context = asContext({ global: true });
      users.requireById.mockResolvedValue({
        id: TARGET,
        displayName: 'A Person',
        status: 'disabled',
      });
      employment.listEmployeeHistory.mockResolvedValue([{ id: 'm1', membershipStatus: 'active' }]);

      const response = await detail().expect(200);

      // Representable on purpose: a disabled account on a still-active period.
      expect(response.body.accountStatus).toBe('disabled');
      expect(response.body.memberships[0].membershipStatus).toBe('active');
    });

    it('reaches no service at all when it refuses', async () => {
      context = asContext({ memberOf: [A] });

      await detail().expect(403);

      expect(users.requireById).not.toHaveBeenCalled();
      expect(employment.listEmployeeHistory).not.toHaveBeenCalled();
      expect(provisioning.provision).not.toHaveBeenCalled();
      expect(lifecycle.disable).not.toHaveBeenCalled();
    });

    it('mounts nothing destructive under the detail route - GET only', async () => {
      context = asContext({ global: true });

      // Same reason as the 404 above: assert the status explicitly.
      const posted = await authed('post', `/users/${TARGET}/memberships`);
      const patched = await authed('patch', `/users/${TARGET}/memberships`);

      expect(posted.status).toBe(404);
      expect(patched.status).toBe(404);
    });
  });

  describe('CSRF', () => {
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it('refuses a mutation without the header, before any permission is considered', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
        .send(validBody)
        .expect(403);
      expect(provisioning.provision).not.toHaveBeenCalled();
    });
  });
  // ------------------------------------------------- malformed identifier --

  /**
   * A route parameter that is not a UUID used to reach PostgreSQL, which
   * rejected the cast (SQLSTATE 22P02) as an error the filter does not map —
   * so the caller got a bare 500. Guards do not catch it: they compare the
   * value as a string and an authorized caller passes them.
   *
   * 422 with the same shape a malformed BODY already produces, and the service
   * must not be reached at all.
   */
  describe('malformed identifier in the path', () => {
    // A caller the guards ADMIT: they compare the parameter as a string, so a
    // scoped caller is refused 403 before the pipe runs and never saw the 500.
    // Only a caller authorized for the route reached PostgreSQL with it.
    beforeEach(() => {
      context = asContext({ global: true });
    });

    it.each([['patch', '/users/not-a-uuid/status']] as const)(
      'answers 422 for %s %s, without reaching the service',
      async (method, path) => {
        await authed(method, path).send({ status: 'disabled' }).expect(422);
        expect(lifecycle.disable).not.toHaveBeenCalled();
      },
    );
  });
});
