import { Injectable, signal } from '@angular/core';
import { Department } from '@bo/types';

/**
 * The department a workspace is currently about. Set by whatever page owns the
 * route (a department workspace, or a head's dashboard); read by capability
 * widgets so they can load their own data without knowing the route shape.
 *
 * Organization-wide surfaces leave it undefined.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceContext {
  private readonly _department = signal<Department | undefined>(undefined);
  readonly department = this._department.asReadonly();

  set(department: Department | undefined): void {
    this._department.set(department);
  }
}
