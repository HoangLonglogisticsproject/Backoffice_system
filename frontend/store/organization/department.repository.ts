import { Observable } from 'rxjs';
import { Department, Member } from '@bo/types';

/**
 * Data contract for the organization structure. Abstract class doubles as the
 * DI token, so features inject the contract and never learn where the data
 * came from. Today a fixture implementation; tomorrow an HTTP one — the swap
 * is a provider change in the composition root, not a feature rewrite.
 */
export abstract class DepartmentRepository {
  abstract list(): Observable<Department[]>;
  abstract members(departmentId: string): Observable<Member[]>;
}
