import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain.error';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import { Department, DepartmentStatus, normalizeSlug } from '../domain/department.entity';

/**
 * SQLSTATE 23505 — unique_violation. Read as a property rather than imported
 * from `pg`: this file depends on the `Database` port and must not learn which
 * driver sits behind it.
 */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

interface DepartmentRow {
  id: string;
  slug: string;
  name: string;
  status: DepartmentStatus;
  created_at: Date;
  updated_at: Date;
}

const toDepartment = (row: DepartmentRow): Department => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * SQL for units. One aggregate per repository — memberships have their own,
 * because "rename a unit" and "move a person" change for entirely different
 * reasons and would otherwise grow into one class nobody owns.
 *
 * NO TRANSACTIONS ARE OPENED HERE. Every method takes an executor and uses it;
 * deciding what belongs in one transaction is the application layer's job,
 * because only it knows which writes must succeed or fail together.
 */
@Injectable()
export class DepartmentRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    input: { slug: string; name: string },
    executor: DatabaseQuery = this.db,
  ): Promise<Department> {
    try {
      const rows = await executor.query<DepartmentRow>(
        'INSERT INTO departments (slug, name) VALUES ($1, $2) RETURNING *',
        [normalizeSlug(input.slug), input.name.trim()],
      );

      const row = rows[0];
      if (!row) throw new Error('INSERT INTO departments returned no row');

      return toDepartment(row);
    } catch (error) {
      // The service checks for a duplicate slug first, but two callers can pass
      // that check at the same moment and only one can win the unique index.
      if (isUniqueViolation(error)) {
        throw new ConflictError('That department slug is already in use.');
      }
      throw error;
    }
  }

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<Department | null> {
    const rows = await executor.query<DepartmentRow>('SELECT * FROM departments WHERE id = $1', [
      id,
    ]);
    return rows[0] ? toDepartment(rows[0]) : null;
  }

  /**
   * Locks the unit row for the rest of the caller's transaction.
   *
   * Used by archive, which reads another table to decide whether the unit is
   * empty and then writes. Without the lock somebody could join in the gap
   * between the check and the write.
   */
  async lockById(id: string, executor: DatabaseQuery): Promise<Department | null> {
    const rows = await executor.query<DepartmentRow>(
      'SELECT * FROM departments WHERE id = $1 FOR UPDATE',
      [id],
    );
    return rows[0] ? toDepartment(rows[0]) : null;
  }

  async findBySlug(slug: string, executor: DatabaseQuery = this.db): Promise<Department | null> {
    const rows = await executor.query<DepartmentRow>('SELECT * FROM departments WHERE slug = $1', [
      normalizeSlug(slug),
    ]);
    return rows[0] ? toDepartment(rows[0]) : null;
  }

  async list(executor: DatabaseQuery = this.db): Promise<Department[]> {
    const rows = await executor.query<DepartmentRow>('SELECT * FROM departments ORDER BY name ASC');
    return rows.map(toDepartment);
  }

  async rename(
    id: string,
    name: string,
    executor: DatabaseQuery = this.db,
  ): Promise<Department | null> {
    const rows = await executor.query<DepartmentRow>(
      'UPDATE departments SET name = $2 WHERE id = $1 RETURNING *',
      [id, name.trim()],
    );
    return rows[0] ? toDepartment(rows[0]) : null;
  }

  /**
   * Flips the unit to `archived`, but only from `active`.
   *
   * The `status = 'active'` predicate makes a second concurrent archive affect
   * zero rows instead of silently succeeding twice, which is what lets the
   * service answer "already archived" rather than pretending it did something.
   */
  async archive(id: string, executor: DatabaseQuery): Promise<Department | null> {
    const rows = await executor.query<DepartmentRow>(
      "UPDATE departments SET status = 'archived' WHERE id = $1 AND status = 'active' RETURNING *",
      [id],
    );
    return rows[0] ? toDepartment(rows[0]) : null;
  }
}
