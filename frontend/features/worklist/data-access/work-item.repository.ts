import { Observable } from 'rxjs';
import { UserContext } from '@bo/types';
import { WorkItem } from '../domain/work-item';

export interface WorkItemQuery {
  departmentId?: string;
  capability?: string;
  /** Only items due today or already overdue. */
  dueToday?: boolean;
}

export abstract class WorkItemRepository {
  /** Implementations must apply the caller's ownership scope, not the UI. */
  abstract list(user: UserContext, query: WorkItemQuery): Observable<WorkItem[]>;
}
