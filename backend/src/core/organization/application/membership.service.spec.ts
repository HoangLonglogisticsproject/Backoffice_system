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
      lockById: jest.fn(),
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

  /**
   * ⚠ V12 — THE ARCHIVE RACE.
   *
   * Every inbound path already REFUSES an archived department. That check was
   * not the problem: it read the row with `findById`, which takes no lock, while
   * `DepartmentService.archive` reads it with `lockById`. Nothing made the two
   * contend, so this interleaving committed:
   *
   *   T2 transfer  reads dep-2            → active
   *   T1 archive   locks dep-2, counts    → 0 active members (T2 has not
   *                archives, COMMITS         inserted yet)
   *   T2           creates membership     → active membership in an ARCHIVED unit
   *
   * Taking the SAME lock archive takes is the whole fix: whichever transaction
   * arrives second blocks on the row and then re-reads the status the first one
   * committed. These tests pin the lock, because the status check alone passed
   * both before and after and therefore proves nothing.
   */
  describe('the archived-department race (V12)', () => {
    it('LOCKS the target department when enrolling, not merely reads it', async () => {
      departments.lockById.mockResolvedValue(department());
      memberships.lockActiveForUser.mockResolvedValue(null);
      memberships.create.mockResolvedValue(membership());

      await service.enroll({ userId: 'user-1', departmentId: 'dep-1' });

      expect(departments.lockById).toHaveBeenCalledWith('dep-1', expect.anything());
      // An unlocked read here is exactly the bug: it cannot contend with archive.
      expect(departments.findById).not.toHaveBeenCalled();
    });

    it('LOCKS the target department when transferring', async () => {
      departments.lockById.mockResolvedValue(department({ id: 'dep-2' }));
      memberships.lockActiveForUser.mockResolvedValue(membership());
      memberships.end.mockResolvedValue(membership({ status: 'ended', endedAt: new Date() }));
      memberships.create.mockResolvedValue(membership({ departmentId: 'dep-2' }));

      await service.transfer({ userId: 'user-1', toDepartmentId: 'dep-2' });

      expect(departments.lockById).toHaveBeenCalledWith('dep-2', expect.anything());
      expect(departments.findById).not.toHaveBeenCalled();
    });

    it('takes the department lock BEFORE creating the membership', async () => {
      const order: string[] = [];
      departments.lockById.mockImplementation(async () => {
        order.push('lock-department');
        return department();
      });
      memberships.lockActiveForUser.mockResolvedValue(null);
      memberships.create.mockImplementation(async () => {
        order.push('create-membership');
        return membership();
      });

      await service.enroll({ userId: 'user-1', departmentId: 'dep-1' });

      // Locking after the insert would leave the same window open.
      expect(order).toEqual(['lock-department', 'create-membership']);
    });

    it('locks inside the CALLER’s transaction, so it serialises with archive', async () => {
      const callerTx = { query: jest.fn() };
      departments.lockById.mockResolvedValue(department());
      memberships.lockActiveForUser.mockResolvedValue(null);
      memberships.create.mockResolvedValue(membership());

      await service.enroll({ userId: 'user-1', departmentId: 'dep-1' }, callerTx);

      // ★ A lock taken on a different connection would be a lock on nothing:
      // it would release at once and contend with no one.
      expect(departments.lockById).toHaveBeenCalledWith('dep-1', callerTx);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('still refuses an archived unit once it holds the lock', async () => {
      departments.lockById.mockResolvedValue(department({ status: 'archived' }));

      await expect(
        service.enroll({ userId: 'user-1', departmentId: 'dep-1' }),
      ).rejects.toBeInstanceOf(ConflictError);
      // No partial data: nothing is written on the refusing path.
      expect(memberships.create).not.toHaveBeenCalled();
      expect(memberships.end).not.toHaveBeenCalled();
    });

    it('refuses a transfer into a unit archived while the request was in flight', async () => {
      // What the loser of the race now sees: the lock is released, and the row
      // it re-reads carries the status the winner committed.
      departments.lockById.mockResolvedValue(department({ id: 'dep-2', status: 'archived' }));
      memberships.lockActiveForUser.mockResolvedValue(membership());

      await expect(
        service.transfer({ userId: 'user-1', toDepartmentId: 'dep-2' }),
      ).rejects.toBeInstanceOf(ConflictError);
      // ★ The OLD membership must not have been ended — a refused transfer that
      // still removed somebody from their unit would be worse than the race.
      expect(memberships.end).not.toHaveBeenCalled();
      expect(memberships.create).not.toHaveBeenCalled();
    });
  });

  describe('enroll', () => {
    it('refuses to enroll somebody who already belongs somewhere', async () => {
      departments.lockById.mockResolvedValue(department());
      memberships.lockActiveForUser.mockResolvedValue(membership());

      await expect(service.enroll({ userId: 'user-1', departmentId: 'dep-2' })).rejects.toThrow(
        /Transfer them/,
      );
      expect(memberships.create).not.toHaveBeenCalled();
    });

    it('refuses to enroll into an archived unit', async () => {
      departments.lockById.mockResolvedValue(department({ status: 'archived' }));

      await expect(
        service.enroll({ userId: 'user-1', departmentId: 'dep-1' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('runs inside a caller-supplied transaction when given one', async () => {
      departments.lockById.mockResolvedValue(department());
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
      departments.lockById.mockResolvedValue(department({ id: 'dep-2' }));
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
      departments.lockById.mockResolvedValue(department({ id: 'dep-2' }));
      memberships.lockActiveForUser.mockResolvedValue(null);

      await expect(
        service.transfer({ userId: 'user-1', toDepartmentId: 'dep-2' }),
      ).rejects.toThrow(/Enroll them/);
    });

    it('refuses a transfer into the unit the user is already in', async () => {
      departments.lockById.mockResolvedValue(department());
      memberships.lockActiveForUser.mockResolvedValue(membership());

      await expect(
        service.transfer({ userId: 'user-1', toDepartmentId: 'dep-1' }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(memberships.end).not.toHaveBeenCalled();
    });

    it('refuses a transfer into an archived unit, leaving the current one intact', async () => {
      departments.lockById.mockResolvedValue(department({ id: 'dep-2', status: 'archived' }));

      await expect(
        service.transfer({ userId: 'user-1', toDepartmentId: 'dep-2' }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(memberships.end).not.toHaveBeenCalled();
    });

    it('does both writes through the same transaction handle', async () => {
      departments.lockById.mockResolvedValue(department({ id: 'dep-2' }));
      memberships.lockActiveForUser.mockResolvedValue(membership());
      memberships.end.mockResolvedValue(membership({ status: 'ended' }));
      memberships.create.mockResolvedValue(membership({ id: 'mem-2' }));

      await service.transfer({ userId: 'user-1', toDepartmentId: 'dep-2' });

      const endTx = memberships.end.mock.calls[0]?.[2];
      const createTx = memberships.create.mock.calls[0]?.[1];
      expect(endTx).toBe(createTx);
    });

    it('never takes the source department from the caller — it reads it', async () => {
      departments.lockById.mockResolvedValue(department({ id: 'dep-2' }));
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
