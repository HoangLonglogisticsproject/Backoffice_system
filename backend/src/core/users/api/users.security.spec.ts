import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthorizationService } from '../../authorization/application/authorization.service';
import { AuthorizationContext } from '../../authorization/domain/authorization.context';
import { PermissionGuard } from '../../authorization/api/permission.guard';
import { AuthGuard } from '../../identity/api/auth.guard';
import { CsrfGuard } from '../../identity/api/csrf.guard';
import { SESSION_COOKIE } from '../../identity/api/session.cookie';
import { SessionService } from '../../identity/application/session.service';
import { AccountLifecycleService } from '../application/account-lifecycle.service';
import { AccountProvisioningService } from '../application/account-provisioning.service';
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
  let lifecycle: { disable: jest.Mock };
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
    };

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
        {
          provide: AuthorizationService,
          useValue: { loadContext: jest.fn().mockImplementation(async () => context) },
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

  const authed = (method: 'post' | 'patch', path: string) =>
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

    it('refuses to re-enable — that flow is deliberately not implemented', async () => {
      await authed('patch', `/users/${TARGET}/status`).send({ status: 'active' }).expect(422);
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
});
