import { Observable } from 'rxjs';
import { UserContext } from '@bo/types';
import { PotentialCustomer, PotentialCustomerStatus, TeamWorkload } from '../domain/potential-customer';

export interface PotentialCustomerQuery {
  /** Omit for every department the caller may reach — used by org-wide views. */
  departmentId?: string;
  status?: PotentialCustomerStatus;
  /** Free-text over name and contact. */
  search?: string;
  /** Newest first, capped. */
  limit?: number;
}

/**
 * The contract every potential-customer surface talks to.
 *
 * FixturePotentialCustomerRepository backs it today; a Http implementation
 * will back it later. Neither the head's pool page nor the member's list page
 * knows which one it is holding — swapping is a provider change in the app.
 */
export abstract class PotentialCustomerRepository {
  /** Scoped by the caller's ownership rules, so a member gets only their own. */
  abstract list(user: UserContext, query: PotentialCustomerQuery): Observable<PotentialCustomer[]>;

  /** Unassigned pool for a department. Supervisory data — heads and above. */
  abstract pool(user: UserContext, departmentId: string): Observable<PotentialCustomer[]>;

  abstract workload(user: UserContext, departmentId: string): Observable<TeamWorkload[]>;

  abstract assign(user: UserContext, customerId: string, assigneeId: string): Observable<PotentialCustomer>;
}
