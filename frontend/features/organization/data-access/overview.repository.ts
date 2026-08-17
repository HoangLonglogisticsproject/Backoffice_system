import { Observable } from 'rxjs';
import { UserContext } from '@bo/types';
import { ActivityItem, ApprovalItem, Metric, Suggestion } from '../domain/overview';

/**
 * Everything the workspace surfaces need. Each method takes the acting user so
 * an implementation can scope server-side; feature code never filters by role
 * itself.
 */
export abstract class OverviewRepository {
  /** Organization-wide metrics for a superadmin. */
  abstract organizationMetrics(user: UserContext): Observable<Metric[]>;

  /** Metrics for one department, for its head. */
  abstract departmentMetrics(user: UserContext, departmentId: string): Observable<Metric[]>;

  abstract approvals(user: UserContext): Observable<ApprovalItem[]>;
  abstract activity(user: UserContext): Observable<ActivityItem[]>;
  abstract suggestions(user: UserContext, departmentId?: string): Observable<Suggestion[]>;
}
