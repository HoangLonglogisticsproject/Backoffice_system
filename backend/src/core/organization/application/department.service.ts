import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain.error';
import { DATABASE, type Database } from '../../../common/types/database.port';
import { Department, normalizeSlug } from '../domain/department.entity';
import { DepartmentRepository } from '../persistence/department.repository';
import { MembershipRepository } from '../persistence/membership.repository';

/**
 * The lifecycle of a unit: create, rename, archive.
 *
 * TRANSACTION BOUNDARIES LIVE HERE, not in the repositories. Only this layer
 * knows which writes must succeed or fail together, and a repository that
 * opened its own transaction would make that impossible to compose.
 */
@Injectable()
export class DepartmentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly departments: DepartmentRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  /** CreateDepartment. */
  async create(input: { slug: string; name: string }): Promise<Department> {
    const slug = normalizeSlug(input.slug);
    const name = input.name.trim();

    if (slug.length === 0) throw new ValidationError('Department slug is required.');
    if (name.length === 0) throw new ValidationError('Department name is required.');

    // Checked first so the common case answers with a clear conflict; the unique
    // index remains the authority for the race that slips past it.
    if (await this.departments.findBySlug(slug)) {
      throw new ConflictError('That department slug is already in use.');
    }

    return this.departments.create({ slug, name });
  }

  /** RenameDepartment. The slug is deliberately immutable — things point at it. */
  async rename(id: string, name: string): Promise<Department> {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new ValidationError('Department name is required.');

    const renamed = await this.departments.rename(id, trimmed);
    if (!renamed) throw new NotFoundError('Department not found.');

    return renamed;
  }

  /**
   * ArchiveDepartment — only when the unit is empty.
   *
   * No cascade, deliberately. Archiving a unit that still holds people would
   * change the organizational state of every one of them behind a single click,
   * and memberships ended that way are indistinguishable from memberships ended
   * on purpose. The caller empties the unit first, and each of those moves is
   * its own visible decision.
   *
   * Check and write share one transaction with the unit row locked, because
   * "is it empty" and "archive it" must not be separated by a moment in which
   * somebody joins.
   */
  async archive(id: string): Promise<Department> {
    return this.db.transaction(async (tx) => {
      const department = await this.departments.lockById(id, tx);
      if (!department) throw new NotFoundError('Department not found.');

      if (department.status === 'archived') {
        throw new ConflictError('That department is already archived.');
      }

      const activeMembers = await this.memberships.countActiveInDepartment(id, tx);
      if (activeMembers > 0) {
        throw new ConflictError(
          `That department still has ${activeMembers} active member(s). ` +
            'Transfer or disable them before archiving it.',
        );
      }

      const archived = await this.departments.archive(id, tx);
      // The lock means nothing can have archived it in between, so a null here
      // is a broken assumption rather than a race — say so loudly.
      if (!archived) throw new Error('Archive affected no row despite holding the lock');

      return archived;
    });

    // NOTE for a later phase: an active DEPARTMENT_HEAD assignment must also
    // block archiving. That check cannot live here — `core/organization` must
    // not read `role_assignments`, which authorization owns — so it belongs to
    // whichever use case coordinates both contexts.
  }

  async list(): Promise<Department[]> {
    return this.departments.list();
  }

  async require(id: string): Promise<Department> {
    const department = await this.departments.findById(id);
    if (!department) throw new NotFoundError('Department not found.');
    return department;
  }
}
