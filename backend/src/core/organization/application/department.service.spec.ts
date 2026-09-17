import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import type { Database } from '../../../common/types/database.port';
import { Department } from '../domain/department.entity';
import { DepartmentRepository } from '../persistence/department.repository';
import { MembershipRepository } from '../persistence/membership.repository';
import { DepartmentService } from './department.service';

/**
 * Unit lifecycle rules, without a database.
 *
 * Proves the decision-making: which conditions produce a conflict, and in what
 * order the steps run. It deliberately proves nothing about atomicity — that is
 * a property of PostgreSQL, asserted where a real one exists.
 */

const department = (over: Partial<Department> = {}): Department => ({
  id: 'dep-1',
  slug: 'unit-one',
  name: 'Unit One',
  status: 'active',
  function: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
});

/** Runs the callback immediately: honest for a unit test, and claims no atomicity. */
const databaseDouble = () =>
  ({
    query: jest.fn(),
    transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
  }) as unknown as Database;

describe('DepartmentService', () => {
  let db: Database;
  let departments: jest.Mocked<DepartmentRepository>;
  let memberships: jest.Mocked<MembershipRepository>;
  let service: DepartmentService;

  beforeEach(() => {
    db = databaseDouble();
    departments = {
      create: jest.fn(),
      findById: jest.fn(),
      lockById: jest.fn(),
      findBySlug: jest.fn(),
      list: jest.fn(),
      rename: jest.fn(),
      setFunction: jest.fn(),
      archive: jest.fn(),
    } as unknown as jest.Mocked<DepartmentRepository>;
    memberships = {
      countActiveInDepartment: jest.fn(),
    } as unknown as jest.Mocked<MembershipRepository>;

    service = new DepartmentService(db, departments, memberships);
  });

  describe('create', () => {
    it('normalises the slug so one unit cannot exist twice under different casing', async () => {
      departments.findBySlug.mockResolvedValue(null);
      departments.create.mockResolvedValue(department());

      await service.create({ slug: '  Unit-One  ', name: '  Unit One  ' });

      expect(departments.create).toHaveBeenCalledWith({ slug: 'unit-one', name: 'Unit One' });
    });

    it('rejects a blank slug or name rather than storing whitespace', async () => {
      await expect(service.create({ slug: '   ', name: 'x' })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(service.create({ slug: 'x', name: '   ' })).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(departments.create).not.toHaveBeenCalled();
    });

    it('reports a duplicate slug as a conflict', async () => {
      departments.findBySlug.mockResolvedValue(department());

      await expect(service.create({ slug: 'unit-one', name: 'Another' })).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(departments.create).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('refuses while the unit still has members, and names how many', async () => {
      departments.lockById.mockResolvedValue(department());
      memberships.countActiveInDepartment.mockResolvedValue(3);

      await expect(service.archive('dep-1')).rejects.toThrow(/3 active member/);
      expect(departments.archive).not.toHaveBeenCalled();
    });

    it('archives an empty unit', async () => {
      departments.lockById.mockResolvedValue(department());
      memberships.countActiveInDepartment.mockResolvedValue(0);
      departments.archive.mockResolvedValue(department({ status: 'archived' }));

      await expect(service.archive('dep-1')).resolves.toMatchObject({ status: 'archived' });
    });

    it('locks the unit before counting, so nobody can join between the two', async () => {
      const order: string[] = [];
      departments.lockById.mockImplementation(async () => {
        order.push('lock');
        return department();
      });
      memberships.countActiveInDepartment.mockImplementation(async () => {
        order.push('count');
        return 0;
      });
      departments.archive.mockImplementation(async () => {
        order.push('archive');
        return department({ status: 'archived' });
      });

      await service.archive('dep-1');

      expect(order).toEqual(['lock', 'count', 'archive']);
    });

    it('reports an already archived unit as a conflict rather than doing nothing quietly', async () => {
      departments.lockById.mockResolvedValue(department({ status: 'archived' }));

      await expect(service.archive('dep-1')).rejects.toBeInstanceOf(ConflictError);
    });

    it('is a not-found when the unit does not exist', async () => {
      departments.lockById.mockResolvedValue(null);

      await expect(service.archive('nope')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('opens exactly one transaction for the whole check-then-write', async () => {
      departments.lockById.mockResolvedValue(department());
      memberships.countActiveInDepartment.mockResolvedValue(0);
      departments.archive.mockResolvedValue(department({ status: 'archived' }));

      await service.archive('dep-1');

      expect(db.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('rename', () => {
    it('rejects a blank name', async () => {
      await expect(service.rename('dep-1', '   ')).rejects.toBeInstanceOf(ValidationError);
    });

    it('is a not-found when the unit does not exist', async () => {
      departments.rename.mockResolvedValue(null);

      await expect(service.rename('nope', 'X')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('update — rename and function in one transaction', () => {
    it('renames AND sets the function inside a single transaction, on its connection', async () => {
      const tx = { query: jest.fn() };
      (db.transaction as jest.Mock).mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(tx));
      departments.rename.mockResolvedValue(department({ name: 'Điều độ' }));
      departments.setFunction.mockResolvedValue(department({ name: 'Điều độ', function: 'dispatch' }));

      const updated = await service.update('dep-1', { name: 'Điều độ', function: 'dispatch' });

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(departments.rename).toHaveBeenCalledWith('dep-1', 'Điều độ', tx);
      expect(departments.setFunction).toHaveBeenCalledWith('dep-1', 'dispatch', tx);
      expect(updated).toMatchObject({ name: 'Điều độ', function: 'dispatch' });
    });

    it('★ lets a refused function take the rename down with it — the error leaves the transaction', async () => {
      // The double runs the callback and rethrows, exactly as the real
      // `Database.transaction` does before it issues ROLLBACK; the rename ran
      // on that same connection, so PostgreSQL discards it. Proven against a
      // real server in organization.integration.spec.ts.
      departments.rename.mockResolvedValue(department({ name: 'Renamed' }));
      departments.setFunction.mockRejectedValue(new Error('CHECK violated'));

      await expect(service.update('dep-1', { name: 'Renamed', function: 'dispatch' })).rejects.toThrow(
        'CHECK violated',
      );
      expect(departments.rename).toHaveBeenCalledTimes(1);
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('renames only when only a name is sent', async () => {
      departments.rename.mockResolvedValue(department({ name: 'Renamed' }));

      const updated = await service.update('dep-1', { name: 'Renamed' });

      expect(updated.name).toBe('Renamed');
      expect(departments.setFunction).not.toHaveBeenCalled();
    });

    it('sets the function only when only a function is sent — null clears it', async () => {
      departments.setFunction.mockResolvedValue(department({ function: null }));

      const updated = await service.update('dep-1', { function: null });

      expect(updated.function).toBeNull();
      expect(departments.setFunction).toHaveBeenCalledWith('dep-1', null, {});
      expect(departments.rename).not.toHaveBeenCalled();
    });

    it('keeps the validation of each half: a blank name, an empty patch, a missing unit', async () => {
      await expect(service.update('dep-1', { name: '  ' })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.update('dep-1', {})).rejects.toBeInstanceOf(ValidationError);
      expect(db.transaction).not.toHaveBeenCalled();

      departments.rename.mockResolvedValue(null);
      departments.setFunction.mockResolvedValue(null);
      await expect(service.update('nope', { name: 'X', function: 'sales' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('setFunction (0032)', () => {
    it('sets what the unit is for, and hands back the row as stored', async () => {
      departments.setFunction.mockResolvedValue(department({ function: 'dispatch' }));

      const updated = await service.setFunction('dep-1', 'dispatch');

      expect(departments.setFunction).toHaveBeenCalledWith('dep-1', 'dispatch');
      expect(updated.function).toBe('dispatch');
    });

    it('clears it with null — an ordinary unit again', async () => {
      departments.setFunction.mockResolvedValue(department({ function: null }));

      const updated = await service.setFunction('dep-1', null);

      expect(departments.setFunction).toHaveBeenCalledWith('dep-1', null);
      expect(updated.function).toBeNull();
    });

    it('is a not-found when the unit does not exist', async () => {
      departments.setFunction.mockResolvedValue(null);

      await expect(service.setFunction('nope', 'sales')).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
