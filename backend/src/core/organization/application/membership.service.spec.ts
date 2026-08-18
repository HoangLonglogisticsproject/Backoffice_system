import { ConflictError } from '../../../common/errors/domain.error';
import type { Database } from '../../../common/types/database.port';
import { Department, DepartmentMembership } from '../domain/department.entity';
import { DepartmentRepository } from '../persistence/department.repository';
import { MembershipRepository } from '../persistence/membership.repository';
import { MembershipService } from './membership.service';

/**
 * Membership rules, without a database.
 *
 * The most important assertion in this file is the last one: that no method
 * exists which would leave an active user belonging nowhere.
 */

const department = (over: Partial<Department> = {}): Department => ({
  id: 'dep-1',
  slug: 'unit-one',
  name: 'Unit One',
  status: 'active',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
});

const membership = (over: Partial<DepartmentMembership> = {}): DepartmentMembership => ({
  id: 'mem-1',
  userId: 'user-1',
  departmentId: 'dep-1',
  status: 'active',
  createdAt: new Date('2026-01-01'),
  endedAt: null,
  ...over,
});

const databaseDouble = () =>
  ({
    query: jest.fn(),
    transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
  }) as unknown as Database;

describe('MembershipService', () => {
  let db: Database;
  let departments: jest.Mocked<DepartmentRepository>;
  let memberships: jest.Mocked<MembershipRepository>;
  let service: MembershipService;

  beforeEach(() => {
    db = databaseDouble();
    departments = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<DepartmentRepository>;
    memberships = {
      findActiveForUser: jest.fn(),
      lockActiveForUser: jest.fn(),
      listActiveInDepartment: jest.fn(),
      listHistoryForUser: jest.fn(),
      create: jest.fn(),
      end: jest.fn(),
    } as unknown as jest.Mocked<MembershipRepository>;

    service = new MembershipService(db, departments, memberships);
  });

  describe('enroll', () => {
    it('refuses to enroll somebody who already belongs somewhere', async () => {
      departments.findById.mockResolvedValue(department());
      memberships.lockActiveForUser.mockResolvedValue(membership());

      await expect(service.enroll({ userId: 'user-1', departmentId: 'dep-2' })).rejects.toThrow(
        /Transfer them/,
      );
      expect(memberships.create).not.toHaveBeenCalled();
    });

    it('refuses to enroll into an archived unit', async () => {
      departments.findById.mockResolvedValue(department({ status: 'archived' }));

      await expect(
        service.enroll({ userId: 'user-1', departmentId: 'dep-1' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('runs inside a caller-supplied transaction when given one', async () => {
      departments.findById.mockResolvedValue(department());
      memberships.lockActiveForUser.mockResolvedValue(null);
      memberships.create.mockResolvedValue(membership());
      const callerTx = { query: jest.fn() };

      await service.enroll({ userId: 'user-1', departmentId: 'dep-1' }, callerTx);

      // It must NOT open a transaction of its own, or an account and its
      // membership could commit separately.
      expect(db.transaction).not.toHaveBeenCalled();
      expect(memberships.create).toHaveBeenCalledWith(expect.anything(), callerTx);
    });
  });

  describe('transfer', () => {
    it('ends the old membership BEFORE opening the new one', async () => {
      const order: string[] = [];
      departments.findById.mockResolvedValue(department({ id: 'dep-2' }));
      memberships.lockActiveForUser.mockResolvedValue(membership());
      memberships.end.mockImplementation(async () => {
        order.push('end');
        return membership({ status: 'ended', endedAt: new Date() });
      });
      memberships.create.mockImplementation(async () => {
        order.push('create');
        return membership({ id: 'mem-2', departmentId: 'dep-2' });
      });

      await service.transfer({ userId: 'user-1', toDepartmentId: 'dep-2' });

      expect(order).toEqual(['end', 'create']);
    });

    it('refuses when the user has no membership to transfer', async () => {
      departments.findById.mockResolvedValue(department({ id: 'dep-2' }));
      memberships.lockActiveForUser.mockResolvedValue(null);

      await expect(
        service.transfer({ userId: 'user-1', toDepartmentId: 'dep-2' }),
      ).rejects.toThrow(/Enroll them/);
    });

    it('refuses a transfer into the unit the user is already in', async () => {
      departments.findById.mockResolvedValue(department());
      memberships.lockActiveForUser.mockResolvedValue(membership());

      await expect(
        service.transfer({ userId: 'user-1', toDepartmentId: 'dep-1' }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(memberships.end).not.toHaveBeenCalled();
    });

    it('refuses a transfer into an archived unit, leaving the current one intact', async () => {
      departments.findById.mockResolvedValue(department({ id: 'dep-2', status: 'archived' }));

      await expect(
        service.transfer({ userId: 'user-1', toDepartmentId: 'dep-2' }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(memberships.end).not.toHaveBeenCalled();
    });

    it('does both writes through the same transaction handle', async () => {
      departments.findById.mockResolvedValue(department({ id: 'dep-2' }));
      memberships.lockActiveForUser.mockResolvedValue(membership());
      memberships.end.mockResolvedValue(membership({ status: 'ended' }));
      memberships.create.mockResolvedValue(membership({ id: 'mem-2' }));

      await service.transfer({ userId: 'user-1', toDepartmentId: 'dep-2' });

      const endTx = memberships.end.mock.calls[0]?.[2];
      const createTx = memberships.create.mock.calls[0]?.[1];
      expect(endTx).toBe(createTx);
    });

    it('never takes the source department from the caller — it reads it', async () => {
      departments.findById.mockResolvedValue(department({ id: 'dep-2' }));
      memberships.lockActiveForUser.mockResolvedValue(membership({ departmentId: 'dep-9' }));
      memberships.end.mockResolvedValue(membership({ status: 'ended' }));
      memberships.create.mockResolvedValue(membership({ id: 'mem-2' }));

      await service.transfer({ userId: 'user-1', toDepartmentId: 'dep-2' });

      // The membership it ended is the one it found, not one it was told about.
      expect(memberships.end).toHaveBeenCalledWith('mem-1', expect.any(Date), expect.anything());
    });
  });

  describe('the invariant it exists to protect', () => {
    it('offers no way to end a membership without opening another', () => {
      // Leaving the unit means leaving the organization, which disables the
      // account — an account lifecycle change, not an org-chart edit. A
      // `remove` here would produce exactly the forbidden state: an active user
      // belonging nowhere.
      const methods = Object.getOwnPropertyNames(MembershipService.prototype);
      expect(methods).not.toContain('remove');
      expect(methods).not.toContain('end');
      expect(methods).not.toContain('endMembership');
    });
  });
});
