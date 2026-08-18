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
});
