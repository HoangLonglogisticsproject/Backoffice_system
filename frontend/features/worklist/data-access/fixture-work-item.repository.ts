import { Injectable } from '@angular/core';
import { Observable, delay, of } from 'rxjs';
import { UserContext } from '@bo/types';
import { visibleRecords } from '@bo/services';
import { WorkItem } from '../domain/work-item';
import { WorkItemQuery, WorkItemRepository } from './work-item.repository';
import { WORK_ITEMS } from './fixtures/work-items.fixtures';

const DAY = 86_400_000;

@Injectable()
export class FixtureWorkItemRepository extends WorkItemRepository {
  list(user: UserContext, query: WorkItemQuery): Observable<WorkItem[]> {
    // Ownership first, using the platform rule — never a bespoke copy of it.
    let items = visibleRecords(WORK_ITEMS, user);

    if (query.departmentId) items = items.filter((i) => i.departmentId === query.departmentId);
    if (query.capability) items = items.filter((i) => i.capability === query.capability);
    if (query.dueToday) {
      const cutoff = Date.now() + DAY;
      items = items.filter(
        (i) => i.status !== 'DONE' && i.dueAt !== null && new Date(i.dueAt).getTime() <= cutoff,
      );
    }

    // Overdue and high priority first — the order a work list should default to.
    return of([...items].sort(byUrgency)).pipe(delay(120));
  }
}

const RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

function byUrgency(a: WorkItem, b: WorkItem): number {
  const due = (item: WorkItem) => (item.dueAt ? new Date(item.dueAt).getTime() : Infinity);
  return RANK[a.priority] - RANK[b.priority] || due(a) - due(b);
}
