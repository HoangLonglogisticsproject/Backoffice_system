import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Department } from '@bo/types';
import { DepartmentRepository } from './department.repository';

/**
 * Departments are runtime data. Adding one to the source of truth makes it
 * appear in navigation, routing and dashboards with zero code changes.
 */
@Injectable({ providedIn: 'root' })
export class OrgStore {
  private readonly repository = inject(DepartmentRepository);

  private readonly _departments = signal<Department[]>([]);
  readonly departments = this._departments.asReadonly();

  async load(): Promise<void> {
    const departments = await firstValueFrom(this.repository.list());
    this._departments.set(departments.filter((d) => d.active));
  }

  bySlug(slug: string | null | undefined): Department | undefined {
    return slug ? this._departments().find((d) => d.slug === slug) : undefined;
  }

  byId(id: string | null | undefined): Department | undefined {
    return id ? this._departments().find((d) => d.id === id) : undefined;
  }
}
